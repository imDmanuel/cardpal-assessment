import {
  Controller,
  Get,
  Query,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { AnalyticsService } from './analytics.service.js';
import { Roles } from '../../common/decorators/roles.decorator.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { Currency } from '../wallet/enums/currency.enum.js';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard.js';

@ApiTags('Analytics')
@ApiBearerAuth()
@Controller('analytics')
@UseGuards(JwtAuthGuard)
@Roles(UserRole.ADMIN)
export class AnalyticsController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get('fx-trends')
  @ApiOperation({ summary: 'Get historical FX rates (Admin Only)' })
  @ApiResponse({ status: 200, description: 'List of historical rates' })
  async getFxTrends(
    @Query('base') base: Currency,
    @Query('quote') quote: Currency,
    @Query('from') fromStr?: string,
    @Query('to') toStr?: string,
    @Query('limit') limitStr?: string,
  ) {
    if (!base || !quote) {
      throw new BadRequestException('Base and quote currencies are required');
    }

    const from = fromStr
      ? new Date(fromStr)
      : new Date(Date.now() - 24 * 60 * 60 * 1000);
    const to = toStr ? new Date(toStr) : new Date();
    const limit = limitStr ? parseInt(limitStr, 10) : 100;

    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      throw new BadRequestException('Invalid date format for from/to');
    }

    return this.analyticsService.getFxTrends(base, quote, from, to, limit);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Get high-level system activity (Admin Only)' })
  @ApiResponse({ status: 200, description: 'System activity summary' })
  async getActivitySummary() {
    return this.analyticsService.getActivitySummary();
  }
}
