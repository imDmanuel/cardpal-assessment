import {
  Injectable,
  Logger,
  ServiceUnavailableException,
  Inject,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { type ConfigType } from '@nestjs/config';
import Decimal from 'decimal.js';
import fxConfig from '../../common/config/fx.config.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { FxRate } from './entities/fx-rate.entity.js';
import { Currency } from '../wallet/enums/currency.enum.js';
import { type IFxRatesResponse } from './interfaces/fx-rate.interface.js';
import { EXCHANGE_RATE_PROVIDER } from './constants/fx.constants.js';
import { type IExchangeRateProvider } from './interfaces/exchange-rate-provider.interface.js';

interface CachedFxData {
  rates: Record<string, number>;
  fetchedAt: string;
}

@Injectable()
export class FxService {
  private readonly logger = new Logger(FxService.name);
  private readonly CACHE_KEY_PREFIX = 'fx:rates:';
  private readonly CACHE_TTL_SECONDS = 900; // 15 minutes

  constructor(
    @InjectRepository(FxRate)
    private readonly fxRateRepo: Repository<FxRate>,
    private readonly redis: RedisService,
    @Inject(fxConfig.KEY)
    private readonly fxCfg: ConfigType<typeof fxConfig>,
    @Inject(EXCHANGE_RATE_PROVIDER)
    private readonly provider: IExchangeRateProvider,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Get rates for display purposes.
   * Allows falling back to stale DB data if API is down.
   */
  async getRates(base: Currency): Promise<IFxRatesResponse> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${base}`;

    // 1. Try Cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      this.logger.debug(`Cache hit for ${base}`);
      const data = JSON.parse(cached) as CachedFxData;
      return {
        base,
        rates: data.rates,
        fetchedAt: new Date(data.fetchedAt),
        stale: false,
      };
    }

    // 2. Try Provider (API)
    try {
      const rates = await this.provider.getLatestRates(base);
      const fetchedAt = new Date();

      // Async: Update Cache & DB (don't block response)
      this.updatePersistedRates(base, rates, fetchedAt).catch((err: Error) =>
        this.logger.error(
          `Failed to persist rates for ${base}: ${err.message}`,
          err.stack,
        ),
      );

      return {
        base,
        rates,
        fetchedAt,
        stale: false,
      };
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `API Fetch failed for ${base}: ${errorMessage}. Falling back to DB...`,
        error instanceof Error ? error.stack : undefined,
      );

      // 3. Fallback to DB (Stale data)
      // Efficiently fetch the latest rate for each unique quote currency for the base
      const persistedRates = await this.fxRateRepo
        .createQueryBuilder('rate')
        .where('rate.base = :base', { base })
        .distinctOn(['rate.quote'])
        .orderBy('rate.quote')
        .addOrderBy('rate.fetchedAt', 'DESC')
        .getMany();

      if (persistedRates.length > 0) {
        const rates: Partial<Record<Currency, number>> = {};
        let latestFetch = persistedRates[0].fetchedAt;

        for (const record of persistedRates) {
          const decimalRate = record.rate as unknown as InstanceType<
            typeof Decimal
          >;
          rates[record.quote] = decimalRate.toNumber();
          if (record.fetchedAt > latestFetch) latestFetch = record.fetchedAt;
        }

        return {
          base,
          rates,
          fetchedAt: latestFetch,
          stale: true,
        };
      }

      // 4. No data at all
      this.logger.error(
        `No rates available for ${base} (Provider down and DB empty)`,
      );
      throw new ServiceUnavailableException(
        `Exchange rates for ${base} are currently unavailable`,
      );
    }
  }

  /**
   * Get a specific rate for mutations (convert/trade).
   * STRICT: Only returns fresh rates from Cache or Provider.
   * NEVER falls back to DB.
   */
  async getRateForMutation(base: Currency, quote: Currency): Promise<number> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${base}`;

    // 1. Try Cache
    const cached = await this.redis.get(cacheKey);
    if (cached) {
      const data = JSON.parse(cached) as CachedFxData;
      if (data.rates[quote]) return data.rates[quote];
    }

    // 2. Try Provider (API)
    try {
      const rates = await this.provider.getLatestRates(base);
      const fetchedAt = new Date();

      // Async: Update Cache & DB
      this.updatePersistedRates(base, rates, fetchedAt).catch((err: Error) =>
        this.logger.error(
          `Failed to persist rates for ${base}: ${err.message}`,
          err.stack,
        ),
      );

      if (rates[quote]) return rates[quote];
      throw new Error(`Rate not found for ${base}/${quote}`);
    } catch (error: unknown) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Mutation rate blocked: Provider unavailable or rate missing for ${base}/${quote}. Error: ${errorMessage}`,
        error instanceof Error ? error.stack : undefined,
      );
      throw new ServiceUnavailableException(
        `Real-time exchange rate for ${base}/${quote} is unavailable. Mutation aborted.`,
      );
    }
  }

  private async updatePersistedRates(
    base: Currency,
    rates: Record<string, number>,
    fetchedAt: Date,
  ): Promise<void> {
    const cacheKey = `${this.CACHE_KEY_PREFIX}${base}`;

    // Update Redis
    await this.redis.set(
      cacheKey,
      JSON.stringify({ rates, fetchedAt }),
      this.CACHE_TTL_SECONDS,
    );

    // Update DB (Upsert)
    const supportedCurrencies = Object.values(Currency);

    const entities = supportedCurrencies
      .filter((quote) => rates[quote] !== undefined)
      .map((quote) => {
        return this.fxRateRepo.create({
          base,
          quote,
          rate: new Decimal(rates[quote]),
          fetchedAt,
        });
      });

    if (entities.length > 0) {
      await this.fxRateRepo
        .createQueryBuilder()
        .insert()
        .into(FxRate)
        .values(entities)
        .execute();

      this.logger.debug(`Persisted ${entities.length} rates for ${base} to DB`);
    }
  }
}
