import { Controller, Get, Param, ParseIntPipe, Res } from '@nestjs/common';
import type { Response } from 'express';
import { writeCacheTrace } from '../common/cache-trace';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('categories')
  async categories(@Res({ passthrough: true }) res: Response) {
    const { data, trace } = await this.catalog.listCategories();
    writeCacheTrace(res, trace);
    return data;
  }

  @Get('categories/:slug/top-sellers')
  async topSellers(@Param('slug') slug: string, @Res({ passthrough: true }) res: Response) {
    const { data, trace } = await this.catalog.topSellers(slug);
    writeCacheTrace(res, trace);
    return data;
  }

  @Get('products/:id')
  async product(@Param('id', ParseIntPipe) id: number, @Res({ passthrough: true }) res: Response) {
    const { data, trace } = await this.catalog.getProduct(id);
    writeCacheTrace(res, trace);
    return data;
  }
}
