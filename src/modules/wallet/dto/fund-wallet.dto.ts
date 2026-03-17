import { IsNotEmpty, IsNumber, IsPositive, IsEnum } from 'class-validator';
import { Currency } from '../enums/currency.enum.js';

export class FundWalletDto {
  @IsNumber()
  @IsPositive()
  amount: number;

  @IsEnum(Currency, { message: 'Only NGN funding is allowed for now' })
  // For now, we restrict to NGN via the DTO as per requirements
  // but keep the service flexible by accepting the currency parameter.
  currency: Currency;

  @IsNotEmpty()
  idempotencyKey: string;
}
