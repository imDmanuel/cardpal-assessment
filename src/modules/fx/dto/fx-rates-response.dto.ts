import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../../wallet/enums/currency.enum';

export class FxRatesResponseDto {
  @ApiProperty({ enum: Currency, example: Currency.USD })
  base: Currency;

  @ApiProperty({
    example: {
      NGN: 1600.5,
      EUR: 0.92,
      GBP: 0.78,
    },
  })
  rates: Record<string, number>;

  @ApiProperty()
  fetchedAt: Date;

  @ApiProperty()
  stale: boolean;
}

