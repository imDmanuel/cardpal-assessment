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

export class ConvertCurrencyDto {
  @ApiProperty({ enum: Currency, example: Currency.NGN })
  @IsEnum(Currency)
  fromCurrency: Currency;

  @ApiProperty({ enum: Currency, example: Currency.USD })
  @IsEnum(Currency)
  toCurrency: Currency;

  @ApiProperty({ example: 1000 })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ example: 'conv_123456789' })
  @IsNotEmpty()
  idempotencyKey: string;

  @ValidateIf((o: ConvertCurrencyDto) => o.fromCurrency === o.toCurrency)
  @IsDefined({ message: 'Source and destination currencies must be different' })
  readonly sameCurrencyCheck?: never;
}
