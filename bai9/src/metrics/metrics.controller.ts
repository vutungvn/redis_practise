import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { CacheMetricsService } from '../cache/cache-metrics.service';
import { CacheService } from '../cache/cache.service';
import { CACHE_POLICIES } from '../config/cache-policies';
import { DbService } from '../infrastructure/database/db.service';
import { CacheStore } from '../infrastructure/redis/cache-store';

@Controller('metrics')
export class MetricsController {
  constructor(
    private readonly metrics: CacheMetricsService,
    private readonly cache: CacheService,
    private readonly store: CacheStore,
    private readonly db: DbService,
  ) {}

  @Get()
  report() {
    return {
      since: this.metrics.startedAt,
      cacheEnabled: this.cache.isEnabled(),
      redis: this.store.health(),
      cache: this.metrics.report(),
      db: this.db.report(),
    };
  }

  @Get('policies')
  policies() {
    return Object.values(CACHE_POLICIES).map(({ key, ...policy }) => policy);
  }

  @Post('reset')
  @HttpCode(200)
  reset() {
    this.metrics.reset();
    this.db.reset();
    return { reset: true };
  }
}
