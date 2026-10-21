import { Module } from '@nestjs/common';
import { CatalogCacheService } from './catalog-cache.service';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { ProductRepository } from './product.repository';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService, CatalogCacheService, ProductRepository],
  exports: [ProductRepository],
})
export class CatalogModule {}
