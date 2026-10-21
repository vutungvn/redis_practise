import { Injectable, Logger, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { OrderRepository } from './order.repository';
import { NOT_READY, RedisInventoryStore } from './redis-inventory.store';

const REBUILD_LOCK_TTL_MS = 10_000;
const DRAIN_TIMEOUT_MS = 3_000;
const POLL_MS = 20;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Dung lai so ton kho trong Redis tu DB khi Redis khoi dong lai (hoac lan chay dau tien)
@Injectable()
export class InventoryRecoveryService {
  private readonly logger = new Logger(InventoryRecoveryService.name);
  private readonly inflight = new Map<number, Promise<void>>();

  constructor(
    private readonly store: RedisInventoryStore,
    private readonly orders: OrderRepository,
  ) {}

  /** Bao dam cong cua san pham dang mo; neu dong thi dung lai (gop cac request cung luc) */
  async ensureReady(productId: number): Promise<void> {
    let job = this.inflight.get(productId);
    if (!job) {
      job = this.rebuild(productId).finally(() => this.inflight.delete(productId));
      this.inflight.set(productId, job);
    }
    await job;
  }

  private async rebuild(productId: number): Promise<void> {
    const token = randomUUID();
    if (!(await this.store.acquireRebuildLock(productId, token, REBUILD_LOCK_TTL_MS))) {
      // Instance khac dang dung lai -> cho cong mo
      for (let waited = 0; waited < REBUILD_LOCK_TTL_MS; waited += POLL_MS) {
        await sleep(POLL_MS);
        if ((await this.store.peek(productId)) !== NOT_READY) return;
      }
      throw new ServiceUnavailableException('Inventory is being rebuilt, please retry');
    }

    try {
      if ((await this.store.peek(productId)) !== NOT_READY) return;
      const startedAt = Date.now();

      // 1. Cho cac don PENDING tao truoc thoi diem nay ket thuc: don nao da tru kho tren
      //    Redis cu se kip ghi RESERVED vao DB truoc khi ta tinh so lieu
      const cutoff = await this.orders.dbNow();
      let pending = await this.orders.countPendingBefore(productId, cutoff);
      for (let waited = 0; pending > 0 && waited < DRAIN_TIMEOUT_MS; waited += POLL_MS) {
        await sleep(POLL_MS);
        pending = await this.orders.countPendingBefore(productId, cutoff);
      }
      // Qua han ma van PENDING: tien trinh xu ly da chet, khach chua nhan xac nhan -> huy
      if (pending > 0) await this.orders.rejectPendingBefore(productId, cutoff);

      // 2. Tinh so con ban duoc tu DB (nguon su that ben vung)
      const snapshot = await this.orders.snapshotForRebuild(productId);
      if (!snapshot) throw new NotFoundException(`Product ${productId} not found`);

      // 3. Nap vao Redis va mo cong
      const runId = await this.store.init(productId, snapshot.available, snapshot.cancelledIds);
      this.logger.warn(
        `Rebuilt inventory of product ${productId}: available=${snapshot.available}, ` +
          `stalePendingRejected=${pending}, redisRunId=${runId.slice(0, 8)}, took ${Date.now() - startedAt}ms`,
      );
    } finally {
      await this.store.releaseRebuildLock(productId, token).catch(() => undefined);
    }
  }
}
