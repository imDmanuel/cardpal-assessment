import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Wallet } from './entities/wallet.entity.js';
import { WalletController } from './wallet.controller.js';
import { WalletService } from './wallet.service.js';
import { FxModule } from '../fx/fx.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([Wallet]), FxModule],
  providers: [WalletService],
  controllers: [WalletController],
  exports: [WalletService],
})
export class WalletModule {}
