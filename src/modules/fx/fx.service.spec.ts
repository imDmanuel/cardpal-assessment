import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { ServiceUnavailableException } from '@nestjs/common';
import { FxService } from './fx.service.js';
import { FxRate } from './entities/fx-rate.entity.js';
import { RedisService } from '../../common/redis/redis.service.js';
import { Currency } from '../wallet/enums/currency.enum.js';
import fxConfig from '../../common/config/fx.config.js';
import { EXCHANGE_RATE_PROVIDER } from './constants/fx.constants.js';

describe('FxService', () => {
  let service: FxService;
  let repository: jest.Mocked<Repository<FxRate>>;
  let redis: jest.Mocked<RedisService>;
  let provider: { getLatestRates: jest.Mock };

  const mockRates = {
    USD: 1,
    NGN: 1600.5,
    EUR: 0.92,
    GBP: 0.78,
  };

  const mockFxConfig = {
    apiKey: 'test-key',
    apiUrl: 'https://api.test',
  };

  beforeEach(async () => {
    provider = {
      getLatestRates: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FxService,
        {
          provide: getRepositoryToken(FxRate),
          useValue: {
            find: jest.fn(),
            create: jest.fn(),
            createQueryBuilder: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnThis(),
              distinctOn: jest.fn().mockReturnThis(),
              where: jest.fn().mockReturnThis(),
              orderBy: jest.fn().mockReturnThis(),
              addOrderBy: jest.fn().mockReturnThis(),
              getMany: jest.fn().mockResolvedValue([]),
              insert: jest.fn().mockReturnThis(),
              into: jest.fn().mockReturnThis(),
              values: jest.fn().mockReturnThis(),
              orUpdate: jest.fn().mockReturnThis(),
              execute: jest.fn().mockResolvedValue({}),
            }),
          },
        },
        {
          provide: RedisService,
          useValue: {
            get: jest.fn(),
            set: jest.fn(),
          },
        },
        {
          provide: fxConfig.KEY,
          useValue: mockFxConfig,
        },
        {
          provide: EXCHANGE_RATE_PROVIDER,
          useValue: provider,
        },
        {
          provide: DataSource,
          useValue: {},
        },
      ],
    }).compile();

    service = module.get<FxService>(FxService);
    repository = module.get(getRepositoryToken(FxRate));
    redis = module.get<RedisService>(RedisService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getRates (Display Logic)', () => {
    it('should return rates from cache if available', async () => {
      const cachedData = {
        rates: mockRates,
        fetchedAt: new Date().toISOString(),
      };
      redis.get.mockResolvedValue(JSON.stringify(cachedData));

      const result = await service.getRates(Currency.USD);

      expect(redis.get).toHaveBeenCalledWith('fx:rates:USD');
      expect(provider.getLatestRates).not.toHaveBeenCalled();
      expect(result.stale).toBe(false);
      expect(result.rates).toEqual(mockRates);
    });

    it('should fetch from Provider on cache miss and update cache/DB', async () => {
      redis.get.mockResolvedValue(null);
      provider.getLatestRates.mockResolvedValue(mockRates);

      const result = await service.getRates(Currency.USD);

      expect(provider.getLatestRates).toHaveBeenCalledWith(Currency.USD);
      expect(result.stale).toBe(false);
      expect(result.rates).toEqual(mockRates);

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(redis.set).toHaveBeenCalled();
      expect(repository.createQueryBuilder).toHaveBeenCalled();
    });

    it('should fall back to DB (stale) if Provider fails', async () => {
      redis.get.mockResolvedValue(null);
      provider.getLatestRates.mockRejectedValue(new Error('API Down'));

      const staleDate = new Date(Date.now() - 1000000);
      const mockStaleRates = [
        {
          quote: Currency.NGN,
          rate: { toNumber: () => 1600 } as any,
          fetchedAt: staleDate,
        },
        {
          quote: Currency.EUR,
          rate: { toNumber: () => 0.95 } as any,
          fetchedAt: staleDate,
        },
      ];

      const qb = repository.createQueryBuilder();
      (qb.getMany as jest.Mock).mockResolvedValue(mockStaleRates);

      const result = await service.getRates(Currency.USD);

      expect(result.stale).toBe(true);
      expect(result.rates[Currency.NGN]).toBe(1600);
      expect(result.fetchedAt).toEqual(staleDate);
      expect(qb.distinctOn).toHaveBeenCalled();
    });

    it('should throw 503 if Provider fails and DB is empty', async () => {
      redis.get.mockResolvedValue(null);
      provider.getLatestRates.mockRejectedValue(new Error('API Down'));

      const qb = repository.createQueryBuilder();
      (qb.getMany as jest.Mock).mockResolvedValue([]);

      await expect(service.getRates(Currency.USD)).rejects.toThrow(
        ServiceUnavailableException,
      );
    });
  });

  describe('getRateForMutation (Strict Logic)', () => {
    it('should return rate from cache if available', async () => {
      const cachedData = {
        rates: mockRates,
        fetchedAt: new Date().toISOString(),
      };
      redis.get.mockResolvedValue(JSON.stringify(cachedData));

      const rate = await service.getRateForMutation(Currency.USD, Currency.NGN);

      expect(rate).toBe(1600.5);
      expect(provider.getLatestRates).not.toHaveBeenCalled();
    });

    it('should fetch from Provider on cache miss', async () => {
      redis.get.mockResolvedValue(null);
      provider.getLatestRates.mockResolvedValue(mockRates);

      const rate = await service.getRateForMutation(Currency.USD, Currency.NGN);

      expect(rate).toBe(1600.5);
      expect(provider.getLatestRates).toHaveBeenCalledWith(Currency.USD);
    });

    it('should throw 503 and NOT fall back to DB if Provider fails', async () => {
      redis.get.mockResolvedValue(null);
      provider.getLatestRates.mockRejectedValue(new Error('API Down'));

      // Even if DB has data
      repository.find.mockResolvedValue([
        { quote: Currency.NGN, rate: 1600 } as any,
      ]);

      await expect(
        service.getRateForMutation(Currency.USD, Currency.NGN),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(repository.find).not.toHaveBeenCalled();
    });

    it('should throw Error if rate is missing in provider response', async () => {
      redis.get.mockResolvedValue(null);
      provider.getLatestRates.mockResolvedValue({ USD: 1 }); // NGN missing

      await expect(
        service.getRateForMutation(Currency.USD, Currency.NGN),
      ).rejects.toThrow(ServiceUnavailableException);
    });
  });
});
