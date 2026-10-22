import { Global, Module } from '@nestjs/common';
import { CacheMetricsService } from './cache-metrics.service';
import { CacheService } from './cache.service';

@Global()
@Module({
  providers: [CacheService, CacheMetricsService],
  exports: [CacheService, CacheMetricsService],
})
export class CacheModule {}
