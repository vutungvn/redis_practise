import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { InventoryModule } from './inventory/inventory.module';
import { RedisModule } from './redis.module';

@Module({
  imports: [RedisModule, DatabaseModule, InventoryModule],
})
export class AppModule {}
