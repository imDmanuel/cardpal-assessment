import {
  Injectable,
  OnApplicationBootstrap,
  Logger,
  Inject,
} from '@nestjs/common';
import { type ConfigType } from '@nestjs/config';
import appConfig from '../../common/config/app.config';
import { UsersService } from './users.service';
import { WalletService } from '../wallet/wallet.service';
import { User } from './entities/user.entity';
import { UserRole } from './enums/user-role.enum';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcrypt';

@Injectable()
export class UserSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(UserSeedService.name);

  constructor(
    @Inject(appConfig.KEY)
    private readonly appCfg: ConfigType<typeof appConfig>,
    private readonly usersService: UsersService,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  async onApplicationBootstrap() {
    const {
      seedAdmin,
      adminEmail: email,
      adminPassword: password,
    } = this.appCfg;
    if (!seedAdmin) return;

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

