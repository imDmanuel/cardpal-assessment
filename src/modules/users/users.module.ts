import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { UsersService } from './users.service.js';
import { UsersController } from './users.controller.js';
import { UserSeedService } from './user-seed.service.js';
import { WalletModule } from '../wallet/wallet.module.js';

@Module({
  imports: [TypeOrmModule.forFeature([User]), WalletModule],
  controllers: [UsersController],
  providers: [UsersService, UserSeedService],
  exports: [UsersService],
})
export class UsersModule {}
