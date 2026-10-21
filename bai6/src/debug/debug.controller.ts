import { Body, Controller, Delete, Get, HttpCode, Inject, Param, Patch, Post } from '@nestjs/common';
import Redis from 'ioredis';
import { ProductRepository } from '../product/product.repository';
import { ProductService } from '../product/product.service';
import { REDIS } from '../redis.module';
import { UpdateDbConfigDto } from './update-db-config.dto';

// Endpoint ho tro do tai va mo phong su co, khong dung cho production
@Controller('debug')
export class DebugController {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    private readonly repo: ProductRepository,
  ) {}

  @Get('stats')
  stats() {
    return {
      dbQueries: this.repo.queryCount,
      latencyMs: this.repo.latencyMs,
      failQueries: this.repo.failQueries,
    };
  }

  @Post('stats/reset')
  @HttpCode(200)
  resetStats() {
    this.repo.queryCount = 0;
    return this.stats();
  }

  @Patch('db')
  updateDb(@Body() dto: UpdateDbConfigDto) {
    if (dto.latencyMs !== undefined) this.repo.latencyMs = dto.latencyMs;
    if (dto.failQueries !== undefined) this.repo.failQueries = dto.failQueries;
    return this.stats();
  }

  // Xem TTL cua cache va trang thai khoa phan tan
  @Get('cache/:id')
  async inspect(@Param('id') id: string) {
    const key = ProductService.cacheKey(id);
    const lockKey = ProductService.lockKey(id);
    const [ttl, lockValue, lockPttl] = await Promise.all([
      this.redis.ttl(key),
      this.redis.get(lockKey),
      this.redis.pttl(lockKey),
    ]);
    return { key, ttl, lock: { key: lockKey, holder: lockValue, pttl: lockPttl } };
  }

  // Mo phong khoa cache vua het han
  @Delete('cache/:id')
  async expire(@Param('id') id: string) {
    const key = ProductService.cacheKey(id);
    return { key, deleted: await this.redis.del(key) };
  }
}
