import { Body, Controller, Param, ParseIntPipe, Patch, Put } from '@nestjs/common';
import { CacheService } from '../cache/cache.service';
import { CatalogAdminService } from '../catalog/catalog-admin.service';
import { RenameCategoryDto, ToggleCacheDto, UpdateProductDto } from './admin.dto';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly catalogAdmin: CatalogAdminService,
    private readonly cache: CacheService,
  ) {}

  @Patch('products/:id')
  updateProduct(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.catalogAdmin.updateProduct(id, dto);
  }

  @Patch('categories/:slug')
  renameCategory(@Param('slug') slug: string, @Body() dto: RenameCategoryDto) {
    return this.catalogAdmin.renameCategory(slug, dto.name);
  }

  // Bat/tat tang cache luc chay de do hieu nang truoc/sau tren cung mot tien trinh
  @Put('cache')
  toggleCache(@Body() dto: ToggleCacheDto) {
    this.cache.setEnabled(dto.enabled);
    return { cacheEnabled: this.cache.isEnabled() };
  }
}
