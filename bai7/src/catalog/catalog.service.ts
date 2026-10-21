import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { CatalogCacheService } from './catalog-cache.service';
import { buildListKey, isCacheablePriceRange, normalizeQuery } from './catalog-filter';
import { MAX_CACHED_PAGE } from './catalog.constants';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { CatalogPage } from './product.entity';
import { ProductRepository } from './product.repository';

export interface CacheInfo {
  status: 'HIT' | 'MISS' | 'BYPASS';
  key?: string;
  note?: string;
}

@Injectable()
export class CatalogService {
  constructor(
    private readonly repo: ProductRepository,
    private readonly cache: CatalogCacheService,
  ) {}

  async list(query: CatalogQueryDto): Promise<{ data: CatalogPage; cache: CacheInfo }> {
    const { filter, page } = normalizeQuery(query);
    if (filter.maxPrice !== null && filter.minPrice > filter.maxPrice) {
      throw new BadRequestException('minPrice must be less than or equal to maxPrice');
    }

    // Trang 4 tro di: it nguoi xem, truy van thang DB, khong sinh khoa
    if (page > MAX_CACHED_PAGE) {
      return { data: await this.repo.queryCatalog(filter, page), cache: { status: 'BYPASS', note: 'page>3' } };
    }
    // Khoang gia le: hop le nhung khong cache de chan sinh vo han to hop
    if (!isCacheablePriceRange(filter)) {
      return {
        data: await this.repo.queryCatalog(filter, page),
        cache: { status: 'BYPASS', note: 'price-not-on-step' },
      };
    }

    const key = buildListKey(filter, page);
    const cached = await this.cache.get(key);
    if (cached) return { data: cached, cache: { status: 'HIT', key } };

    const version = await this.cache.currentVersion(filter);
    const data = await this.repo.queryCatalog(filter, page);
    const stored = await this.cache.store(filter, page, data, version);
    return { data, cache: { status: 'MISS', key, note: stored === 'stored' ? undefined : `not-stored:${stored}` } };
  }

  async updateProduct(id: number, dto: UpdateProductDto) {
    if (dto.price === undefined && dto.stock === undefined) {
      throw new BadRequestException('Provide price and/or stock');
    }
    const before = await this.repo.findById(id);
    if (!before) throw new NotFoundException(`Product ${id} not found`);

    const product = (await this.repo.update(id, dto))!;
    const priceChanged = product.price !== before.price;
    const invalidatedKeys = priceChanged ? await this.cache.invalidateForPriceChange(product, before.price) : [];

    return {
      product,
      invalidatedKeys,
      // Ton kho khong vo hieu hoa ngay: cho phep tre <= 60s, TTL danh sach toi da 60s
      note: priceChanged ? 'price changed: affected lists invalidated immediately' : 'stock only: lists refresh within 60s (TTL)',
    };
  }
}
