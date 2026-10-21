export const CATEGORIES = ['phone', 'laptop', 'tablet', 'audio', 'watch'] as const;
export const BRANDS = ['apple', 'samsung', 'xiaomi', 'sony', 'asus', 'dell', 'lenovo', 'oppo'] as const;
export const SORTS = ['price_asc', 'price_desc', 'newest'] as const;

export type Category = (typeof CATEGORIES)[number];
export type Brand = (typeof BRANDS)[number];
export type Sort = (typeof SORTS)[number];

export const DEFAULT_SORT: Sort = 'newest';
export const PAGE_SIZE = 20;
export const MAX_PAGE = 500;
export const MAX_BRANDS_PER_QUERY = 5;
export const MAX_PRICE = 100_000_000;

// Chi cache 3 trang dau cua moi to hop loc
export const MAX_CACHED_PAGE = 3;
// Chi cache khoang gia theo buoc 100k (khop thanh truot gia tren UI);
// gia le (vd 123457) van tra ket qua nhung khong sinh khoa moi
export const CACHEABLE_PRICE_STEP = 100_000;

// Ton kho duoc tre toi da 60s -> TTL 50..60s (co do lech ngau nhien, khong vuot 60)
export const LIST_TTL_MIN_SECONDS = 50;
export const LIST_TTL_MAX_SECONDS = 60;

// Tran tong so khoa danh sach dang song trong cache
export const MAX_CACHE_KEYS = Number(process.env.CATALOG_MAX_KEYS ?? 2000);
