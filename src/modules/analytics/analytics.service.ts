import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, Between, MoreThanOrEqual } from 'typeorm';
import { FxRate } from '../fx/entities/fx-rate.entity';
import { Transaction } from '../transactions/entities/transaction.entity';
import { User } from '../users/entities/user.entity';
import { Currency } from '../wallet/enums/currency.enum';
import { TransactionType } from '../transactions/enums/transaction-type.enum';

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
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const last7d = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

    const [totalTransactions, totalTrades, tradeStats, active24h, active7d] =
      await Promise.all([
        // 1. Total transaction count — no data loading
        this.transactionRepo.count(),

        // 2. Trade + conversion count — filtered count, no data loading
        this.transactionRepo.count({
          where: [
            { type: TransactionType.TRADE },
            { type: TransactionType.CONVERT },
          ],
        }),

        // 3. Single query replaces volume and top pairs queries
        this.transactionRepo
          .createQueryBuilder('t')
          .select('t.fromCurrency', 'from')
          .addSelect('t.toCurrency', 'to')
          .addSelect('SUM(t.fromAmount)', 'volume')
          .addSelect('COUNT(*)', 'count')
          .where('t.type IN (:...types)', {
            types: [TransactionType.TRADE, TransactionType.CONVERT],
          })
          .groupBy('t.fromCurrency')
          .addGroupBy('t.toCurrency')
          .getRawMany<{
            from: Currency;
            to: Currency;
            volume: string;
            count: string;
          }>(),

        // 4. Active user counts (24h)
        this.userRepo.count({
          where: { lastActiveAt: MoreThanOrEqual(last24h) },
        }),

        // 5. Active user counts (7d)
        this.userRepo.count({
          where: { lastActiveAt: MoreThanOrEqual(last7d) },
        }),
      ]);

    // Shape the volume results — sum by fromCurrency across all targets
    const totalVolumeByBaseCurrency = tradeStats.reduce(
      (acc, row) => {
        const from = row.from;
        acc[from] = (acc[from] || 0) + Number(row.volume);
        return acc;
      },
      {} as Record<Currency, number>,
    );

    // Shape the top pairs results — sort and slice the same dataset
    const topTradedPairs = [...tradeStats]
      .sort((a, b) => Number(b.count) - Number(a.count))
      .slice(0, 5)
      .map((p) => ({
        from: p.from,
        to: p.to,
        count: Number(p.count),
      }));

    return {
      totalTransactions,
      totalTrades,
      totalVolumeByBaseCurrency,
      topTradedPairs,
      activeUsersLast24h: active24h,
      activeUsersLast7d: active7d,
    };
  }
}

