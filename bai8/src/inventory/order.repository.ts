import { Inject, Injectable } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { PG } from '../database/database.module';

export type OrderStatus = 'PENDING' | 'RESERVED' | 'REJECTED' | 'CANCELLED';

export interface Order {
  id: string;
  product_id: number;
  qty: number;
  status: OrderStatus;
  stock_applied: boolean;
}

export interface SyncedProduct {
  product_id: number;
  delta: number;
  orders: number;
  stock: number;
}

@Injectable()
export class OrderRepository {
  constructor(@Inject(PG) private readonly pool: Pool) {}

  private async tx<T>(fn: (client: PoolClient) => Promise<T>, isolation = 'READ COMMITTED'): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query(`BEGIN ISOLATION LEVEL ${isolation}`);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }

  async productExists(productId: number): Promise<boolean> {
    const { rowCount } = await this.pool.query('SELECT 1 FROM products WHERE id = $1', [productId]);
    return rowCount === 1;
  }

  /** false neu orderId da ton tai (client gui lai) */
  async insertPending(id: string, productId: number, qty: number): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO orders (id, product_id, qty, status) VALUES ($1, $2, $3, 'PENDING')
       ON CONFLICT (id) DO NOTHING`,
      [id, productId, qty],
    );
    return rowCount === 1;
  }

  async findById(id: string): Promise<Order | null> {
    const { rows } = await this.pool.query<Order>(
      'SELECT id, product_id, qty, status, stock_applied FROM orders WHERE id = $1',
      [id],
    );
    return rows[0] ?? null;
  }

  /** Chi chuyen tu PENDING; false neu don da bi qua trinh dung lai kho ep REJECTED */
  async resolvePending(id: string, status: 'RESERVED' | 'REJECTED'): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE orders SET status = $2, updated_at = clock_timestamp() WHERE id = $1 AND status = 'PENDING'`,
      [id, status],
    );
    return rowCount === 1;
  }

  async cancel(id: string): Promise<{ order: Order; changed: boolean } | null> {
    return this.tx(async (client) => {
      const { rows } = await client.query<Order>(
        'SELECT id, product_id, qty, status, stock_applied FROM orders WHERE id = $1 FOR UPDATE',
        [id],
      );
      const order = rows[0];
      if (!order) return null;
      if (order.status !== 'RESERVED') return { order, changed: false };
      await client.query(`UPDATE orders SET status = 'CANCELLED', updated_at = clock_timestamp() WHERE id = $1`, [id]);
      return { order: { ...order, status: 'CANCELLED' as const }, changed: true };
    });
  }

  // Cong don theo lo: N don -> 1 lan UPDATE dong products (thay vi N lan)
  //   RESERVED chua ap dung  -> stock -= qty, danh dau da ap dung
  //   CANCELLED da ap dung   -> stock += qty, bo danh dau
  async syncBatch(limit: number): Promise<SyncedProduct[]> {
    const { rows } = await this.pool.query<SyncedProduct>(
      `WITH picked AS (
         SELECT id, product_id, qty, status FROM orders
         WHERE (status = 'RESERVED' AND NOT stock_applied) OR (status = 'CANCELLED' AND stock_applied)
         ORDER BY created_at
         LIMIT $1
         FOR UPDATE SKIP LOCKED
       ),
       flipped AS (
         UPDATE orders o SET stock_applied = (p.status = 'RESERVED'), updated_at = clock_timestamp()
         FROM picked p WHERE o.id = p.id
         RETURNING p.product_id, CASE WHEN p.status = 'RESERVED' THEN -p.qty ELSE p.qty END AS delta
       ),
       deltas AS (
         SELECT product_id, SUM(delta)::int AS delta, COUNT(*)::int AS orders FROM flipped GROUP BY product_id
       )
       UPDATE products pr SET stock = pr.stock + d.delta
       FROM deltas d WHERE pr.id = d.product_id
       RETURNING pr.id AS product_id, d.delta, d.orders, pr.stock`,
      [limit],
    );
    return rows;
  }

  async dbNow(): Promise<Date> {
    const { rows } = await this.pool.query<{ now: Date }>('SELECT clock_timestamp() AS now');
    return rows[0].now;
  }

  async countPendingBefore(productId: number, before: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM orders WHERE product_id = $1 AND status = 'PENDING' AND created_at < $2`,
      [productId, before],
    );
    return rows[0].n;
  }

  async rejectPendingBefore(productId: number, before: Date): Promise<number> {
    const { rowCount } = await this.pool.query(
      `UPDATE orders SET status = 'REJECTED', updated_at = clock_timestamp()
       WHERE product_id = $1 AND status = 'PENDING' AND created_at < $2`,
      [productId, before],
    );
    return rowCount ?? 0;
  }

  // So luong con ban duoc tinh tu DB, doc trong cung mot snapshot:
  //   available = products.stock - (RESERVED chua cong don) + (CANCELLED da cong don nhung chua hoan)
  async snapshotForRebuild(productId: number): Promise<{ available: number; cancelledIds: string[] } | null> {
    return this.tx(async (client) => {
      const { rows } = await client.query<{ available: number }>(
        `SELECT p.stock
           - COALESCE(SUM(o.qty) FILTER (WHERE o.status = 'RESERVED' AND NOT o.stock_applied), 0)
           + COALESCE(SUM(o.qty) FILTER (WHERE o.status = 'CANCELLED' AND o.stock_applied), 0) AS available
         FROM products p LEFT JOIN orders o ON o.product_id = p.id
         WHERE p.id = $1 GROUP BY p.id`,
        [productId],
      );
      if (rows.length === 0) return null;
      const cancelled = await client.query<{ id: string }>(
        `SELECT id FROM orders WHERE product_id = $1 AND status = 'CANCELLED'`,
        [productId],
      );
      return { available: Number(rows[0].available), cancelledIds: cancelled.rows.map((r) => r.id) };
    }, 'REPEATABLE READ');
  }

  async stats(productId: number) {
    const { rows } = await this.pool.query(
      `SELECT p.initial_stock AS "initialStock", p.stock AS "dbStock",
         COALESCE(SUM(o.qty) FILTER (WHERE o.status = 'RESERVED'), 0)::int AS "soldQty",
         COALESCE(SUM(o.qty) FILTER (WHERE o.status = 'CANCELLED'), 0)::int AS "cancelledQty",
         COUNT(o.id) FILTER (WHERE o.status = 'RESERVED')::int AS "reservedOrders",
         COUNT(o.id) FILTER (WHERE o.status = 'REJECTED')::int AS "rejectedOrders",
         COUNT(o.id) FILTER (WHERE o.status = 'PENDING')::int AS "pendingOrders",
         COUNT(o.id) FILTER (WHERE (o.status = 'RESERVED' AND NOT o.stock_applied)
                              OR (o.status = 'CANCELLED' AND o.stock_applied))::int AS "unsyncedOrders"
       FROM products p LEFT JOIN orders o ON o.product_id = p.id
       WHERE p.id = $1 GROUP BY p.id`,
      [productId],
    );
    return rows[0] ?? null;
  }

  async resetCampaign(productId: number, stock: number): Promise<boolean> {
    return this.tx(async (client) => {
      await client.query('DELETE FROM orders WHERE product_id = $1', [productId]);
      const { rowCount } = await client.query(
        'UPDATE products SET initial_stock = $2, stock = $2 WHERE id = $1',
        [productId, stock],
      );
      return rowCount === 1;
    });
  }
}
