import { Inject, Injectable } from '@nestjs/common';
import Redis from 'ioredis';
import { REDIS } from '../redis.module';

export const NOT_READY = -2;
export const OUT_OF_STOCK = -1;

// Hash tag {id} de cac khoa cua cung san pham nam cung slot khi chay Redis Cluster
const keys = (productId: number) => {
  const p = `inv:{${productId}}`;
  return { stock: `${p}:stock`, ready: `${p}:ready`, released: `${p}:released`, lock: `${p}:rebuild-lock` };
};

// run_id doi moi lan Redis khoi dong. Khoa "ready" luu run_id luc dung kho;
// lech nhau nghia la Redis da restart (ke ca khi AOF/RDB nap lai du lieu cu) -> dong cong
const RUN_ID = `local function run_id() return string.match(redis.call('INFO', 'server'), 'run_id:(%w+)') end`;

const PEEK_SCRIPT = `${RUN_ID}
if redis.call('GET', KEYS[2]) ~= run_id() then return ${NOT_READY} end
return tonumber(redis.call('GET', KEYS[1]) or '0')
`;

// Tru kho nguyen tu: kiem tra + tru trong cung mot script, Redis chay script tuan tu
// nen khong co request nao chen vao giua -> khong the ban vuot
const RESERVE_SCRIPT = `${RUN_ID}
if redis.call('GET', KEYS[2]) ~= run_id() then return ${NOT_READY} end
local qty = tonumber(ARGV[1])
local stock = tonumber(redis.call('GET', KEYS[1]) or '0')
if stock < qty then return ${OUT_OF_STOCK} end
return redis.call('DECRBY', KEYS[1], qty)
`;

// Hoan kho khi huy don, idempotent theo orderId (SADD tra 0 = da hoan roi)
const RELEASE_SCRIPT = `${RUN_ID}
if redis.call('GET', KEYS[2]) ~= run_id() then return ${NOT_READY} end
if redis.call('SADD', KEYS[3], ARGV[1]) == 0 then return 0 end
redis.call('INCRBY', KEYS[1], tonumber(ARGV[2]))
return 1
`;

// Nap lai kho tu DB va mo cong. ARGV[2..] = cac don da huy ma so lieu DB da tinh den
const INIT_SCRIPT = `${RUN_ID}
redis.call('SET', KEYS[1], ARGV[1])
redis.call('DEL', KEYS[3])
for i = 2, #ARGV, 1000 do
  redis.call('SADD', KEYS[3], unpack(ARGV, i, math.min(i + 999, #ARGV)))
end
local id = run_id()
redis.call('SET', KEYS[2], id)
return id
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end
return 0
`;

@Injectable()
export class RedisInventoryStore {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  /** So luong con lai, hoac NOT_READY neu cong dang dong */
  async peek(productId: number): Promise<number> {
    const k = keys(productId);
    return (await this.redis.eval(PEEK_SCRIPT, 2, k.stock, k.ready)) as number;
  }

  /** So luong con lai sau khi tru, OUT_OF_STOCK, hoac NOT_READY */
  async reserve(productId: number, qty: number): Promise<number> {
    const k = keys(productId);
    return (await this.redis.eval(RESERVE_SCRIPT, 2, k.stock, k.ready, qty)) as number;
  }

  /** 1 = da hoan kho, 0 = da hoan truoc do, NOT_READY = cong dong */
  async release(productId: number, orderId: string, qty: number): Promise<number> {
    const k = keys(productId);
    return (await this.redis.eval(RELEASE_SCRIPT, 3, k.stock, k.ready, k.released, orderId, qty)) as number;
  }

  /** Tra ve run_id cua Redis luc mo cong */
  async init(productId: number, available: number, cancelledOrderIds: string[]): Promise<string> {
    const k = keys(productId);
    return (await this.redis.eval(
      INIT_SCRIPT,
      3,
      k.stock,
      k.ready,
      k.released,
      available,
      ...cancelledOrderIds,
    )) as string;
  }

  async acquireRebuildLock(productId: number, token: string, ttlMs: number): Promise<boolean> {
    return (await this.redis.set(keys(productId).lock, token, 'PX', ttlMs, 'NX')) === 'OK';
  }

  async releaseRebuildLock(productId: number, token: string): Promise<void> {
    await this.redis.eval(RELEASE_LOCK_SCRIPT, 1, keys(productId).lock, token);
  }

  async rawState(productId: number) {
    const k = keys(productId);
    const [stock, ready, info] = await Promise.all([
      this.redis.get(k.stock),
      this.redis.get(k.ready),
      this.redis.info('server'),
    ]);
    const runId = /run_id:(\w+)/.exec(info)?.[1] ?? null;
    return { stock: stock === null ? null : Number(stock), ready: ready !== null && ready === runId, runId };
  }
}
