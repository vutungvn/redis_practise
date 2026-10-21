import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import {
  BRANDS,
  CATEGORIES,
  MAX_BRANDS_PER_QUERY,
  MAX_PAGE,
  MAX_PRICE,
  SORTS,
  type Category,
  type Sort,
} from '../catalog.constants';

const toLowerTrim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim().toLowerCase() : value;

// Chap nhan ca ?brand=apple,sony lan ?brand=apple&brand=sony
const toBrandList = ({ value }: { value: unknown }) =>
  ([] as unknown[])
    .concat(value)
    .flatMap((v) => (typeof v === 'string' ? v.split(',') : [v]))
    .map((v) => (typeof v === 'string' ? v.trim().toLowerCase() : v))
    .filter((v) => v !== '');

// ''/thieu -> undefined; mang (tham so lap lai) -> NaN de bi tu choi
const toInt = ({ value }: { value: unknown }) =>
  value === undefined || value === '' ? undefined : Number(value);

export class CatalogQueryDto {
  @IsOptional()
  @Transform(toLowerTrim)
  @IsIn(CATEGORIES)
  category?: Category;

  @IsOptional()
  @Transform(toBrandList)
  @IsArray()
  @ArrayMaxSize(MAX_BRANDS_PER_QUERY)
  @IsIn(BRANDS, { each: true })
  brand?: string[];

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  minPrice?: number;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(0)
  @Max(MAX_PRICE)
  maxPrice?: number;

  @IsOptional()
  @Transform(toLowerTrim)
  @IsIn(SORTS)
  sort?: Sort;

  @IsOptional()
  @Transform(toInt)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE)
  page?: number;
}
