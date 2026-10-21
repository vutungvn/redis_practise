import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomInt } from 'crypto';
import Redis from 'ioredis';
import { REDIS } from '../redis.module';
import { CatalogFilter, buildListKey, matchesFilter, parseListKey, scopeOf } from './catalog-filter';
import { LIST_TTL_MAX_SECONDS, LIST_TTL_MIN_SECONDS, MAX_CACHE_KEYS } from './catalog.constants';
import { CatalogPage, Product } from './product.entity';

const META = 'shopfast:catalog:meta';
export const INDEX_KEY = `${META}:index`; // ZSET: khoa danh sach -> thoi diem het han (ms)
const groupKey = (scope: string) => `${META}:group:${scope}`; // SET khoa theo danh muc
const versionKey = (scope: string) => `${META}:ver:${scope}`; // tang moi khi gia trong nhom doi

export type StoreResult = 'stored' | 'stale' | 'limit';

// Ghi cache nguyen tu:
//  -1: version nhom da doi trong luc truy van DB -> ket qua co the mang gia cu, bo qua
//  -2: da cham tran MAX_CACHE_KEYS -> khong sinh khoa moi
//   1: da ghi
const STORE_SCRIPT = `
local listKey, verKey, indexKey, grpKey = KEYS[1], KEYS[2], KEYS[3], KEYS[4]
local value, ttl, expectedVer, nowMs, maxKeys, groupTtl = ARGV[1], tonumber(ARGV[2]), ARGV[3], tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6])

if (redis.call('GET', verKey) or '0') ~= expectedVer then return -1 end

redis.call('ZREMRANGEBYSCORE', indexKey, '-inf', nowMs)
if not redis.call('ZSCORE', indexKey, listKey) and redis.call('ZCARD', indexKey) >= maxKeys then
  return -2
end

redis.call('SET', listKey, value, 'EX', ttl)
redis.call('ZADD', indexKey, nowMs + ttl * 1000, listKey)
redis.call('SADD', grpKey, listKey)
redis.call('EXPIRE', grpKey, groupTtl)
return 1
`;

@Injectable()
export class CatalogCacheService {
  private readonly logger = new Logger(CatalogCacheService.name);

  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async get(key: string): Promise<CatalogPage | null> {
    const raw = await this.redis.get(key);
    return raw ? JSON.parse(raw) : null;
  }

  async currentVersion(filter: CatalogFilter): Promise<string> {
    return (await this.redis.get(versionKey(scopeOf(filter)))) ?? '0';
  }

  async store(filter: CatalogFilter, page: number, data: CatalogPage, version: string): Promise<StoreResult> {
    const scope = scopeOf(filter);
    const ttl = randomInt(LIST_TTL_MIN_SECONDS, LIST_TTL_MAX_SECONDS + 1);
    const result = await this.redis.eval(
      STORE_SCRIPT,
      4,
      buildListKey(filter, page),
      versionKey(scope),
      INDEX_KEY,
      groupKey(scope),
      JSON.stringify(data),
      ttl,
      version,
      Date.now(),
      MAX_CACHE_KEYS,
      LIST_TTL_MAX_SECONDS + 1,
    );
    if (result === -2) this.logger.warn(`Cache key limit ${MAX_CACHE_KEYS} reached, not caching new filter`);
    return result === 1 ? 'stored' : result === -1 ? 'stale' : 'limit';
  }

  // Gia doi: xoa moi khoa ma san pham khop bo loc theo gia CU (dang nam trong ket qua,
  // hoac tinh vao total) hoac gia MOI (co the lot vao ket qua / doi thu tu sap xep)
  async invalidateForPriceChange(product: Product, oldPrice: number): Promise<string[]> {
    const scopes = [product.category, '_all'];

    // Tang version truoc de chan request dang truy van DB ghi lai gia cu
    await Promise.all(scopes.map((s) => this.redis.incr(versionKey(s))));

    const candidates = (await Promise.all(scopes.map((s) => this.redis.smembers(groupKey(s))))).flat();
    const affected = candidates.filter((key) => {
      const parsed = parseListKey(key);
      return (
        parsed !== null &&
        (matchesFilter(parsed.filter, product, oldPrice) || matchesFilter(parsed.filter, product, product.price))
      );
    });
    if (affected.length === 0) return [];

    const tx = this.redis.multi().del(...affected).zrem(INDEX_KEY, ...affected);
    for (const scope of scopes) tx.srem(groupKey(scope), ...affected);
    await tx.exec();
    this.logger.log(`Price of product ${product.id} changed, invalidated ${affected.length} key(s)`);
    return affected;
  }
}
