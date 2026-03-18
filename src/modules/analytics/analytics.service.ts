import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { FxRate } from '../fx/entities/fx-rate.entity.js';
import { Transaction } from '../transactions/entities/transaction.entity.js';
import { User } from '../users/entities/user.entity.js';
import { Currency } from '../wallet/enums/currency.enum.js';
import { TransactionType } from '../transactions/enums/transaction-type.enum.js';

@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    @InjectRepository(FxRate)
    private readonly fxRateRepo: Repository<FxRate>,
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
  ) {}

  /**
   * Get historical FX rates for a pair within a date range.
   */
  async getFxTrends(
    base: Currency,
    quote: Currency,
    from: Date,
    to: Date,
    limit: number = 100,
  ): Promise<FxRate[]> {
    return this.fxRateRepo.find({
      where: {
        base,
        quote,
        fetchedAt: Between(from, to),
      },
      order: { fetchedAt: 'ASC' },
      take: limit,
    });
  }

  /**
   * Get a high-level summary of system activity.
   */
  async getActivitySummary() {
    const [transactions, totalTransactions] =
      await this.transactionRepo.findAndCount();

    const trades = transactions.filter(
      (t) =>
        t.type === TransactionType.TRADE || t.type === TransactionType.CONVERT,
    );

    const volumeByBase: Record<string, number> = {};
    const pairCounts: Record<string, number> = {};

    for (const t of trades) {
      // Aggregate volume by base currency
      const base = t.fromCurrency;
      const amount = Number(t.fromAmount); // Simple aggregation for MVP
      volumeByBase[base] = (volumeByBase[base] || 0) + amount;

      // Aggregate pair frequency
      const pair = `${t.fromCurrency}-${t.toCurrency}`;
      pairCounts[pair] = (pairCounts[pair] || 0) + 1;
    }

    const topTradedPairs = Object.entries(pairCounts)
      .map(([pair, count]) => {
        const [from, to] = pair.split('-');
        return { from: from as Currency, to: to as Currency, count };
      })
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const active24h = await this.userRepo.count({
      where: { lastActiveAt: MoreThanOrEqual(last24h) },
    });

    const active7d = await this.userRepo.count({
      where: { lastActiveAt: MoreThanOrEqual(last7d) },
    });

    return {
      totalTransactions,
      totalTrades: trades.length,
      totalVolumeByBaseCurrency: volumeByBase,
      topTradedPairs,
      activeUsersLast24h: active24h,
      activeUsersLast7d: active7d,
    };
  }
}
