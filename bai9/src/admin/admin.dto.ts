import { IsBoolean, IsInt, IsOptional, IsString, Length, Max, Min } from 'class-validator';

export class UpdateProductDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  name?: string;

  @IsOptional()
  @IsString()
  @Length(1, 5000)
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(1_000_000_000)
  price?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  stock?: number;
}

export class RenameCategoryDto {
  @IsString()
  @Length(1, 100)
  name: string;
}

export class ToggleCacheDto {
  @IsBoolean()
  enabled: boolean;
}
