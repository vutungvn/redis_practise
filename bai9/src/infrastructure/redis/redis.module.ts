import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import Redis from 'ioredis';
import { CacheStore } from './cache-store';
import { REDIS_CLIENT } from './redis.constants';

const logger = new Logger('Redis');

@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6392', {
          // Redis khong san sang: loi ngay thay vi xep hang cho -> request chi cham di chut it
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
          commandTimeout: 100,
          retryStrategy: (times) => Math.min(times * 200, 2000),
        });
        let lastWarn = 0;
        redis.on('ready', () => logger.log('connected'));
        redis.on('error', (err) => {
          if (Date.now() - lastWarn > 5000) {
            lastWarn = Date.now();
            logger.warn(`unavailable: ${err.message || err.name}`);
          }
        });
        return redis;
      },
    },
    CacheStore,
  ],
  exports: [CacheStore],
})
export class RedisModule implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly redis: Redis) {}

  onApplicationShutdown() {
    this.redis.disconnect();
  }
}
