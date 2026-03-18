import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
  Unique,
} from 'typeorm';
import Decimal from 'decimal.js';
import { TransactionType } from '../enums/transaction-type.enum.js';
import { TransactionStatus } from '../enums/transaction-status.enum.js';
import { Currency } from '../../wallet/enums/currency.enum.js';
import { DecimalTransformer } from '../../../common/transformers/decimal.transformer.js';

@Entity('transactions')
@Unique(['userId', 'idempotencyKey'])
export class Transaction {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column()
  @Index()
  userId: string;

  @Column({
    type: 'enum',
    enum: TransactionType,
  })
  @Index()
  type: TransactionType;

  @Column({
    type: 'enum',
    enum: TransactionStatus,
    default: TransactionStatus.PENDING,
  })
  status: TransactionStatus;

  @Column({
    type: 'enum',
    enum: Currency,
  })
  @Index()
  fromCurrency: Currency;

  @Column({
    type: 'enum',
    enum: Currency,
  })
  @Index()
  toCurrency: Currency;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 4,
    transformer: DecimalTransformer,
  })
  fromAmount: InstanceType<typeof Decimal>;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 4,
    transformer: DecimalTransformer,
  })
  toAmount: InstanceType<typeof Decimal>;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 8,
    nullable: true,
    transformer: DecimalTransformer,
  })
  rate: InstanceType<typeof Decimal> | null;

  @Column()
  idempotencyKey: string;

  @CreateDateColumn()
  createdAt: Date;
}
