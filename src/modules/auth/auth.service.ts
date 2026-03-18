import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { type ConfigType } from '@nestjs/config';
import appConfig from '../../common/config/app.config.js';
import { UserRole } from '../users/enums/user-role.enum.js';
import { DataSource } from 'typeorm';
import { WalletService } from '../wallet/wallet.service.js';
import { RegisterDto } from './dto/register.dto.js';
import { LoginDto } from './dto/login.dto.js';
import { VerifyOtpDto } from './dto/verify-otp.dto.js';
import { ResendOtpDto } from './dto/resend-otp.dto.js';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly OTP_TTL = 10 * 60; // 10 minutes in seconds

  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly redisService: RedisService,
    private readonly mailService: MailService,
    @Inject(appConfig.KEY)
    private readonly appCfg: ConfigType<typeof appConfig>,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const superAdminEmail = this.appCfg.superAdminEmail;
    const role =
      superAdminEmail && dto.email === superAdminEmail
        ? UserRole.ADMIN
        : UserRole.USER;

    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
      isVerified: false,
      role,
    });

    // Store OTP in Redis using RedisService
    await this.redisService.set(`otp:${user.email}`, otp, this.OTP_TTL);

    if (this.appCfg.nodeEnv === 'development') {
      this.logger.debug(`[DEVELOPMENT] OTP for ${user.email}: ${otp}`);
    }

    // Send OTP via Email (Synchronous fail-fast execution)
    await this.mailService.sendOtpEmail(user.email, otp);

    return {
      message:
        'Registration successful. Please verify your email with the OTP sent.',
    };
  }

  async login(dto: LoginDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (!user.isVerified) {
      throw new UnauthorizedException('Please verify your email first');
    }

    const isPasswordValid = await bcrypt.compare(
      dto.password,
      user.passwordHash,
    );
    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const payload = { sub: user.id, email: user.email, role: user.role };
    this.logger.debug(
      `Signing login token for ${user.email} with payload: ${JSON.stringify(payload)}`,
    );

    // Fire and forget: Update last login timestamp
    this.usersService
      .updateLastLogin(user.id)
      .catch((err: Error) =>
        this.logger.error(
          `Failed to update last login for ${user.email}: ${err.message}`,
        ),
      );

    return {
      accessToken: this.jwtService.sign(payload),
    };
  }

  async verify(dto: VerifyOtpDto) {
    const user = await this.usersService.findByEmail(dto.email);
    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const storedOtp = await this.redisService.get(`otp:${dto.email}`);

    if (!storedOtp || storedOtp !== dto.otp) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }

    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      user.isVerified = true;
      await queryRunner.manager.save(user);

      // Auto-create 4 default wallets for the user
      await this.walletService.createDefaultWallets(
        user.id,
        queryRunner.manager,
      );

      await queryRunner.commitTransaction();
    } catch (err: unknown) {
      await queryRunner.rollbackTransaction();
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Verification failed for ${dto.email}: ${message}`);
      throw err;
    } finally {
      await queryRunner.release();
    }

    // Delete OTP from Redis after successful verification
    await this.redisService.del(`otp:${dto.email}`);

    return {
      message: 'Email verified successfully. You can now login.',
    };
  }

  async resendOtp(dto: ResendOtpDto) {
    const user = await this.usersService.findByEmail(dto.email);

    if (!user) {
      throw new BadRequestException('User not found');
    }

    if (user.isVerified) {
      throw new BadRequestException('User already verified');
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    // Update/Reset OTP in Redis
    await this.redisService.set(`otp:${user.email}`, otp, this.OTP_TTL);

    if (this.appCfg.nodeEnv === 'development') {
      this.logger.debug(`[DEVELOPMENT] Resent OTP for ${user.email}: ${otp}`);
    }

    // Send the new OTP via Email
    await this.mailService.sendOtpEmail(user.email, otp);

    return {
      message: 'OTP resent successfully',
    };
  }
}
