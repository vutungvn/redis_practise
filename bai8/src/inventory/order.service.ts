import {
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PlaceOrderDto } from './dto/place-order.dto';
import { InventoryRecoveryService } from './inventory-recovery.service';
import { Order, OrderRepository } from './order.repository';
import { NOT_READY, OUT_OF_STOCK, RedisInventoryStore } from './redis-inventory.store';

// Ngan sach cho dung lai kho trong 1 request, de tong phan hoi van < 500ms
const READY_WAIT_MS = 300;
const RELEASE_RETRY_DELAYS_MS = [500, 1000, 2000, 4000];

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class OrderService {
  private readonly logger = new Logger(OrderService.name);

  constructor(
    private readonly store: RedisInventoryStore,
    private readonly orders: OrderRepository,
    private readonly recovery: InventoryRecoveryService,
  ) {}

  async placeOrder(dto: PlaceOrderDto) {
    const { productId, qty } = dto;
    const orderId = dto.orderId ?? randomUUID();

    // 1. Cong phai mo; het hang thi tu choi ngay, khong ton luot ghi DB
    const available = await this.peekReady(productId);
    if (available < qty) throw new ConflictException({ message: 'Sold out', available });

    // 2. Ghi y dinh dat hang vao so cai (ben vung) truoc khi tru kho tren Redis
    if (!(await this.orders.insertPending(orderId, productId, qty))) {
      const existing = (await this.orders.findById(orderId))!;
      return { orderId, status: existing.status, duplicate: true };
    }

    // 3. Tru kho nguyen tu tren Redis
    let result: number;
    try {
      result = await this.store.reserve(productId, qty);
    } catch {
      await this.orders.resolvePending(orderId, 'REJECTED');
      throw new ServiceUnavailableException('Inventory temporarily unavailable, please retry');
    }
    if (result === NOT_READY) {
      await this.orders.resolvePending(orderId, 'REJECTED');
      void this.recovery.ensureReady(productId).catch(() => undefined);
      throw new ServiceUnavailableException('Inventory is being rebuilt, please retry');
    }
    if (result === OUT_OF_STOCK) {
      await this.orders.resolvePending(orderId, 'REJECTED');
      throw new ConflictException({ message: 'Sold out', available: 0 });
    }

    // 4. Xac nhan trong so cai. Neu don da bi qua trinh dung lai kho ep REJECTED thi khong
    //    xac nhan cho khach (luong da tru tren Redis chi lam ban thieu, khong bao gio ban vuot)
    if (!(await this.orders.resolvePending(orderId, 'RESERVED'))) {
      this.logger.warn(`Order ${orderId} was force-rejected during inventory rebuild`);
      throw new ServiceUnavailableException('Inventory is being rebuilt, please retry');
    }
    return { orderId, status: 'RESERVED', remaining: result };
  }

  async cancel(orderId: string) {
    const result = await this.orders.cancel(orderId);
    if (!result) throw new NotFoundException(`Order ${orderId} not found`);
    const { order, changed } = result;
    if (order.status !== 'CANCELLED') {
      throw new ConflictException(`Order is ${order.status}, only RESERVED orders can be cancelled`);
    }
    // Hoan kho tren Redis idempotent theo orderId -> huy lai nhieu lan cung chi hoan 1 lan
    const restock = await this.releaseInRedis(order);
    return { orderId, status: order.status, alreadyCancelled: !changed, restock };
  }

  async getOrder(orderId: string): Promise<Order> {
    const order = await this.orders.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);
    return order;
  }

  private async peekReady(productId: number): Promise<number> {
    try {
      const available = await this.store.peek(productId);
      if (available !== NOT_READY) return available;

      // Redis vua khoi dong lai / chua co so lieu -> dung lai tu DB, toi da READY_WAIT_MS
      await Promise.race([
        this.recovery.ensureReady(productId),
        sleep(READY_WAIT_MS).then(() => {
          throw new ServiceUnavailableException('Inventory is being rebuilt, please retry');
        }),
      ]);
      const after = await this.store.peek(productId);
      if (after === NOT_READY) throw new ServiceUnavailableException('Inventory is being rebuilt, please retry');
      return after;
    } catch (err) {
      if (err instanceof HttpException) throw err;
      throw new ServiceUnavailableException('Inventory temporarily unavailable, please retry');
    }
  }

  private async releaseInRedis(order: Order): Promise<'restocked' | 'already' | 'deferred'> {
    const attempt = async () => {
      let r = await this.store.release(order.product_id, order.id, order.qty);
      if (r === NOT_READY) {
        await this.recovery.ensureReady(order.product_id);
        r = await this.store.release(order.product_id, order.id, order.qty);
      }
      if (r === NOT_READY) throw new Error('inventory not ready');
      return r === 1 ? 'restocked' : 'already';
    };

    try {
      return await attempt();
    } catch {
      // DB da ghi CANCELLED (ben vung). Thu lai nen; neu Redis restart thi lan dung lai
      // kho se tinh don nay tu DB, SADD bao dam khong hoan 2 lan
      void (async () => {
        for (const delay of RELEASE_RETRY_DELAYS_MS) {
          await sleep(delay);
          try {
            return await attempt();
          } catch {
            /* thu lai */
          }
        }
        this.logger.error(`Could not release stock of cancelled order ${order.id}`);
      })();
      return 'deferred';
    }
  }
}
