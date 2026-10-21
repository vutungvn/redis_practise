import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';

export const REDIS = Symbol('REDIS');

const logger = new Logger('Redis');

@Global()
@Module({
  providers: [
    {
      provide: REDIS,
      useFactory: () => {
        const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6391', {
          // Redis dang khoi dong lai -> lenh loi ngay de tra 503 trong ngan sach 500ms,
          // khong xep hang cho ket noi lai
          enableOfflineQueue: false,
          maxRetriesPerRequest: 1,
          commandTimeout: 200,
          // Khong tu gui lai lenh dang do khi mat ket noi: gui lai RESERVE co the tru kho 2 lan
          autoResendUnfulfilledCommands: false,
        });
        redis.on('ready', () => logger.log('connected'));
        redis.on('error', (err) => logger.warn(`connection error: ${err.message}`));
        return redis;
      },
    },
  ],
  exports: [REDIS],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async onApplicationShutdown() {
    await this.redis.quit().catch(() => undefined);
  }
}
