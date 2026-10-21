import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { CatalogService } from './catalog.service';
import { CatalogQueryDto } from './dto/catalog-query.dto';
import { UpdateProductDto } from './dto/update-product.dto';

@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  async list(@Query() query: CatalogQueryDto, @Res({ passthrough: true }) res: Response) {
    const { data, cache } = await this.catalog.list(query);
    res.setHeader('X-Cache', cache.status);
    if (cache.key) res.setHeader('X-Cache-Key', cache.key);
    if (cache.note) res.setHeader('X-Cache-Note', cache.note);
    return data;
  }

  @Patch(':id')
  update(@Param('id', ParseIntPipe) id: number, @Body() dto: UpdateProductDto) {
    return this.catalog.updateProduct(id, dto);
  }
}
