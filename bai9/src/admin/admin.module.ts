import { Module } from '@nestjs/common';
import { CatalogModule } from '../catalog/catalog.module';
import { AdminController } from './admin.controller';

@Module({
  imports: [CatalogModule],
  controllers: [AdminController],
})
export class AdminModule {}
