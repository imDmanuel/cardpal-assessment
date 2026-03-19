import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsNumber, IsPositive, IsEnum } from 'class-validator';
import { Currency } from '../enums/currency.enum';

export class FundWalletDto {
  @ApiProperty({ example: 1000, description: 'Amount to fund' })
  @IsNumber()
  @IsPositive()
  amount: number;

  @ApiProperty({ enum: Currency, example: Currency.NGN })
  @IsEnum(Currency, { message: 'Only NGN funding is allowed for now' })
  // For now, we restrict to NGN via the DTO as per requirements
  // but keep the service flexible by accepting the currency parameter.
  currency: Currency;

  @ApiProperty({ example: 'fund_123456789' })
  @IsNotEmpty()
  idempotencyKey: string;
}

