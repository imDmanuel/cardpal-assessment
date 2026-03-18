import {
  Injectable,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, FindManyOptions } from 'typeorm';
import { Transaction } from './entities/transaction.entity.js';
import { TransactionType } from './enums/transaction-type.enum.js';

@Injectable()
export class TransactionsService {
  private readonly logger = new Logger(TransactionsService.name);

  constructor(
    @InjectRepository(Transaction)
    private readonly transactionRepo: Repository<Transaction>,
  ) {}

  async findAll(
    userId: string,
    options: { page?: number; limit?: number; type?: TransactionType },
  ): Promise<{
    data: Transaction[];
    total: number;
    page: number;
    limit: number;
  }> {
    const { page = 1, limit = 10, type } = options;
    const skip = (page - 1) * limit;

    const where: FindManyOptions<Transaction>['where'] = { userId };
    if (type) {
      where.type = type;
    }

    try {
      const [data, total]: [Transaction[], number] =
        await this.transactionRepo.findAndCount({
          where,
          order: { createdAt: 'DESC' },
          skip,
          take: limit,
        });
      return { data, total, page, limit };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(
        `Failed to fetch transactions for ${userId}: ${message}`,
      );
      throw new InternalServerErrorException(
        'Failed to fetch transaction history',
      );
    }
  }
}
