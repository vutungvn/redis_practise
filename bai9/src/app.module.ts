import { Module } from '@nestjs/common';
import { AdminModule } from './admin/admin.module';
import { CacheModule } from './cache/cache.module';
import { CatalogModule } from './catalog/catalog.module';
import { DatabaseModule } from './infrastructure/database/database.module';
import { RedisModule } from './infrastructure/redis/redis.module';
import { MetricsModule } from './metrics/metrics.module';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [RedisModule, DatabaseModule, CacheModule, CatalogModule, OrdersModule, AdminModule, MetricsModule],
})
export class AppModule {}
