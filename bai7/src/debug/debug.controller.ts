import { Controller, Delete, Get, Inject } from '@nestjs/common';
import Redis from 'ioredis';
import { INDEX_KEY } from '../catalog/catalog-cache.service';
import { LIST_KEY_PREFIX } from '../catalog/catalog-filter';
import { MAX_CACHE_KEYS } from '../catalog/catalog.constants';
import { ProductRepository } from '../catalog/product.repository';
import { REDIS } from '../redis.module';

// Endpoint ho tro kiem thu, khong dung cho production
@Controller('debug')
export class DebugController {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repo: ProductRepository,
  ) {}

  private async scan(pattern: string): Promise<string[]> {
    const keys: string[] = [];
    let cursor = '0';
    do {
      const [next, batch] = await this.redis.scan(cursor, 'MATCH', pattern, 'COUNT', 500);
      keys.push(...batch);
      cursor = next;
    } while (cursor !== '0');
    return keys.sort();
  }

  @Get('cache')
  async listKeys() {
    const keys = await this.scan(`${LIST_KEY_PREFIX}*`);
    const ttls = await Promise.all(keys.map((k) => this.redis.ttl(k)));
    return {
      count: keys.length,
      maxKeys: MAX_CACHE_KEYS,
      indexSize: await this.redis.zcard(INDEX_KEY),
      dbCatalogQueries: this.repo.catalogQueryCount,
      keys: keys.map((key, i) => ({ key, ttl: ttls[i] })),
    };
  }

  @Delete('cache')
  async flush() {
    const keys = await this.scan('shopfast:catalog:*');
    if (keys.length) await this.redis.del(...keys);
    this.repo.catalogQueryCount = 0;
    return { deleted: keys.length };
  }
}
