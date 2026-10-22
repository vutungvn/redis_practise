import { Injectable } from '@nestjs/common';
import { CACHE_POLICIES, CacheType } from '../config/cache-policies';

interface Counters {
  hits: number;
  l1Hits: number;
  misses: number;
  bypass: number;
  liveReads: number;
  dbLoads: number;
  dbLoadMs: number;
}

const empty = (): Counters => ({ hits: 0, l1Hits: 0, misses: 0, bypass: 0, liveReads: 0, dbLoads: 0, dbLoadMs: 0 });

// Dem trung / truot / bo qua cho tung loai du lieu
@Injectable()
export class CacheMetricsService {
  private counters = new Map<CacheType, Counters>(Object.values(CacheType).map((t) => [t, empty()]));
  private since = new Date();

  private c(type: CacheType) {
    return this.counters.get(type)!;
  }

  hit(type: CacheType, n = 1) {
    this.c(type).hits += n;
  }

  l1Hit(type: CacheType) {
    this.c(type).l1Hits++;
  }

  miss(type: CacheType, n = 1) {
    this.c(type).misses += n;
  }

  /** Khong tra cuu duoc cache (Redis loi / mach mo / cache bi tat) */
  bypass(type: CacheType, n = 1) {
    this.c(type).bypass += n;
  }

  /** Doc truc tiep tu DB theo thiet ke (loai khong cache) */
  live(type: CacheType, n = 1) {
    this.c(type).liveReads += n;
  }

  dbLoad(type: CacheType, ms: number) {
    this.c(type).dbLoads++;
    this.c(type).dbLoadMs += ms;
  }

  report() {
    return Object.values(CacheType).map((type) => {
      const c = this.c(type);
      const policy = CACHE_POLICIES[type];
      const lookups = c.hits + c.l1Hits + c.misses + c.bypass;
      return {
        type,
        keyPattern: policy.keyPattern,
        ttlSeconds: policy.ttlSeconds,
        lookups,
        hits: c.hits,
        l1Hits: c.l1Hits,
        misses: c.misses,
        bypass: c.bypass,
        liveReads: c.liveReads,
        hitRatio: !policy.cacheable ? 'n/a (khong cache)' : lookups ? `${(((c.hits + c.l1Hits) / lookups) * 100).toFixed(1)}%` : '-',
        dbLoads: c.dbLoads,
        avgDbLoadMs: c.dbLoads ? +(c.dbLoadMs / c.dbLoads).toFixed(1) : 0,
      };
    });
  }

  get startedAt() {
    return this.since;
  }

  reset() {
    this.counters = new Map(Object.values(CacheType).map((t) => [t, empty()]));
    this.since = new Date();
  }
}
