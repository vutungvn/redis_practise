import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_PRICE } from '../catalog.constants';

export class UpdateProductDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;
}
