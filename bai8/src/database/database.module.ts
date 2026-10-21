import { Global, Inject, Logger, Module, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { Pool } from 'pg';

export const PG = Symbol('PG');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS products (
  id            INT PRIMARY KEY,
  name          TEXT NOT NULL,
  initial_stock INT NOT NULL CHECK (initial_stock >= 0),
  stock         INT NOT NULL CHECK (stock >= 0)
);

-- So cai don hang: moi lan tru kho la 1 dong rieng (INSERT, khong tranh chap dong nong)
-- stock_applied = luong tru cua don nay da duoc cong don vao products.stock hay chua
CREATE TABLE IF NOT EXISTS orders (
  id            UUID PRIMARY KEY,
  product_id    INT NOT NULL REFERENCES products(id),
  qty           INT NOT NULL CHECK (qty > 0),
  status        TEXT NOT NULL CHECK (status IN ('PENDING', 'RESERVED', 'REJECTED', 'CANCELLED')),
  stock_applied BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp()
);

CREATE INDEX IF NOT EXISTS orders_unsynced_idx ON orders (created_at)
  WHERE (status = 'RESERVED' AND NOT stock_applied) OR (status = 'CANCELLED' AND stock_applied);
CREATE INDEX IF NOT EXISTS orders_pending_idx ON orders (product_id, created_at) WHERE status = 'PENDING';
CREATE INDEX IF NOT EXISTS orders_product_idx ON orders (product_id, status);

INSERT INTO products (id, name, initial_stock, stock) VALUES
  (1, 'Flash sale iPhone 16', 100, 100),
  (2, 'Flash sale AirPods 4', 3000, 3000)
ON CONFLICT (id) DO NOTHING;
`;

@Global()
@Module({
  providers: [
    {
      provide: PG,
      useFactory: () =>
        new Pool({
          connectionString: process.env.DATABASE_URL ?? 'postgres://shopfast:shopfast@localhost:5441/inventory',
          max: 30,
        }),
    },
  ],
  exports: [PG],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(@Inject(PG) private readonly pool: Pool) {}

  async onModuleInit() {
    await this.pool.query(SCHEMA);
    this.logger.log('schema ready');
  }

  async onApplicationShutdown() {
    await this.pool.end();
  }
}
