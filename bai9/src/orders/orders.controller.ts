import { Body, Controller, Get, Header, Post, Res } from '@nestjs/common';
import type { Response } from 'express';
import { writeCacheTrace } from '../common/cache-trace';
import { CurrentUser } from '../common/current-user.decorator';
import { PlaceOrderDto } from './dto/place-order.dto';
import { OrdersService } from './orders.service';

@Controller()
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  // Du lieu rieng: cam proxy/CDN luu lai
  @Get('me/orders')
  @Header('Cache-Control', 'private, no-store')
  async myOrders(@CurrentUser() userId: number, @Res({ passthrough: true }) res: Response) {
    const { data, trace } = await this.orders.myOrders(userId);
    writeCacheTrace(res, trace);
    return data;
  }

  @Post('orders')
  placeOrder(@CurrentUser() userId: number, @Body() dto: PlaceOrderDto) {
    return this.orders.placeOrder(userId, dto.items);
  }
}
