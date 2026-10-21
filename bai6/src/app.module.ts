import { Module } from '@nestjs/common';
import { DebugController } from './debug/debug.controller';
import { ProductModule } from './product/product.module';
import { RedisModule } from './redis.module';

@Module({
  imports: [RedisModule, ProductModule],
  controllers: [DebugController],
})
export class AppModule {}
