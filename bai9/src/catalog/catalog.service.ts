import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheService, CacheSource } from '../cache/cache.service';
import { CacheType } from '../config/cache-policies';
import { CatalogRepository } from './catalog.repository';
import { Category } from './catalog.types';
import { PriceService } from './price.service';

export type CacheTrace = Record<string, CacheSource | 'LIVE'>;

@Injectable()
export class CatalogService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly cache: CacheService,
    private readonly prices: PriceService,
  ) {}

  async listCategories(): Promise<{ data: Category[]; trace: CacheTrace }> {
    const { value, source } = await this.cache.getOrLoad(CacheType.STATIC, 'categories', () => this.repo.listCategories());
    return { data: value ?? [], trace: { static: source } };
  }

  async getProduct(id: number) {
    const key = String(id);
    const [content, stock, prices] = await Promise.all([
      this.cache.getOrLoad(CacheType.PRODUCT, key, async () => (await this.repo.findContents([id])).get(key) ?? null),
      this.cache.getOrLoad(CacheType.STOCK, key, async () => (await this.repo.findStocks([id])).get(key) ?? null),
      this.prices.getPrices([id]),
    ]);
    const price = prices.get(id);
    if (!content.value || !price) throw new NotFoundException(`Product ${id} not found`);

    return {
      data: { ...content.value, ...price, stock: stock.value ?? 0 },
      trace: { product: content.source, stock: stock.source, price: 'LIVE' } as CacheTrace,
    };
  }

  async topSellers(slug: string) {
    const categories = await this.listCategories();
    const category = categories.data.find((c) => c.slug === slug);
    if (!category) throw new NotFoundException(`Category ${slug} not found`);

    const ranking = await this.cache.getOrLoad(CacheType.AGGREGATE, slug, () => this.repo.topSellers(category.id));
    const entries = ranking.value ?? [];
    const ids = entries.map((e) => e.productId);
    const keys = ids.map(String);

    // Ghep noi dung (cache), ton kho (cache ngan) va gia (luon doc DB) cho tung san pham
    const [contents, stocks, prices] = await Promise.all([
      this.cache.getMany(CacheType.PRODUCT, keys, (missing) => this.repo.findContents(missing.map(Number))),
      this.cache.getMany(CacheType.STOCK, keys, (missing) => this.repo.findStocks(missing.map(Number))),
      this.prices.getPrices(ids),
    ]);

    const items = entries
      .filter((e) => contents.values.has(String(e.productId)) && prices.has(e.productId))
      .map((e, rank) => {
        const content = contents.values.get(String(e.productId))!;
        return {
          rank: rank + 1,
          sold7d: e.sold,
          id: e.productId,
          name: content.name,
          brand: content.brand,
          rating: content.rating,
          ...prices.get(e.productId)!,
          stock: stocks.values.get(String(e.productId)) ?? 0,
        };
      });

    return {
      data: { category: slug, items },
      trace: {
        static: categories.trace.static,
        aggregate: ranking.source,
        product: contents.source,
        stock: stocks.source,
        price: 'LIVE',
      } as CacheTrace,
    };
  }
}
