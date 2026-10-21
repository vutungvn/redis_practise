import { Module } from '@nestjs/common';
import { CatalogModule } from './catalog/catalog.module';
import { DebugController } from './debug/debug.controller';
import { RedisModule } from './redis.module';

@Module({
  imports: [RedisModule, CatalogModule],
  controllers: [DebugController],
})
export class AppModule {}
