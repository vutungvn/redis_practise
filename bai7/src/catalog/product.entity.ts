import { Brand, Category } from './catalog.constants';

export interface Product {
  id: number;
  name: string;
  category: Category;
  brand: Brand;
  price: number;
  stock: number;
  createdAt: string;
}

export interface CatalogPage {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  items: Product[];
  generatedAt: string;
}
