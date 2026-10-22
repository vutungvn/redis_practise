export interface Category {
  id: number;
  slug: string;
  name: string;
  productCount: number;
}

// Noi dung san pham duoc cache - co chu y KHONG co gia
export interface ProductContent {
  id: number;
  name: string;
  description: string;
  specs: Record<string, unknown>;
  category: string;
  brand: string;
  rating: number | null;
  reviewCount: number;
}

export interface LivePrice {
  price: number;
  priceVersion: number;
}

export interface TopSeller {
  productId: number;
  sold: number;
}
