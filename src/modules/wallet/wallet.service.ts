import {
  Injectable,
  InternalServerErrorException,
  ConflictException,
  NotFoundException,
  Logger,
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

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepo: Repository<Wallet>,
    private readonly dataSource: DataSource,
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
      return repo.create({
        userId,
        currency,
        balance: new Decimal(0),
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
    const wallets = await this.walletRepo.find({
      where: { userId },
      order: { currency: 'ASC' },
    });

    return wallets.map((w) => ({
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
      const transaction = queryRunner.manager.create(Transaction, {
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

      const savedTx = await queryRunner.manager.save(transaction);

      // 3. SELECT FOR UPDATE on Wallet
      const wallet = await queryRunner.manager.findOne(Wallet, {
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
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Funding failed: ${message}`, stack);
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
