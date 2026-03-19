import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { TransactionsService } from './transactions.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { GetUser } from '../../common/decorators/get-user.decorator';
import { GetTransactionsDto } from './dto/get-transactions.dto';

@ApiTags('Transactions')
@ApiBearerAuth()
@Controller('transactions')
@UseGuards(JwtAuthGuard)
export class TransactionsController {
  constructor(private readonly transactionsService: TransactionsService) {}

  @Get()
  @ApiOperation({ summary: 'Get transaction history for the current user' })
  @ApiResponse({ status: 200, description: 'Paginated list of transactions' })
  async findAll(
    @GetUser('id') userId: string,
    @Query() dto: GetTransactionsDto,
  ) {
    return this.transactionsService.findAll(userId, dto);
  }
}

