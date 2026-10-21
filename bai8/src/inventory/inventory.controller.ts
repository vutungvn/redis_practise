import {
  Body,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
} from '@nestjs/common';
import { ResetCampaignDto } from './dto/reset-campaign.dto';
import { PlaceOrderDto } from './dto/place-order.dto';
import { OrderRepository } from './order.repository';
import { OrderService } from './order.service';
import { RedisInventoryStore } from './redis-inventory.store';
import { StockSyncWorker } from './stock-sync.worker';

@Controller()
export class InventoryController {
  constructor(
    private readonly orderService: OrderService,
    private readonly orders: OrderRepository,
    private readonly store: RedisInventoryStore,
    private readonly sync: StockSyncWorker,
  ) {}

  @Post('orders')
  placeOrder(@Body() dto: PlaceOrderDto) {
    return this.orderService.placeOrder(dto);
  }

  @Post('orders/:id/cancel')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderService.cancel(id);
  }

  @Get('orders/:id')
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orderService.getOrder(id);
  }

  @Get('inventory/:productId')
  async inventory(@Param('productId', ParseIntPipe) productId: number) {
    const db = await this.orders.stats(productId);
    if (!db) throw new NotFoundException(`Product ${productId} not found`);
    const redis = await this.store.rawState(productId).catch((e: Error) => ({ error: e.message }));
    return { productId, redis, db, sync: this.sync.stats };
  }

  // Ket thuc chien dich: dong bo het so cai roi doi chieu Redis - DB - so da ban
  @Post('inventory/:productId/reconcile')
  @HttpCode(200)
  async reconcile(@Param('productId', ParseIntPipe) productId: number) {
    await this.sync.flushAll();
    const db = await this.orders.stats(productId);
    if (!db) throw new NotFoundException(`Product ${productId} not found`);
    const redis = await this.store.rawState(productId);
    const checks = {
      noOversell: db.soldQty <= db.initialStock,
      dbStockMatchesSales: db.dbStock === db.initialStock - db.soldQty,
      redisMatchesDb: redis.ready && redis.stock === db.dbStock,
      nonNegative: db.dbStock >= 0 && (redis.stock ?? 0) >= 0,
      allSynced: db.unsyncedOrders === 0 && db.pendingOrders === 0,
    };
    return { productId, ok: Object.values(checks).every(Boolean), checks, redis, db, sync: this.sync.stats };
  }

  // Ho tro kiem thu: mo chien dich moi voi so ton kho cho truoc
  @Post('campaigns/:productId/reset')
  @HttpCode(200)
  async reset(@Param('productId', ParseIntPipe) productId: number, @Body() dto: ResetCampaignDto) {
    await this.sync.flushAll();
    if (!(await this.orders.resetCampaign(productId, dto.stock))) {
      throw new NotFoundException(`Product ${productId} not found`);
    }
    await this.store.init(productId, dto.stock, []);
    Object.assign(this.sync.stats, { batches: 0, ordersApplied: 0, productRowWrites: 0 });
    return this.inventory(productId);
  }
}
