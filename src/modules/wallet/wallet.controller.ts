import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service.js';
import { FundWalletDto } from './dto/fund-wallet.dto.js';
import { ConvertCurrencyDto } from './dto/convert-currency.dto.js';
import { TradeCurrencyDto } from './dto/trade-currency.dto.js';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';
import { GetUser } from '../../common/decorators/get-user.decorator.js';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
@ApiTags('Wallet')
@ApiBearerAuth()
@Controller('wallet')
@UseGuards(JwtAuthGuard)
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Get()
  @ApiOperation({ summary: 'Get all wallet balances for the current user' })
  @ApiResponse({ status: 200, description: 'List of balances' })
  async getBalances(@GetUser('id') userId: string) {
    return this.walletService.getBalances(userId);
  }

  @Post('fund')
  @ApiOperation({ summary: 'Fund a wallet with a specific currency' })
  @ApiResponse({ status: 201, description: 'Wallet funded successfully' })
  @ApiResponse({
    status: 409,
    description: 'Duplicate transaction (Idempotency)',
  })
  async fundWallet(@GetUser('id') userId: string, @Body() dto: FundWalletDto) {
    return this.walletService.fundWallet(userId, dto);
  }

  @Post('convert')
  @ApiOperation({ summary: 'Convert between currencies' })
  @ApiResponse({ status: 201, description: 'Currency converted successfully' })
  @ApiResponse({
    status: 400,
    description: 'Insufficient balance or invalid request',
  })
  @ApiResponse({ status: 409, description: 'Duplicate transaction' })
  async convert(
    @GetUser('id') userId: string,
    @Body() dto: ConvertCurrencyDto,
  ) {
    return this.walletService.convert(userId, dto);
  }

  @Post('trade')
  @ApiOperation({ summary: 'Trade NGN ↔ foreign currency' })
  @ApiResponse({ status: 201, description: 'Trade successful' })
  @ApiResponse({
    status: 400,
    description: 'Invalid trade pair or insufficient balance',
  })
  @ApiResponse({ status: 409, description: 'Duplicate transaction' })
  async trade(@GetUser('id') userId: string, @Body() dto: TradeCurrencyDto) {
    return this.walletService.trade(userId, dto);
  }
}
