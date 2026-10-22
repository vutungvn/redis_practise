import { Injectable } from '@nestjs/common';
import { CACHE_POLICIES, CachePolicy, CacheType } from '../config/cache-policies';
import { CacheStore, UNAVAILABLE } from '../infrastructure/redis/cache-store';
import { CacheMetricsService } from './cache-metrics.service';
import { LocalCache } from './local-cache';
import { SingleFlight } from './single-flight';

export type CacheSource = 'L1' | 'HIT' | 'MISS' | 'BYPASS';

const LOCK_TTL_MS = 5000;
const LOCK_WAIT_INTERVAL_MS = 50;
const LOCK_MAX_WAITS = 30;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Cache-aside theo chinh sach. Tang nghiep vu chi truyen CacheType + id + ham tai du lieu.
// Moi duong loi deu roi ve "doc DB" -> Redis sap chi lam cham, khong lam hong request.
@Injectable()
export class CacheService {
  private enabled = process.env.CACHE_ENABLED !== 'false';
  private readonly local = new LocalCache();
  private readonly flights = new SingleFlight();

  constructor(
    private readonly store: CacheStore,
    private readonly metrics: CacheMetricsService,
  ) {}

  isEnabled() {
    return this.enabled;
  }

  setEnabled(enabled: boolean) {
    this.enabled = enabled;
  }

  async getOrLoad<T>(
    type: CacheType,
    id: string,
    loader: () => Promise<T | null>,
  ): Promise<{ value: T | null; source: CacheSource }> {
    const policy = this.cacheablePolicy(type);
    const key = policy.key(id);

    if (!this.enabled) {
      this.metrics.bypass(type);
      return { value: await this.timedLoad(type, loader), source: 'BYPASS' };
    }

    if (policy.localTtlMs) {
      const local = this.local.get<T>(key);
      if (local !== undefined) {
        this.metrics.l1Hit(type);
        return { value: local, source: 'L1' };
      }
    }

    const raw = await this.store.get(key);
    if (raw !== UNAVAILABLE && raw !== null) {
      this.metrics.hit(type);
      const value = JSON.parse(raw) as T;
      if (policy.localTtlMs) this.local.set(key, value, policy.localTtlMs);
      return { value, source: 'HIT' };
    }

    const redisUp = raw !== UNAVAILABLE;
    if (redisUp) this.metrics.miss(type);
    else this.metrics.bypass(type);

    const value = await this.flights.do(key, () =>
      policy.stampedeLock && redisUp
        ? this.loadWithLock(type, policy, key, loader)
        : this.loadAndFill(type, policy, key, loader, redisUp),
    );
    return { value, source: redisUp ? 'MISS' : 'BYPASS' };
  }

  async getMany<T>(
    type: CacheType,
    ids: string[],
    loader: (ids: string[]) => Promise<Map<string, T>>,
  ): Promise<{ values: Map<string, T>; hits: number; misses: number; source: CacheSource }> {
    const policy = this.cacheablePolicy(type);
    if (ids.length === 0) return { values: new Map(), hits: 0, misses: 0, source: 'HIT' };

    const raws = this.enabled ? await this.store.mget(ids.map(policy.key)) : UNAVAILABLE;
    if (raws === UNAVAILABLE) {
      this.metrics.bypass(type, ids.length);
      return { values: await this.timedLoad(type, () => loader(ids)), hits: 0, misses: 0, source: 'BYPASS' };
    }

    const values = new Map<string, T>();
    const missing: string[] = [];
    ids.forEach((id, i) => (raws[i] === null ? missing.push(id) : values.set(id, JSON.parse(raws[i]!))));
    this.metrics.hit(type, values.size);
    this.metrics.miss(type, missing.length);

    if (missing.length > 0) {
      const loaded = await this.timedLoad(type, () => loader(missing));
      await this.store.msetWithTtl(
        [...loaded].map(([id, value]) => ({ key: policy.key(id), value: JSON.stringify(value), ttlSeconds: this.ttl(policy) })),
      );
      for (const [id, value] of loaded) values.set(id, value);
    }
    return { values, hits: ids.length - missing.length, misses: missing.length, source: missing.length ? 'MISS' : 'HIT' };
  }

  async invalidate(type: CacheType, ids: string[]): Promise<string[]> {
    const policy = this.cacheablePolicy(type);
    const keys = ids.map(policy.key);
    for (const key of keys) this.local.delete(key);
    await this.store.del(keys);
    if (policy.doubleDeleteMs) {
      setTimeout(() => void this.store.del(keys), policy.doubleDeleteMs).unref();
    }
    return keys;
  }

  /** Ghi nhan mot lan doc truc tiep DB cho loai du lieu khong cache (gia) */
  recordLiveRead(type: CacheType, n = 1) {
    this.metrics.live(type, n);
  }

  private cacheablePolicy(type: CacheType): CachePolicy {
    const policy = CACHE_POLICIES[type];
    if (!policy.cacheable) throw new Error(`${type} must never be cached`);
    return policy;
  }

  private ttl(policy: CachePolicy): number {
    const jitter = (Math.random() * 2 - 1) * policy.jitterRatio;
    return Math.max(1, Math.round(policy.ttlSeconds * (1 + jitter)));
  }

  private async timedLoad<T>(type: CacheType, loader: () => Promise<T>): Promise<T> {
    const startedAt = performance.now();
    try {
      return await loader();
    } finally {
      this.metrics.dbLoad(type, performance.now() - startedAt);
    }
  }

  private async loadAndFill<T>(
    type: CacheType,
    policy: CachePolicy,
    key: string,
    loader: () => Promise<T | null>,
    redisUp: boolean,
  ): Promise<T | null> {
    const value = await this.timedLoad(type, loader);
    if (value === null) return null; // khong cache "khong tim thay"
    if (policy.localTtlMs) this.local.set(key, value, policy.localTtlMs);
    if (redisUp) await this.store.set(key, JSON.stringify(value), this.ttl(policy));
    return value;
  }

  // Chi 1 request (tren moi instance) dung lai gia tri dat; request khac cho doc lai cache
  private async loadWithLock<T>(
    type: CacheType,
    policy: CachePolicy,
    key: string,
    loader: () => Promise<T | null>,
  ): Promise<T | null> {
    const lockKey = `${key}:lock`;
    const lock = await this.store.tryLock(lockKey, LOCK_TTL_MS);

    if (lock.status === 'acquired') {
      try {
        const rebuilt = await this.store.get(key);
        if (rebuilt !== UNAVAILABLE && rebuilt !== null) return JSON.parse(rebuilt) as T;
        return await this.loadAndFill(type, policy, key, loader, true);
      } finally {
        await this.store.unlock(lockKey, lock.token);
      }
    }

    if (lock.status === 'busy') {
      for (let i = 0; i < LOCK_MAX_WAITS; i++) {
        await sleep(LOCK_WAIT_INTERVAL_MS);
        const raw = await this.store.get(key);
        if (raw === UNAVAILABLE) break;
        if (raw !== null) return JSON.parse(raw) as T;
      }
    }
    // Redis loi hoac cho qua lau: tu tai (van duoc single-flight gop trong instance)
    return this.loadAndFill(type, policy, key, loader, lock.status !== 'unavailable');
  }
}
