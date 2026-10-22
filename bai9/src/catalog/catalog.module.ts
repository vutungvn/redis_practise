import { Module } from '@nestjs/common';
import { CatalogAdminService } from './catalog-admin.service';
import { CatalogController } from './catalog.controller';
import { CatalogRepository } from './catalog.repository';
import { CatalogService } from './catalog.service';
import { PriceService } from './price.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogRepository, CatalogService, CatalogAdminService, PriceService],
  exports: [CatalogAdminService],
})
export class CatalogModule {}
