import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Transaction } from './entities/transaction.entity.js';

@Module({
  imports: [TypeOrmModule.forFeature([Transaction])],
  exports: [TypeOrmModule],
})
export class TransactionsModule {}
