import { Injectable } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { CacheType } from '../config/cache-policies';
import { CatalogRepository } from './catalog.repository';
import { LivePrice } from './catalog.types';

const BATCH_WINDOW_MS = 2;
const MAX_BATCH_IDS = 500;

type Waiter = { resolve: (price: LivePrice | undefined) => void; reject: (err: unknown) => void };

// Gia KHONG BAO GIO di qua cache: moi phan hoi deu ghep gia doc tu DB ngay luc tra ve.
// Cac request dong thoi trong cua so 2ms duoc gom thanh 1 truy van WHERE id = ANY(...).
// Truy van luon chay SAU khi request bat dau -> doi gia da commit truoc do chac chan duoc thay.
@Injectable()
export class PriceService {
  private pending = new Map<number, Waiter[]>();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly repo: CatalogRepository,
    private readonly cache: CacheService,
  ) {}

  async getPrices(ids: number[]): Promise<Map<number, LivePrice>> {
    if (ids.length === 0) return new Map();
    this.cache.recordLiveRead(CacheType.PRICE, ids.length);
    const prices = await Promise.all(ids.map((id) => this.load(id)));
    const result = new Map<number, LivePrice>();
    ids.forEach((id, i) => prices[i] && result.set(id, prices[i]!));
    return result;
  }

  private load(id: number): Promise<LivePrice | undefined> {
    return new Promise((resolve, reject) => {
      const waiters = this.pending.get(id) ?? [];
      waiters.push({ resolve, reject });
      this.pending.set(id, waiters);
      if (this.pending.size >= MAX_BATCH_IDS) void this.flush();
      else if (!this.timer) this.timer = setTimeout(() => void this.flush(), BATCH_WINDOW_MS);
    });
  }

  private async flush() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    const batch = this.pending;
    this.pending = new Map();
    if (batch.size === 0) return;
    try {
      const prices = await this.repo.findPrices([...batch.keys()]);
      for (const [id, waiters] of batch) waiters.forEach((w) => w.resolve(prices.get(id)));
    } catch (err) {
      for (const waiters of batch.values()) waiters.forEach((w) => w.reject(err));
    }
  }
}
