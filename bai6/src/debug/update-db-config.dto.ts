import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

export class UpdateDbConfigDto {
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(30000)
  latencyMs?: number;

  @IsOptional()
  @IsBoolean()
  failQueries?: boolean;
}
