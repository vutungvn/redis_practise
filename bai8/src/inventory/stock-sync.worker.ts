import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { OrderRepository } from './order.repository';

const SYNC_INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS ?? 200);
const SYNC_BATCH_LIMIT = 5000;

// Dong bo theo lo tu so cai don hang xuong dong products.stock (chi chay trong DB,
// khong phu thuoc Redis -> Redis restart khong lam mat du lieu can dong bo)
@Injectable()
export class StockSyncWorker implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(StockSyncWorker.name);
  private timer?: NodeJS.Timeout;
  private running: Promise<void> | null = null;

  readonly stats = { batches: 0, ordersApplied: 0, productRowWrites: 0 };

  constructor(private readonly orders: OrderRepository) {}

  onModuleInit() {
    this.timer = setInterval(() => void this.flush().catch((e) => this.logger.error(e.message)), SYNC_INTERVAL_MS);
  }

  async onApplicationShutdown() {
    clearInterval(this.timer);
    await this.flush();
  }

  /** Chay 1 lo; neu dang chay thi cho lo hien tai xong */
  async flush(): Promise<void> {
    if (this.running) return this.running;
    this.running = (async () => {
      const synced = await this.orders.syncBatch(SYNC_BATCH_LIMIT);
      if (synced.length === 0) return;
      this.stats.batches++;
      for (const row of synced) {
        this.stats.ordersApplied += row.orders;
        this.stats.productRowWrites++;
      }
    })().finally(() => (this.running = null));
    return this.running;
  }

  /** Dong bo den khi khong con don nao chua cong don */
  async flushAll(): Promise<void> {
    for (let i = 0; i < 100; i++) {
      await this.flush();
      const before = this.stats.ordersApplied;
      await this.flush();
      if (this.stats.ordersApplied === before) return;
    }
  }
}
