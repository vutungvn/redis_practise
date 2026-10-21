import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class PlaceOrderDto {
  @IsInt()
  @Min(1)
  productId: number;

  @IsInt()
  @Min(1)
  @Max(5)
  qty: number;

  // Client tu sinh de gui lai an toan khi mat phan hoi (idempotent)
  @IsOptional()
  @IsUUID()
  orderId?: string;
}
