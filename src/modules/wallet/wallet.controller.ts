import { Controller, Get, Post, Body, UseGuards } from '@nestjs/common';
import { WalletService } from './wallet.service.js';
import { FundWalletDto } from './dto/fund-wallet.dto.js';
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
}
