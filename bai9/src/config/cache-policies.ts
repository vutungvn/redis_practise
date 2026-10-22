// Chinh sach luu dem cho tung loai du lieu: MOT noi duy nhat quyet dinh khoa, TTL va cach vo hieu hoa.
// Tang nghiep vu chi goi CacheService theo CacheType, khong biet gi ve Redis hay TTL.

export enum CacheType {
  STATIC = 'static',
  PRODUCT = 'product',
  STOCK = 'stock',
  USER_ORDERS = 'user_orders',
  AGGREGATE = 'aggregate',
  PRICE = 'price',
}

export interface CachePolicy {
  type: CacheType;
  dataKind: string;
  cacheable: boolean;
  /** Mau khoa Redis */
  keyPattern: string;
  key: (id: string) => string;
  ttlSeconds: number;
  /** TTL thuc te = ttl * (1 +/- jitter) de cac khoa khong het han cung luc */
  jitterRatio: number;
  /** Cache trong bo nho tien trinh (L1) truoc Redis */
  localTtlMs?: number;
  /** Khoa phan tan chong don dap khi dung lai gia tri dat */
  stampedeLock?: boolean;
  /** Xoa lan 2 sau khoang tre de chan request doc cu ghi de len sau khi da xoa */
  doubleDeleteMs?: number;
  invalidation: string;
  rationale: string;
}

const PREFIX = 'sf:v1';

export const CACHE_POLICIES: Record<CacheType, CachePolicy> = {
  [CacheType.STATIC]: {
    type: CacheType.STATIC,
    dataKind: 'Hau nhu khong doi (danh muc)',
    cacheable: true,
    keyPattern: `${PREFIX}:static:{name}`,
    key: (name) => `${PREFIX}:static:${name}`,
    ttlSeconds: 24 * 3600,
    jitterRatio: 0.1,
    localTtlMs: 30_000,
    invalidation: 'Admin sua danh muc -> DEL khoa Redis + xoa L1 cua instance; instance khac het L1 sau <= 30s',
    rationale: 'Doi vai lan/thang, doc o moi trang. L1 trong bo nho tranh ca vong mang toi Redis va van phuc vu khi Redis sap',
  },
  [CacheType.PRODUCT]: {
    type: CacheType.PRODUCT,
    dataKind: 'Noi dung san pham (ten, mo ta, thong so, danh gia) - KHONG chua gia',
    cacheable: true,
    keyPattern: `${PREFIX}:product:{id}`,
    key: (id) => `${PREFIX}:product:${id}`,
    ttlSeconds: 3600,
    jitterRatio: 0.1,
    doubleDeleteMs: 500,
    invalidation: 'Sua noi dung san pham -> DEL sau commit + DEL lan 2 sau 500ms; Redis loi -> xep hang xoa lai',
    rationale: 'Doc rat nhieu, sua it; truy van join + tong hop danh gia. Tre vai ms sau khi sua noi dung la chap nhan duoc',
  },
  [CacheType.STOCK]: {
    type: CacheType.STOCK,
    dataKind: 'Doi thuong xuyen (ton kho hien thi)',
    cacheable: true,
    keyPattern: `${PREFIX}:stock:{id}`,
    key: (id) => `${PREFIX}:stock:${id}`,
    ttlSeconds: 10,
    jitterRatio: 0.2,
    invalidation: 'Chu yeu theo TTL (<= 12s); DEL khi admin sua ton kho hoac don hang cua chinh request nay tru kho',
    rationale: 'Doi theo tung don hang: xoa moi lan doi se lam hit-rate ve 0. Hien thi duoc tre vai giay vi checkout luon kiem tra ton kho trong DB',
  },
  [CacheType.USER_ORDERS]: {
    type: CacheType.USER_ORDERS,
    dataKind: 'Rieng tung nguoi dung (lich su don hang)',
    cacheable: true,
    keyPattern: `${PREFIX}:user:{userId}:orders`,
    key: (userId) => `${PREFIX}:user:${userId}:orders`,
    ttlSeconds: 300,
    jitterRatio: 0.1,
    invalidation: 'Nguoi dung dat don moi -> DEL khoa cua chinh nguoi do',
    rationale: 'So khoa = so nguoi dung dang hoat dong nen TTL ngan de tu giai phong bo nho; khoa luon chua userId lay tu xac thuc, khong bao gio dung chung',
  },
  [CacheType.AGGREGATE]: {
    type: CacheType.AGGREGATE,
    dataKind: 'Tong hop ton tai nguyen (top ban chay 7 ngay theo danh muc)',
    cacheable: true,
    keyPattern: `${PREFIX}:agg:top-sellers:{category}`,
    key: (category) => `${PREFIX}:agg:top-sellers:${category}`,
    ttlSeconds: 300,
    jitterRatio: 0.1,
    stampedeLock: true,
    invalidation: 'Chi theo TTL (5 phut); chi luu danh sach id + so luong ban, gia/ton kho ghep luc tra ve',
    rationale: 'Quet ~300k dong don hang; bang xep hang tre 5 phut khong anh huong nghiep vu. Khoa phan tan de chi 1 request dung lai khi het han',
  },
  [CacheType.PRICE]: {
    type: CacheType.PRICE,
    dataKind: 'Gia - yeu cau chinh xac tuyet doi',
    cacheable: false,
    keyPattern: '(khong cache)',
    key: () => '',
    ttlSeconds: 0,
    jitterRatio: 0,
    invalidation: 'Khong can: luon doc tu DB',
    rationale: 'Moi chien luoc cache gia deu con cua so loi (race khi xoa, Redis sap luc doi gia, partition). Doc gia bang truy van khoa chinh theo lo (~0.3ms) loai bo hoan toan rui ro, chi phi DB khong dang ke so voi truy van nang da duoc cache',
  },
};
