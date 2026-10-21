import { Injectable } from '@nestjs/common';
import { CatalogFilter, matchesFilter } from './catalog-filter';
import { BRANDS, CATEGORIES, PAGE_SIZE, type Category } from './catalog.constants';
import { UpdateProductDto } from './dto/update-product.dto';
import { CatalogPage, Product } from './product.entity';

const PRICE_RANGE: Record<Category, [number, number]> = {
  phone: [2_000_000, 35_000_000],
  laptop: [10_000_000, 60_000_000],
  tablet: [4_000_000, 30_000_000],
  audio: [300_000, 10_000_000],
  watch: [1_000_000, 20_000_000],
};

// Bo sinh so gia ngau nhien co seed -> du lieu giong nhau moi lan khoi dong
function seededRandom(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
}

// Gia lap tang database: truy van tong hop danh muc mat ~800ms
@Injectable()
export class ProductRepository {
  readonly aggregateLatencyMs = 800;
  catalogQueryCount = 0;
  private readonly products: Product[] = [];

  constructor() {
    const rand = seededRandom(2024);
    const start = Date.parse('2026-01-01T00:00:00Z');
    for (let id = 1; id <= 300; id++) {
      const category = CATEGORIES[Math.floor(rand() * CATEGORIES.length)];
      const brand = BRANDS[Math.floor(rand() * BRANDS.length)];
      const [lo, hi] = PRICE_RANGE[category];
      this.products.push({
        id,
        name: `${brand} ${category} ${id}`,
        category,
        brand,
        price: Math.round((lo + rand() * (hi - lo)) / 10_000) * 10_000,
        stock: Math.floor(rand() * 200),
        createdAt: new Date(start + id * 3_600_000).toISOString(),
      });
    }
  }

  async queryCatalog(filter: CatalogFilter, page: number): Promise<CatalogPage> {
    this.catalogQueryCount++;
    await new Promise((resolve) => setTimeout(resolve, this.aggregateLatencyMs));

    const rows = this.products.filter((p) => matchesFilter(filter, p));
    rows.sort((a, b) => {
      if (filter.sort === 'price_asc') return a.price - b.price || a.id - b.id;
      if (filter.sort === 'price_desc') return b.price - a.price || a.id - b.id;
      return b.createdAt.localeCompare(a.createdAt) || b.id - a.id;
    });

    const offset = (page - 1) * PAGE_SIZE;
    return {
      page,
      pageSize: PAGE_SIZE,
      total: rows.length,
      totalPages: Math.ceil(rows.length / PAGE_SIZE),
      items: rows.slice(offset, offset + PAGE_SIZE).map((p) => ({ ...p })),
      generatedAt: new Date().toISOString(),
    };
  }

  async findById(id: number): Promise<Product | null> {
    const product = this.products.find((p) => p.id === id);
    return product ? { ...product } : null;
  }

  async update(id: number, dto: UpdateProductDto): Promise<Product | null> {
    const product = this.products.find((p) => p.id === id);
    if (!product) return null;
    if (dto.price !== undefined) product.price = dto.price;
    if (dto.stock !== undefined) product.stock = dto.stock;
    return { ...product };
  }
}
