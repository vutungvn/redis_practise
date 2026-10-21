import { Injectable } from '@nestjs/common';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './product.entity';

// Gia lap tang database (in-memory) de tap trung vao tang cache
@Injectable()
export class ProductRepository {
  private readonly products = new Map<string, Product>([
    ['1', { id: '1', name: 'Tai nghe Bluetooth', price: 500000, updatedAt: new Date().toISOString() }],
    ['2', { id: '2', name: 'Ban phim co', price: 1200000, updatedAt: new Date().toISOString() }],
  ]);

  async findById(id: string): Promise<Product | null> {
    console.log(`[DB] findById(${id})`);
    return this.products.get(id) ?? null;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product | null> {
    const current = this.products.get(id);
    if (!current) return null;
    const updated: Product = { ...current, ...dto, updatedAt: new Date().toISOString() };
    this.products.set(id, updated);
    return updated;
  }
}
