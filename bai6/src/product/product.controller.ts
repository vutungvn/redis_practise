import { Controller, Get, Param } from '@nestjs/common';
import { ProductService } from './product.service';

@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.productService.getProductWithLock(id);
  }

  @Get(':id/no-lock')
  findOneWithoutLock(@Param('id') id: string) {
    return this.productService.getProductWithoutLock(id);
  }
}
