import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
  Inject,
} from '@nestjs/common';
import { JwtService, type JwtSignOptions } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service';
import { RedisService } from '../../common/redis/redis.service';
import { MailService } from '../../common/mail/mail.service';
import { type ConfigType } from '@nestjs/config';
import authConfig from '../../common/config/auth.config';
import appConfig from '../../common/config/app.config';
import { UserRole } from '../users/enums/user-role.enum';
import { DataSource } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { ResendOtpDto } from './dto/resend-otp.dto';
import { randomInt } from 'crypto';

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
    @Inject(authConfig.KEY)
    private readonly authCfg: ConfigType<typeof authConfig>,
    private readonly walletService: WalletService,
    private readonly dataSource: DataSource,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const otp = this.generateOtp();

    const user = await this.usersService.create({
      email: dto.email,
      name: dto.name,
      passwordHash,
      isVerified: false,
      role: UserRole.USER,
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

    const tokens = await this.getTokens(user.id, user.email, user.role);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

    this.logger.debug(`Login successful for ${user.email}. Tokens issued.`);

    // Fire and forget: Update last login timestamp
    this.usersService
      .updateLastLogin(user.id)
      .catch((err: Error) =>
        this.logger.error(
          `Failed to update last login for ${user.email}: ${err.message}`,
        ),
      );

    return tokens;
  }

  async logout(userId: string) {
    await this.updateRefreshTokenHash(userId, null);
    return { message: 'Logged out successfully' };
  }

  async refreshTokens(userId: string, refreshToken: string) {
    if (!refreshToken) {
      throw new UnauthorizedException('Access Denied');
    }
    const user = await this.usersService.findById(userId);
    if (!user || !user.refreshTokenHash) {
      throw new UnauthorizedException('Access Denied');
    }

    const isRefreshTokenValid = await bcrypt.compare(
      refreshToken,
      user.refreshTokenHash,
    );

    if (!isRefreshTokenValid) {
      throw new UnauthorizedException('Access Denied');
    }

    const tokens = await this.getTokens(user.id, user.email, user.role);
    await this.updateRefreshTokenHash(user.id, tokens.refreshToken);

    return tokens;
  }

  private async getTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.authCfg.jwtSecret,
        expiresIn: this.authCfg
          .jwtExpiresIn as unknown as JwtSignOptions['expiresIn'],
      }),
      this.jwtService.signAsync(payload, {
        secret: this.authCfg.jwtRefreshSecret,
        expiresIn: this.authCfg
          .jwtRefreshExpiresIn as unknown as JwtSignOptions['expiresIn'],
      }),
    ]);

    return {
      accessToken,
      refreshToken,
    };
  }

  private generateOtp(): string {
    return randomInt(100000, 999999).toString();
  }

  private async updateRefreshTokenHash(
    userId: string,
    refreshToken: string | null,
  ) {
    const hash = refreshToken ? await bcrypt.hash(refreshToken, 10) : null;
    await this.usersService.updateRefreshTokenHash(userId, hash);
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

      // Delete OTP from Redis after successful commit
      await this.redisService.del(`otp:${dto.email}`);
    } catch (err: unknown) {
      await queryRunner.rollbackTransaction();
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Verification failed for ${dto.email}: ${message}`);
      throw err;
    } finally {
      await queryRunner.release();
    }

    // OTP was deleted inside the transaction try block on success

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

    const otp = this.generateOtp();

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

