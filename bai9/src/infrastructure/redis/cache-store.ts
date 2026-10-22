import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'crypto';
import Redis from 'ioredis';
import { CircuitBreaker } from './circuit-breaker';
import { REDIS_CLIENT } from './redis.constants';

export const UNAVAILABLE = Symbol('UNAVAILABLE');
export type Unavailable = typeof UNAVAILABLE;

export type LockResult = { status: 'acquired'; token: string } | { status: 'busy' } | { status: 'unavailable' };

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

// Lop truy cap Redis duy nhat. Hop dong: KHONG BAO GIO nem loi.
// Redis loi / mach dang mo -> tra UNAVAILABLE de tang tren coi nhu cache miss va doc DB.
@Injectable()
export class CacheStore {
  private readonly logger = new Logger(CacheStore.name);
  private readonly breaker = new CircuitBreaker();
  // Lenh xoa that bai khi Redis loi: phai xoa xong truoc khi cho doc lai tu Redis,
  // neu khong Redis hoi phuc se tra lai du lieu cu
  private readonly pendingInvalidations = new Set<string>();
  errors = 0;

  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  private async run<T>(fn: () => Promise<T>): Promise<T | Unavailable> {
    if (!this.breaker.allowRequest()) return UNAVAILABLE;
    try {
      if (this.pendingInvalidations.size > 0) await this.replayInvalidations();
      const result = await fn();
      this.breaker.onSuccess();
      return result;
    } catch (err) {
      this.errors++;
      this.breaker.onFailure();
      return UNAVAILABLE;
    }
  }

  private async replayInvalidations() {
    const keys = [...this.pendingInvalidations];
    await this.redis.del(...keys);
    for (const key of keys) this.pendingInvalidations.delete(key);
    this.logger.log(`Replayed ${keys.length} pending invalidation(s) after Redis recovered`);
  }

  get(key: string): Promise<string | null | Unavailable> {
    return this.run(() => this.redis.get(key));
  }

  mget(keys: string[]): Promise<(string | null)[] | Unavailable> {
    return this.run(() => this.redis.mget(...keys));
  }

  async set(key: string, value: string, ttlSeconds: number): Promise<boolean> {
    return (await this.run(() => this.redis.set(key, value, 'EX', ttlSeconds))) === 'OK';
  }

  async msetWithTtl(entries: { key: string; value: string; ttlSeconds: number }[]): Promise<boolean> {
    if (entries.length === 0) return true;
    const result = await this.run(async () => {
      const tx = this.redis.multi();
      for (const e of entries) tx.set(e.key, e.value, 'EX', e.ttlSeconds);
      return tx.exec();
    });
    return result !== UNAVAILABLE;
  }

  async del(keys: string[]): Promise<boolean> {
    if (keys.length === 0) return true;
    const result = await this.run(() => this.redis.del(...keys));
    if (result === UNAVAILABLE) {
      for (const key of keys) this.pendingInvalidations.add(key);
      return false;
    }
    return true;
  }

  async tryLock(key: string, ttlMs: number): Promise<LockResult> {
    const token = randomUUID();
    const result = await this.run(() => this.redis.set(key, token, 'PX', ttlMs, 'NX'));
    if (result === UNAVAILABLE) return { status: 'unavailable' };
    return result === 'OK' ? { status: 'acquired', token } : { status: 'busy' };
  }

  async unlock(key: string, token: string): Promise<void> {
    await this.run(() => this.redis.eval(RELEASE_LOCK_SCRIPT, 1, key, token));
  }

  health() {
    return {
      circuit: this.breaker.current,
      circuitOpens: this.breaker.opens,
      errors: this.errors,
      pendingInvalidations: this.pendingInvalidations.size,
    };
  }
}
