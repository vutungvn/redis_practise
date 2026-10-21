import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Cache } from 'cache-manager';
import { UpdateProductDto } from './dto/update-product.dto';
import { Product } from './product.entity';
import { ProductRepository } from './product.repository';

@Injectable()
export class ProductService {
  // Thoi gian song cua ban ghi dem (cache-manager v7 tinh bang mili giay)
  private static readonly CACHE_TTL_MS = 5 * 60 * 1000;

  constructor(
    @Inject(CACHE_MANAGER) private cache: Cache,
    private repo: ProductRepository,
  ) {}

  // Moi san pham mot khoa rieng: product:1, product:2, ...
  private cacheKey(id: string) {
    return `product:${id}`;
  }

  async findOne(id: string): Promise<Product> {
    const key = this.cacheKey(id);
    const cached = await this.cache.get<Product>(key);
    if (cached) return cached;

    const product = await this.repo.findById(id);
    // Khong dua null vao cache, tra 404 thay vi 200 rong
    if (!product) throw new NotFoundException(`Product ${id} not found`);

    await this.cache.set(key, product, ProductService.CACHE_TTL_MS);
    return product;
  }

  async update(id: string, dto: UpdateProductDto): Promise<Product> {
    const updated = await this.repo.update(id, dto);
    if (!updated) throw new NotFoundException(`Product ${id} not found`);

    // Ghi DB xong moi xoa cache -> lan doc tiep theo lay gia moi tu DB
    await this.cache.del(this.cacheKey(id));
    return updated;
  }
}
