import { Injectable } from '@nestjs/common';
import { DbService } from '../infrastructure/database/db.service';
import { Category, LivePrice, ProductContent, TopSeller } from './catalog.types';

export interface ProductUpdate {
  name?: string;
  description?: string;
  price?: number;
  stock?: number;
}

interface ProductRow {
  id: number;
  name: string;
  description: string;
  price: number;
  price_version: number;
  stock: number;
}

@Injectable()
export class CatalogRepository {
  constructor(private readonly db: DbService) {}

  listCategories(): Promise<Category[]> {
    return this.db.query<Category>(
      'categories.list',
      `SELECT c.id, c.slug, c.name, COUNT(p.id)::int AS "productCount"
       FROM categories c LEFT JOIN products p ON p.category_id = c.id
       GROUP BY c.id ORDER BY c.name`,
    );
  }

  async findContents(ids: number[]): Promise<Map<string, ProductContent>> {
    const rows = await this.db.query<ProductContent>(
      'product.content',
      `SELECT p.id, p.name, p.description, p.specs, c.slug AS category, b.name AS brand,
              r.rating::float AS rating, COALESCE(r.cnt, 0)::int AS "reviewCount"
       FROM products p
       JOIN categories c ON c.id = p.category_id
       JOIN brands b ON b.id = p.brand_id
       LEFT JOIN LATERAL (
         SELECT ROUND(AVG(rating)::numeric, 2) AS rating, COUNT(*) AS cnt FROM reviews WHERE product_id = p.id
       ) r ON true
       WHERE p.id = ANY($1::int[])`,
      [ids],
    );
    return new Map(rows.map((r) => [String(r.id), r]));
  }

  async findStocks(ids: number[]): Promise<Map<string, number>> {
    const rows = await this.db.query<{ id: number; stock: number }>(
      'product.stock',
      'SELECT id, stock FROM products WHERE id = ANY($1::int[])',
      [ids],
    );
    return new Map(rows.map((r) => [String(r.id), r.stock]));
  }

  // Truy van khoa chinh theo lo, nhe (~0.3ms) - nguon gia duy nhat cua he thong
  async findPrices(ids: number[]): Promise<Map<number, LivePrice>> {
    const rows = await this.db.query<{ id: number; price: number; price_version: number }>(
      'product.price',
      'SELECT id, price, price_version FROM products WHERE id = ANY($1::int[])',
      [ids],
    );
    return new Map(rows.map((r) => [r.id, { price: r.price, priceVersion: r.price_version }]));
  }

  // Truy van tong hop nang: quet don hang 7 ngay gan nhat cua mot danh muc
  topSellers(categoryId: number): Promise<TopSeller[]> {
    return this.db.query<TopSeller>(
      'aggregate.top_sellers',
      `SELECT oi.product_id AS "productId", SUM(oi.qty)::int AS sold
       FROM order_items oi
       JOIN orders o ON o.id = oi.order_id
       JOIN products p ON p.id = oi.product_id
       WHERE p.category_id = $1 AND o.status = 'PAID' AND o.created_at > now() - interval '7 days'
       GROUP BY oi.product_id
       ORDER BY sold DESC, oi.product_id
       LIMIT 10`,
      [categoryId],
    );
  }

  async updateProduct(id: number, update: ProductUpdate): Promise<{ before: ProductRow; after: ProductRow } | null> {
    return this.db.transaction('admin.update_product', async (client) => {
      const { rows } = await client.query<ProductRow>(
        'SELECT id, name, description, price, price_version, stock FROM products WHERE id = $1 FOR UPDATE',
        [id],
      );
      const before = rows[0];
      if (!before) return null;
      const priceChanged = update.price !== undefined && update.price !== before.price;
      const result = await client.query<ProductRow>(
        `UPDATE products SET
           name = COALESCE($2, name),
           description = COALESCE($3, description),
           price = COALESCE($4, price),
           price_version = price_version + $5,
           stock = COALESCE($6, stock),
           updated_at = now()
         WHERE id = $1
         RETURNING id, name, description, price, price_version, stock`,
        [id, update.name ?? null, update.description ?? null, update.price ?? null, priceChanged ? 1 : 0, update.stock ?? null],
      );
      return { before, after: result.rows[0] };
    });
  }

  async renameCategory(slug: string, name: string): Promise<boolean> {
    const rows = await this.db.query('admin.rename_category', 'UPDATE categories SET name = $2 WHERE slug = $1 RETURNING id', [
      slug,
      name,
    ]);
    return rows.length === 1;
  }
}
