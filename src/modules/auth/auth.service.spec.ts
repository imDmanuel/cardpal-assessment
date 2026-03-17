import { Test, TestingModule } from '@nestjs/testing';
import { AuthService } from './auth.service';
import { UsersService } from '../users/users.service';
import { JwtService } from '@nestjs/jwt';
import { RedisService } from '../../common/redis/redis.service';
import { MailService } from '../../common/mail/mail.service';
import { ConfigService } from '@nestjs/config';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { UserRole } from '../users/enums/user-role.enum';
import * as bcrypt from 'bcrypt';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let redisService: jest.Mocked<RedisService>;
  let mailService: jest.Mocked<MailService>;
  let configService: jest.Mocked<ConfigService>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: JwtService,
          useValue: {
            sign: jest.fn(),
          },
        },
        {
          provide: RedisService,
          useValue: {
            set: jest.fn(),
            get: jest.fn(),
            del: jest.fn(),
          },
        },
        {
          provide: MailService,
          useValue: {
            sendOtpEmail: jest.fn(),
          },
        },
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    redisService = module.get(RedisService);
    mailService = module.get(MailService);
    configService = module.get(ConfigService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    const registerDto = {
      email: 'test@example.com',
      password: 'password123',
      name: 'Test User',
    };

    it('should throw BadRequestException if email already exists', async () => {
      usersService.findByEmail.mockResolvedValue({ id: '1' } as any);
      await expect(service.register(registerDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create a user and send OTP email', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
      usersService.create.mockResolvedValue({ email: registerDto.email } as any);
      configService.get.mockReturnValue(null); // No superadmin

      const result = await service.register(registerDto);

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          email: registerDto.email,
          role: UserRole.USER,
        }),
      );
      expect(mailService.sendOtpEmail).toHaveBeenCalledWith(
        registerDto.email,
        expect.any(String),
      );
      expect(result.message).toContain('Registration successful');
    });

    it('should assign ADMIN role if email matches SUPERADMIN_EMAIL', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      configService.get.mockReturnValue(registerDto.email);
      usersService.create.mockResolvedValue({ email: registerDto.email } as any);

      await service.register(registerDto);

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({
          role: UserRole.ADMIN,
        }),
      );
    });
  });

  describe('verify', () => {
    const verifyDto = {
      email: 'test@example.com',
      otp: '123456',
    };

    it('should throw UnauthorizedException if user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await expect(service.verify(verifyDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if OTP is invalid', async () => {
      usersService.findByEmail.mockResolvedValue({ email: verifyDto.email } as any);
      redisService.get.mockResolvedValue('654321');
      await expect(service.verify(verifyDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should verify user and return JWT token', async () => {
      const user = {
        id: 'user-id',
        email: verifyDto.email,
        role: UserRole.USER,
        isVerified: false,
      };
      usersService.findByEmail.mockResolvedValue(user as any);
      redisService.get.mockResolvedValue(verifyDto.otp);
      jwtService.sign.mockReturnValue('jwt_token');

      const result = await service.verify(verifyDto);

      expect(user.isVerified).toBe(true);
      expect(usersService.save).toHaveBeenCalled();
      expect(redisService.del).toHaveBeenCalledWith(`otp:${verifyDto.email}`);
      expect(result.accessToken).toBe('jwt_token');
    });
  });

  describe('resendOtp', () => {
    const resendDto = { email: 'test@example.com' };

    it('should throw BadRequestException if user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await expect(service.resendOtp(resendDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should throw BadRequestException if user is already verified', async () => {
      usersService.findByEmail.mockResolvedValue({ isVerified: true } as any);
      await expect(service.resendOtp(resendDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should resend OTP email', async () => {
      usersService.findByEmail.mockResolvedValue({
        email: resendDto.email,
        isVerified: false,
      } as any);
      const result = await service.resendOtp(resendDto);

      expect(redisService.set).toHaveBeenCalled();
      expect(mailService.sendOtpEmail).toHaveBeenCalledWith(
        resendDto.email,
        expect.any(String),
      );
      expect(result.message).toBe('OTP resent successfully');
    });
  });
});
