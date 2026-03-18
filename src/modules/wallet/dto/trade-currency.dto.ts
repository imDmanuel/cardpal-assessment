import {
  IsNotEmpty,
  IsNumber,
  IsPositive,
  IsEnum,
  ValidateIf,
  IsDefined,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { Currency } from '../enums/currency.enum.js';

export class TradeCurrencyDto {
  @ApiProperty({ enum: Currency, example: Currency.NGN })
  @IsEnum(Currency)
  fromCurrency: Currency;

  @ApiProperty({ enum: Currency, example: Currency.USD })
  @IsEnum(Currency)
  toCurrency: Currency;

  @ApiProperty({ example: 100 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 'trade_123456789' })
  @IsNotEmpty()
  idempotencyKey: string;

  @ValidateIf(
    (o: TradeCurrencyDto) =>
      o.fromCurrency !== Currency.NGN && o.toCurrency !== Currency.NGN,
  )
  @IsDefined({ message: 'A trade must involve NGN on at least one side' })
  ngnPairCheck?: never;

  @ValidateIf((o: TradeCurrencyDto) => o.fromCurrency === o.toCurrency)
  @IsDefined({ message: 'Source and destination currencies must be different' })
  readonly sameCurrencyCheck?: never;
}
