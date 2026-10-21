import { CACHEABLE_PRICE_STEP, DEFAULT_SORT, type Brand, type Category, type Sort } from './catalog.constants';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { Product } from './product.entity';

// Dang chuan cua bo loc: hai query cung noi dung luon cho ra cung mot CatalogFilter
export interface CatalogFilter {
  category: Category | null;
  brands: Brand[];
  minPrice: number;
  maxPrice: number | null;
  sort: Sort;
}

export const LIST_KEY_PREFIX = 'shopfast:catalog:list:';
const LIST_KEY_PATTERN =
  /^shopfast:catalog:list:cat=([a-z_]+):brand=([a-z,_]+):price=(\d+)-(\d+|max):sort=([a-z_]+):page=(\d+)$/;

export function normalizeQuery(query: CatalogQueryDto): { filter: CatalogFilter; page: number } {
  return {
    filter: {
      category: query.category ?? null,
      // Sap xep + bo trung: "samsung,apple,apple" == "apple,samsung"
      brands: [...new Set(query.brand ?? [])].sort() as Brand[],
      // Thieu minPrice tuong duong minPrice=0 (gia khong am)
      minPrice: query.minPrice ?? 0,
      maxPrice: query.maxPrice ?? null,
      sort: query.sort ?? DEFAULT_SORT,
    },
    page: query.page ?? 1,
  };
}

// Thu tu cac truong trong khoa co dinh, khong phu thuoc thu tu tham so tren URL
export function buildListKey(filter: CatalogFilter, page: number): string {
  return (
    `${LIST_KEY_PREFIX}cat=${filter.category ?? '_all'}` +
    `:brand=${filter.brands.join(',') || '_all'}` +
    `:price=${filter.minPrice}-${filter.maxPrice ?? 'max'}` +
    `:sort=${filter.sort}:page=${page}`
  );
}

export function parseListKey(key: string): { filter: CatalogFilter; page: number } | null {
  const m = LIST_KEY_PATTERN.exec(key);
  if (!m) return null;
  return {
    filter: {
      category: m[1] === '_all' ? null : (m[1] as Category),
      brands: m[2] === '_all' ? [] : (m[2].split(',') as Brand[]),
      minPrice: Number(m[3]),
      maxPrice: m[4] === 'max' ? null : Number(m[4]),
      sort: m[5] as Sort,
    },
    page: Number(m[6]),
  };
}

// Nhom vo hieu hoa: moi khoa thuoc nhom danh muc cua no ("_all" neu khong loc danh muc)
export function scopeOf(filter: CatalogFilter): string {
  return filter.category ?? '_all';
}

export function isCacheablePriceRange(filter: CatalogFilter): boolean {
  return (
    filter.minPrice % CACHEABLE_PRICE_STEP === 0 &&
    (filter.maxPrice === null || filter.maxPrice % CACHEABLE_PRICE_STEP === 0)
  );
}

export function matchesFilter(filter: CatalogFilter, product: Product, price = product.price): boolean {
  return (
    (filter.category === null || filter.category === product.category) &&
    (filter.brands.length === 0 || filter.brands.includes(product.brand)) &&
    price >= filter.minPrice &&
    (filter.maxPrice === null || price <= filter.maxPrice)
  );
}
