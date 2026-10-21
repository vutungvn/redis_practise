import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomInt, randomUUID } from 'crypto';
import Redis from 'ioredis';
import { REDIS } from '../redis.module';
import { Product } from './product.entity';
import { ProductRepository } from './product.repository';

const CACHE_TTL_SECONDS = 300;
const CACHE_TTL_JITTER_SECONDS = 60; // TTL thuc te: 300..360s
const LOCK_TTL_MS = 5000; // khoa tu het han neu tien trinh giu khoa bi chet
const WAIT_INTERVAL_MS = 100;
const MAX_WAIT_RETRIES = 20; // cho toi da ~2s roi bo cuoc

// Chi xoa khoa khi token van la cua minh (tranh xoa nham khoa cua request khac
// trong truong hop khoa cua minh da tu het han va bi request khac gianh)
const RELEASE_LOCK_SCRIPT = `
if redis.call("GET", KEYS[1]) == ARGV[1] then
  return redis.call("DEL", KEYS[1])
end
return 0
`;

@Injectable()
export class ProductService {
  private readonly logger = new Logger(ProductService.name);

  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repo: ProductRepository,
  ) {}

  static cacheKey(id: string) {
    return `shopfast:product:${id}`;
  }

  static lockKey(id: string) {
    return `lock:shopfast:product:${id}`;
  }

  async getProductWithLock(id: string): Promise<Product> {
    const key = ProductService.cacheKey(id);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);

    // (1) Gianh khoa phan tan: SET NX PX la nguyen tu, khoa tu het han sau LOCK_TTL_MS
    const lockKey = ProductService.lockKey(id);
    const token = randomUUID();
    const acquired = await this.redis.set(lockKey, token, 'PX', LOCK_TTL_MS, 'NX');

    // (2) Khong gianh duoc khoa: cho roi doc lai cache, co gioi han so lan
    if (acquired !== 'OK') return this.waitForCache(key, id);

    try {
      // Kiem tra lai: request giu khoa truoc do co the vua dung xong cache
      const rebuilt = await this.redis.get(key);
      if (rebuilt) return JSON.parse(rebuilt);

      const product = await this.repo.findById(id);
      if (!product) throw new NotFoundException(`Product ${id} not found`);

      // (3) Do lech ngau nhien de cac khoa cung loai khong het han cung luc
      const ttl = CACHE_TTL_SECONDS + randomInt(0, CACHE_TTL_JITTER_SECONDS + 1);
      await this.redis.set(key, JSON.stringify(product), 'EX', ttl);

      return product;
    } finally {
      // (4) Giai phong khoa phan tan
      // (5) Nam trong finally nen van chay ca khi truy van DB nem loi
      await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, lockKey, token);
    }
  }

  private async waitForCache(key: string, id: string): Promise<Product> {
    for (let attempt = 1; attempt <= MAX_WAIT_RETRIES; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, WAIT_INTERVAL_MS));
      const cached = await this.redis.get(key);
      if (cached) return JSON.parse(cached);
    }
    this.logger.warn(`Gave up waiting for ${key} after ${MAX_WAIT_RETRIES} retries`);
    throw new ServiceUnavailableException(`Product ${id} is being rebuilt, please retry`);
  }

  // Ban goc chua co khoa, chi dung de do tai so sanh
  async getProductWithoutLock(id: string): Promise<Product> {
    const key = ProductService.cacheKey(id);
    const cached = await this.redis.get(key);
    if (cached) return JSON.parse(cached);

    const product = await this.repo.findById(id);
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    await this.redis.set(key, JSON.stringify(product), 'EX', CACHE_TTL_SECONDS);
    return product;
  }
}
