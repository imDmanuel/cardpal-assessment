import {
  Injectable,
  InternalServerErrorException,
  ConflictException,
  NotFoundException,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, EntityManager, DataSource } from 'typeorm';
import Decimal from 'decimal.js';
import { Wallet } from './entities/wallet.entity.js';
import { Currency } from './enums/currency.enum.js';
import { FundWalletDto } from './dto/fund-wallet.dto.js';
import { Transaction } from '../transactions/entities/transaction.entity.js';
import { TransactionType } from '../transactions/enums/transaction-type.enum.js';
import { TransactionStatus } from '../transactions/enums/transaction-status.enum.js';

import { TradeCurrencyDto } from './dto/trade-currency.dto.js';
import { ConvertCurrencyDto } from './dto/convert-currency.dto.js';
import { FxService } from '../fx/fx.service.js';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
    private readonly dataSource: DataSource,
    private readonly fxService: FxService,
  ) {}

  async createDefaultWallets(
    userId: string,
    manager?: EntityManager,
  ): Promise<void> {
    const repo = manager ? manager.getRepository(Wallet) : this.walletRepo;

    const existingCount = await repo.count({ where: { userId } });
    if (existingCount > 0) {
      return;
    }

    const currencies = Object.values(Currency);
    const wallets = currencies.map((currency) => {
      const isInitialNgn = currency === Currency.NGN;
      return repo.create({
        userId,
        currency,
        balance: isInitialNgn ? new Decimal(1000) : new Decimal(0),
      });
    });

    try {
      await repo.save(wallets);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to init wallets for ${userId}: ${message}`);
      throw new InternalServerErrorException('Failed to initialize wallets');
    }
  }

  async getBalances(
    userId: string,
  ): Promise<{ currency: Currency; balance: string }[]> {
    const wallets: Wallet[] = await this.walletRepo.find({
      where: { userId },
      order: { currency: 'ASC' },
    });

    return wallets.map((w: Wallet) => ({
      currency: w.currency,
      balance: w.balance.toString(),
    }));
  }

  async fundWallet(userId: string, dto: FundWalletDto): Promise<Transaction> {
    // 1. Early Idempotency Check (outside transaction)
    const existingTx = await this.dataSource.manager.findOne(Transaction, {
      where: { userId, idempotencyKey: dto.idempotencyKey },
    });

    if (existingTx) {
      throw new ConflictException('Duplicate transaction request');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 2. Create Transaction -> PENDING
      const amount = new Decimal(dto.amount);
      const transaction = queryRunner.manager.create<
        Transaction,
        Partial<Transaction>
      >(Transaction, {
        userId,
        type: TransactionType.FUND,
        status: TransactionStatus.PENDING,
        fromCurrency: dto.currency,
        toCurrency: dto.currency,
        fromAmount: amount,
        toAmount: amount,
        rate: null,
        idempotencyKey: dto.idempotencyKey,
      });

      const savedTx: Transaction = await queryRunner.manager.save(transaction);

      // 3. SELECT FOR UPDATE on Wallet
      const wallet: Wallet | null = await queryRunner.manager.findOne(Wallet, {
        where: { userId, currency: dto.currency },
        lock: { mode: 'pessimistic_write' },
      });

      if (!wallet) {
        throw new NotFoundException(
          `Wallet not found for currency ${dto.currency}`,
        );
      }

      // 4. Update Balance
      wallet.balance = wallet.balance.plus(amount);
      await queryRunner.manager.save(wallet);

      // 5. Update Transaction -> COMPLETED
      savedTx.status = TransactionStatus.COMPLETED;
      await queryRunner.manager.save(savedTx);

      await queryRunner.commitTransaction();
      return savedTx;
    } catch (error: unknown) {
      await queryRunner.rollbackTransaction();
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Funding failed: ${message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }

  async convert(userId: string, dto: ConvertCurrencyDto): Promise<Transaction> {
    return this.executeExchange(userId, {
      ...dto,
      type: TransactionType.CONVERT,
    });
  }

  async trade(userId: string, dto: TradeCurrencyDto): Promise<Transaction> {
    return this.executeExchange(userId, {
      ...dto,
      type: TransactionType.TRADE,
    });
  }

  private async executeExchange(
    userId: string,
    params: {
      fromCurrency: Currency;
      toCurrency: Currency;
      amount: number;
      idempotencyKey: string;
      type: TransactionType;
    },
  ): Promise<Transaction> {
    const { fromCurrency, toCurrency, amount, idempotencyKey, type } = params;

    // 0. Manual Validation Guards (Double check if DTO bypassed)
    if (fromCurrency === toCurrency) {
      throw new BadRequestException(
        'Source and destination currencies must be different',
      );
    }

    if (type === TransactionType.TRADE) {
      if (fromCurrency !== Currency.NGN && toCurrency !== Currency.NGN) {
        throw new BadRequestException(
          'A trade must involve NGN on at least one side',
        );
      }
    }

    // 1. Idempotency Check
    const existingTx = await this.dataSource.manager.findOne<Transaction>(
      Transaction,
      { where: { userId, idempotencyKey } },
    );
    if (existingTx) {
      throw new ConflictException('Duplicate transaction request');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      // 2. Create Transaction -> PENDING
      const fromAmountDecimal = new Decimal(amount);
      const transaction = queryRunner.manager.create<
        Transaction,
        Partial<Transaction>
      >(Transaction, {
        userId,
        type,
        status: TransactionStatus.PENDING,
        fromCurrency,
        toCurrency,
        fromAmount: fromAmountDecimal,
        toAmount: new Decimal(0), // Placeholder
        rate: null,
        idempotencyKey,
      });
      const savedTx: Transaction = await queryRunner.manager.save(transaction);

      // 3. Deadlock Prevention: Sort currencies for locking
      const [firstCurrency, secondCurrency] = [fromCurrency, toCurrency].sort();

      // Lock both wallets
      const wallets: Wallet[] = await queryRunner.manager.find(Wallet, {
        where: [
          { userId, currency: firstCurrency },
          { userId, currency: secondCurrency },
        ],
        lock: { mode: 'pessimistic_write' },
      });

      const fromWallet: Wallet | undefined = wallets.find(
        (w: Wallet) => w.currency === fromCurrency,
      );
      const toWallet: Wallet | undefined = wallets.find(
        (w: Wallet) => w.currency === toCurrency,
      );

      if (!fromWallet || !toWallet) {
        throw new NotFoundException('One or more wallets not found');
      }

      // 4. Balance Check
      if (fromWallet.balance.lessThan(fromAmountDecimal)) {
        throw new BadRequestException('Insufficient balance');
      }

      // 5. Fetch Rate (STRICT)
      const rateValue = await this.fxService.getRateForMutation(
        fromCurrency,
        toCurrency,
      );
      const rate = new Decimal(rateValue);

      // 6. Calculate toAmount
      const toAmountDecimal = fromAmountDecimal.times(rate);

      // 7. Execute Balance Changes
      fromWallet.balance = fromWallet.balance.minus(fromAmountDecimal);
      toWallet.balance = toWallet.balance.plus(toAmountDecimal);

      await queryRunner.manager.save([fromWallet, toWallet]);

      // 8. Finalize Transaction
      savedTx.toAmount = toAmountDecimal;
      savedTx.rate = rate;
      savedTx.status = TransactionStatus.COMPLETED;
      await queryRunner.manager.save(savedTx);

      await queryRunner.commitTransaction();
      return savedTx;
    } catch (error: unknown) {
      await queryRunner.rollbackTransaction();
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Exchange failed (${type}): ${message}`);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
