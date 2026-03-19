import { ApiProperty } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, IsInt, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Currency } from '../../wallet/enums/currency.enum';

export class GetFxTrendsDto {
  @ApiProperty({
    enum: Currency,
    example: Currency.USD,
    description: 'Base currency',
  })
  @IsEnum(Currency)
  base: Currency;

  @ApiProperty({
    enum: Currency,
    example: Currency.NGN,
    description: 'Quote currency',
  })
  @IsEnum(Currency)
  quote: Currency;

  @ApiProperty({
    required: false,
    description: 'Start date (ISO string). Defaults to 24 hours ago.',
    example: '2026-03-17T00:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  from?: string;

  @ApiProperty({
    required: false,
    description: 'End date (ISO string). Defaults to now.',
    example: '2026-03-18T00:00:00.000Z',
  })
  @IsOptional()
  @IsString()
  to?: string;

  @ApiProperty({
    required: false,
    description: 'Limit the number of results.',
    default: 100,
    example: 50,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  limit?: number = 100;
}

