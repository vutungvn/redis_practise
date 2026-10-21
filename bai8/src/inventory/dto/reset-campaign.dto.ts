import { IsInt, Max, Min } from 'class-validator';

export class ResetCampaignDto {
  @IsInt()
  @Min(0)
  @Max(1_000_000)
  stock: number;
}
