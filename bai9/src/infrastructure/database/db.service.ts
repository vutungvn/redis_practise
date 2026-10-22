import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import { SCHEMA_SQL, SEED_SQL } from './schema';

interface QueryStat {
  count: number;
  /** Thoi gian DB thuc thi (khong tinh cho lay ket noi) */
  execMs: number;
  /** Thoi gian xep hang cho ket noi trong pool */
  waitMs: number;
}

// Truy cap PostgreSQL + do so truy van / thoi gian theo nhan -> dung de bao cao chi phi DB truoc/sau
@Injectable()
export class DbService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DbService.name);
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL ?? 'postgres://shopfast:shopfast@localhost:5442/shopfast',
    max: Number(process.env.DB_POOL_SIZE ?? 20),
  });
  private stats = new Map<string, QueryStat>();

  async onModuleInit() {
    await this.pool.query(SCHEMA_SQL);
    const { rows } = await this.pool.query<{ n: number }>('SELECT COUNT(*)::int AS n FROM products');
    if (rows[0].n === 0) {
      this.logger.log('Seeding data (2.000 products, 200k reviews, 100k orders, 300k order items)...');
      await this.pool.query(SEED_SQL);
      this.logger.log('Seed done');
    }
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }

  private record(label: string, waitMs: number, execMs: number) {
    const stat = this.stats.get(label) ?? { count: 0, execMs: 0, waitMs: 0 };
    stat.count++;
    stat.waitMs += waitMs;
    stat.execMs += execMs;
    this.stats.set(label, stat);
  }

  async query<T extends QueryResultRow>(label: string, sql: string, params: unknown[] = []): Promise<T[]> {
    return this.withClient(label, async (client) => (await client.query<T>(sql, params)).rows);
  }

  async transaction<T>(label: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    return this.withClient(label, async (client) => {
      await client.query('BEGIN');
      try {
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
      } catch (err) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw err;
      }
    });
  }

  private async withClient<T>(label: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const requestedAt = performance.now();
    const client = await this.pool.connect();
    const acquiredAt = performance.now();
    try {
      return await fn(client);
    } finally {
      client.release();
      this.record(label, acquiredAt - requestedAt, performance.now() - acquiredAt);
    }
  }

  report() {
    let queries = 0;
    let execMs = 0;
    let waitMs = 0;
    const byQuery: Record<string, { count: number; execMs: number; avgExecMs: number; waitMs: number }> = {};
    for (const [label, s] of [...this.stats].sort((a, b) => b[1].execMs - a[1].execMs)) {
      queries += s.count;
      execMs += s.execMs;
      waitMs += s.waitMs;
      byQuery[label] = {
        count: s.count,
        execMs: Math.round(s.execMs),
        avgExecMs: +(s.execMs / s.count).toFixed(2),
        waitMs: Math.round(s.waitMs),
      };
    }
    return { queries, execMs: Math.round(execMs), waitMs: Math.round(waitMs), byQuery };
  }

  reset() {
    this.stats = new Map();
  }
}
