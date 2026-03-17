import {
  Injectable,
  UnauthorizedException,
  BadRequestException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { UsersService } from '../users/users.service.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { MailService } from '../../common/mail/mail.service.js';
import { ConfigService } from '@nestjs/config';
import { UserRole } from '../users/enums/user-role.enum.js';
import { RegisterDto } from './dto/register.dto.js';
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
    private readonly configService: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existingUser = await this.usersService.findByEmail(dto.email);
    if (existingUser) {
      throw new BadRequestException('Email already registered');
    }

    const passwordHash = await bcrypt.hash(dto.password, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();

    const superAdminEmail = this.configService.get<string>('SUPERADMIN_EMAIL');
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

    // Send OTP via Email (Synchronous fail-fast execution)
    await this.mailService.sendOtpEmail(user.email, otp);

    return {
      message:
        'Registration successful. Please verify your email with the OTP sent.',
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

    user.isVerified = true;
    await this.usersService.save(user);

    // Delete OTP from Redis after successful verification
    await this.redisService.del(`otp:${dto.email}`);

    const payload = { sub: user.id, email: user.email, role: user.role };
    return {
      accessToken: this.jwtService.sign(payload),
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

    // Send the new OTP via Email
    await this.mailService.sendOtpEmail(user.email, otp);

    return {
      message: 'OTP resent successfully',
    };
  }
}
