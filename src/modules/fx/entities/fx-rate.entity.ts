import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  UpdateDateColumn,
  CreateDateColumn,
  Unique,
  Index,
} from 'typeorm';
import Decimal from 'decimal.js';
import { Currency } from '../../wallet/enums/currency.enum.js';
import { DecimalTransformer } from '../../../common/transformers/decimal.transformer.js';

@Entity('fx_rates')
@Unique(['base', 'quote'])
export class FxRate {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({
    type: 'enum',
    enum: Currency,
  })
  @Index()
  base: Currency;

  @Column({
    type: 'enum',
    enum: Currency,
  })
  quote: Currency;

  @Column({
    type: 'decimal',
    precision: 18,
    scale: 8,
    transformer: DecimalTransformer,
  })
  rate: InstanceType<typeof Decimal>;

  @Column()
  fetchedAt: Date;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
