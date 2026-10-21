import { Module } from '@nestjs/common';
import { InventoryRecoveryService } from './inventory-recovery.service';
import { InventoryController } from './inventory.controller';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';
import { RedisInventoryStore } from './redis-inventory.store';
import { StockSyncWorker } from './stock-sync.worker';

@Module({
  controllers: [InventoryController],
  providers: [OrderService, OrderRepository, RedisInventoryStore, InventoryRecoveryService, StockSyncWorker],
})
export class InventoryModule {}
