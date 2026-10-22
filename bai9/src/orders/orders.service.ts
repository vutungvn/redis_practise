import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { CacheType } from '../config/cache-policies';
import { OrderItemDto } from './dto/place-order.dto';
import { OrdersRepository } from './orders.repository';

@Injectable()
export class OrdersService {
  constructor(
    private readonly repo: OrdersRepository,
    private readonly cache: CacheService,
  ) {}

  async myOrders(userId: number) {
    const { value, source } = await this.cache.getOrLoad(CacheType.USER_ORDERS, String(userId), () =>
      this.repo.recentOrders(userId),
    );
    return { data: value ?? [], trace: { user_orders: source } };
  }

  async placeOrder(userId: number, items: OrderItemDto[]) {
    const order = await this.repo.placeOrder(userId, items);
    // Lich su don cua chinh nguoi nay + ton kho cac san pham vua mua
    const invalidated = [
      ...(await this.cache.invalidate(CacheType.USER_ORDERS, [String(userId)])),
      ...(await this.cache.invalidate(CacheType.STOCK, order.lines.map((l) => String(l.productId)))),
    ];
    return { ...order, invalidated };
  }
}
