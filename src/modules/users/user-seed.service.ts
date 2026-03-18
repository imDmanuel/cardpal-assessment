import { Injectable, OnApplicationBootstrap, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service.js';
import { WalletService } from '../wallet/wallet.service.js';
import { User } from './entities/user.entity.js';
import { UserRole } from './enums/user-role.enum.js';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UserSeedService.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap() {
    const seedAdmin = this.configService.get<boolean>('app.seedAdmin');
    if (!seedAdmin) return;

    const email = this.configService.get<string>('app.adminEmail');
    const password = this.configService.get<string>('app.adminPassword');

    if (!email || !password) {
      this.logger.warn(
        'Admin seeding skipped: email or password missing in config',
      );
      return;
    }

    const existingUser = await this.usersService.findByEmail(email);
    if (existingUser) {
      this.logger.log(`Admin user ${email} already exists. Skipping seed.`);
      return;
    }

    this.logger.log(`Seeding default admin user: ${email}`);

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const passwordHash = await bcrypt.hash(password, 10);

      const admin = await queryRunner.manager.save(
        queryRunner.manager.create(User, {
          email,
          passwordHash,
          name: 'System Admin',
          role: UserRole.ADMIN,
          isVerified: true,
        }),
      );

      // Create default wallets (USD, NGN, EUR, GBP)
      await this.walletService.createDefaultWallets(
        admin.id,
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
      this.logger.log(`Successfully seeded admin user: ${email}`);
    } catch (err) {
      await queryRunner.rollbackTransaction();
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(`Failed to seed admin user: ${message}`);
    } finally {
      await queryRunner.release();
    }
  }
}
