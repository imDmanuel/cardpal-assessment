import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ParseEnumPipe } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBearerAuth,
  ApiQuery,
} from '@nestjs/swagger';
import { FxService } from './fx.service';
import { Currency } from '../wallet/enums/currency.enum';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { FxRatesResponseDto } from './dto/fx-rates-response.dto';

@ApiTags('FX')
@ApiBearerAuth()
@Controller('fx')
@UseGuards(JwtAuthGuard)
export class FxController {
  constructor(private readonly fxService: FxService) {}

  @Get('rates')
  @ApiOperation({
    summary: 'Get live or cached exchange rates for a base currency',
  })
  @ApiResponse({ status: 200, type: FxRatesResponseDto })
  @ApiResponse({ status: 400, description: 'Invalid base currency' })
  @ApiResponse({
    status: 503,
    description: 'Service Unavailable (API down and no cache)',
  })
  @ApiQuery({ name: 'base', enum: Currency })
  async getRates(
    @Query('base', new ParseEnumPipe(Currency)) base: Currency,
  ): Promise<FxRatesResponseDto> {
    return this.fxService.getRates(base);
  }
}

