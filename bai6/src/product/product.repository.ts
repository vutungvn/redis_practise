import { Injectable } from '@nestjs/common';
import { Product } from './product.entity';

// Gia lap tang database (in-memory) co do tre va co the bat che do nem loi
@Injectable()
export class ProductRepository {
  private readonly products = new Map<string, Product>(
    Array.from({ length: 10 }, (_, i) => {
      const id = String(i + 1);
      return [id, { id, name: `Flash sale item ${id}`, price: 99000 * (i + 1), stock: 100 }];
    }),
  );

  latencyMs = 200;
  failQueries = false;
  queryCount = 0;
  private inFlight = 0;

  async findById(id: string): Promise<Product | null> {
    this.queryCount++;
    this.inFlight++;
    console.log(`[DB] findById(${id}) #${this.queryCount}, in-flight: ${this.inFlight}`);
    try {
      // Cang nhieu truy van dong thoi DB cang cham (moi truy van dang chay +15ms)
      const delay = this.latencyMs + (this.inFlight - 1) * 15;
      await new Promise((resolve) => setTimeout(resolve, delay));
      if (this.failQueries) throw new Error(`DB connection lost while reading product ${id}`);
      return this.products.get(id) ?? null;
    } finally {
      this.inFlight--;
    }
  }
}
