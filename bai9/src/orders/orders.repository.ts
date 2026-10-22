import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DbService } from '../infrastructure/database/db.service';
import { OrderItemDto } from './dto/place-order.dto';

export interface OrderSummary {
  id: number;
  status: string;
  createdAt: string;
  itemCount: number;
  total: number;
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly db: DbService) {}

  recentOrders(userId: number): Promise<OrderSummary[]> {
    return this.db.query<OrderSummary>(
      'user.recent_orders',
      `SELECT o.id::int, o.status, o.created_at AS "createdAt",
              SUM(oi.qty)::int AS "itemCount", SUM(oi.qty * oi.unit_price)::int AS total
       FROM orders o JOIN order_items oi ON oi.order_id = o.id
       WHERE o.user_id = $1
       GROUP BY o.id ORDER BY o.created_at DESC
       LIMIT 20`,
      [userId],
    );
  }

  // Checkout: gia va ton kho luon lay tu DB trong transaction, khong bao gio tu cache
  async placeOrder(userId: number, items: OrderItemDto[]) {
    return this.db.transaction('order.place', async (client) => {
      const lines: { productId: number; qty: number; unitPrice: number }[] = [];
      for (const item of [...items].sort((a, b) => a.productId - b.productId)) {
        const { rows } = await client.query<{ price: number }>(
          'UPDATE products SET stock = stock - $2 WHERE id = $1 AND stock >= $2 RETURNING price',
          [item.productId, item.qty],
        );
        if (rows.length === 0) {
          const exists = await client.query('SELECT 1 FROM products WHERE id = $1', [item.productId]);
          if (exists.rowCount === 0) throw new NotFoundException(`Product ${item.productId} not found`);
          throw new ConflictException(`Product ${item.productId} is out of stock`);
        }
        lines.push({ productId: item.productId, qty: item.qty, unitPrice: rows[0].price });
      }
      const { rows } = await client.query<{ id: string }>('INSERT INTO orders (user_id) VALUES ($1) RETURNING id', [userId]);
      const orderId = Number(rows[0].id);
      for (const line of lines) {
        await client.query('INSERT INTO order_items (order_id, product_id, qty, unit_price) VALUES ($1, $2, $3, $4)', [
          orderId,
          line.productId,
          line.qty,
          line.unitPrice,
        ]);
      }
      return { orderId, lines, total: lines.reduce((sum, l) => sum + l.qty * l.unitPrice, 0) };
    });
  }
}
