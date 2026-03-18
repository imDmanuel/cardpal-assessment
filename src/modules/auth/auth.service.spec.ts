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
import { DataSource } from 'typeorm';
import { WalletService } from '../wallet/wallet.service';
import appConfig from '../../common/config/app.config';

jest.mock('bcrypt');

describe('AuthService', () => {
  let service: AuthService;
  let usersService: jest.Mocked<UsersService>;
  let jwtService: jest.Mocked<JwtService>;
  let redisService: jest.Mocked<RedisService>;
  let mailService: jest.Mocked<MailService>;
  let walletService: jest.Mocked<WalletService>;
  let dataSource: jest.Mocked<DataSource>;
  let appCfg: { nodeEnv: string; superAdminEmail: string };

  const registerDto = {
    email: 'test@example.com',
    password: 'password123',
    name: 'Test User',
  };

  beforeEach(async () => {
    appCfg = {
      nodeEnv: 'test',
      superAdminEmail: registerDto.email,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AuthService,
        {
          provide: UsersService,
          useValue: {
            findByEmail: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            updateLastLogin: jest.fn().mockResolvedValue(undefined),
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
        {
          provide: appConfig.KEY,
          useValue: appCfg,
        },
        {
          provide: WalletService,
          useValue: {
            createDefaultWallets: jest.fn(),
          },
        },
        {
          provide: DataSource,
          useValue: {
            createQueryRunner: jest.fn().mockReturnValue({
              connect: jest.fn(),
              startTransaction: jest.fn(),
              commitTransaction: jest.fn(),
              rollbackTransaction: jest.fn(),
              release: jest.fn(),
              manager: {
                save: jest.fn(),
              },
            }),
          },
        },
      ],
    }).compile();

    service = module.get<AuthService>(AuthService);
    usersService = module.get(UsersService);
    jwtService = module.get(JwtService);
    redisService = module.get(RedisService);
    mailService = module.get(MailService);
    walletService = module.get(WalletService);
    dataSource = module.get(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('register', () => {
    it('should throw BadRequestException if email already exists', async () => {
      usersService.findByEmail.mockResolvedValue({ id: '1' } as any);
      await expect(service.register(registerDto)).rejects.toThrow(
        BadRequestException,
      );
    });

    it('should create a user and send OTP email', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      (bcrypt.hash as jest.Mock).mockResolvedValue('hashed_password');
      usersService.create.mockResolvedValue({
        email: registerDto.email,
      } as any);
      appCfg.superAdminEmail = ''; // No superadmin

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
  });

  describe('login', () => {
    const loginDto = {
      email: 'test@example.com',
      password: 'password123',
    };

    it('should throw UnauthorizedException if user not found', async () => {
      usersService.findByEmail.mockResolvedValue(null);
      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if user is not verified', async () => {
      usersService.findByEmail.mockResolvedValue({
        isVerified: false,
      } as any);
      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should throw UnauthorizedException if password mismatch', async () => {
      usersService.findByEmail.mockResolvedValue({
        isVerified: true,
        passwordHash: 'hashed_password',
      } as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(false);
      await expect(service.login(loginDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should return JWT token on successful login', async () => {
      const user = {
        id: 'user-id',
        email: loginDto.email,
        role: UserRole.USER,
        isVerified: true,
        passwordHash: 'hashed_password',
      };
      usersService.findByEmail.mockResolvedValue(user as any);
      (bcrypt.compare as jest.Mock).mockResolvedValue(true);
      jwtService.sign.mockReturnValue('jwt_token');

      const result = await service.login(loginDto);

      expect(result.accessToken).toBe('jwt_token');
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
      usersService.findByEmail.mockResolvedValue({
        email: verifyDto.email,
      } as any);
      redisService.get.mockResolvedValue('654321');
      await expect(service.verify(verifyDto)).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('should verify user and return success message', async () => {
      const user = {
        id: 'user-id',
        email: verifyDto.email,
        role: UserRole.USER,
        isVerified: false,
      };
      usersService.findByEmail.mockResolvedValue(user as any);
      redisService.get.mockResolvedValue(verifyDto.otp);

      const result = await service.verify(verifyDto);

      expect(user.isVerified).toBe(true);
      const queryRunner = dataSource.createQueryRunner();
      expect(queryRunner.manager.save).toHaveBeenCalledWith(user);
      expect(walletService.createDefaultWallets).toHaveBeenCalledWith(
        user.id,
        queryRunner.manager,
      );
      expect(redisService.del).toHaveBeenCalledWith(`otp:${verifyDto.email}`);
      expect(result.message).toContain('Email verified successfully');
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
