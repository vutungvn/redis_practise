import { Injectable, NotFoundException } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { CacheType } from '../config/cache-policies';
import { CatalogRepository, ProductUpdate } from './catalog.repository';

@Injectable()
export class CatalogAdminService {
  constructor(
    private readonly repo: CatalogRepository,
    private readonly cache: CacheService,
  ) {}

  async updateProduct(id: number, update: ProductUpdate) {
    const result = await this.repo.updateProduct(id, update);
    if (!result) throw new NotFoundException(`Product ${id} not found`);
    const { before, after } = result;

    // Vo hieu hoa SAU khi DB da commit
    const invalidated: string[] = [];
    if (after.name !== before.name || after.description !== before.description) {
      invalidated.push(...(await this.cache.invalidate(CacheType.PRODUCT, [String(id)])));
    }
    if (after.stock !== before.stock) {
      invalidated.push(...(await this.cache.invalidate(CacheType.STOCK, [String(id)])));
    }

    return {
      product: after,
      priceChanged: after.price !== before.price,
      invalidated,
      note: 'Gia khong nam trong cache nao nen khong can vo hieu hoa; request tiep theo doc gia moi tu DB',
    };
  }

  async renameCategory(slug: string, name: string) {
    if (!(await this.repo.renameCategory(slug, name))) throw new NotFoundException(`Category ${slug} not found`);
    const invalidated = await this.cache.invalidate(CacheType.STATIC, ['categories']);
    return { slug, name, invalidated };
  }
}
