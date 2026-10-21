import { createKeyv } from '@keyv/redis';
import { CacheModule } from '@nestjs/cache-manager';
import { Module } from '@nestjs/common';
import { ProductModule } from './product/product.module';

@Module({
  imports: [
    CacheModule.registerAsync({
      isGlobal: true,
      useFactory: () => ({
        stores: [createKeyv(process.env.REDIS_URL ?? 'redis://localhost:6380')],
      }),
    }),
    ProductModule,
  ],
})
export class AppModule {}
