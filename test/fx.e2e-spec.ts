import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { RedisService } from '../src/common/redis/redis.service';
import { Currency } from '../src/modules/wallet/enums/currency.enum';
import { getRepositoryToken } from '@nestjs/typeorm';
import { FxRate } from '../src/modules/fx/entities/fx-rate.entity';
import { Repository } from 'typeorm';
import Decimal from 'decimal.js';
import { EXCHANGE_RATE_PROVIDER } from '../src/modules/fx/constants/fx.constants';
import { IExchangeRateProvider } from '../src/modules/fx/interfaces/exchange-rate-provider.interface';

jest.mock('axios');

jest.setTimeout(60000);

describe('FxModule (e2e)', () => {
  let app: INestApplication<App>;
  let redisService: RedisService;
  let fxRateRepo: Repository<FxRate>;
  let provider: jest.Mocked<IExchangeRateProvider>;
  let accessToken: string;
  const uniqueId = Date.now();
  const testUser = {
    email: `fx_test_${uniqueId}@example.com`,
    name: 'FX Test User',
    password: 'Password123!',
  };

  beforeAll(async () => {
    provider = {
      getLatestRates: jest.fn(),
    } as any;

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EXCHANGE_RATE_PROVIDER)
      .useValue(provider)
      .compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ transform: true }));
    await app.init();

    redisService = app.get<RedisService>(RedisService);
    fxRateRepo = app.get<Repository<FxRate>>(getRepositoryToken(FxRate));

    // Register
    await request(app.getHttpServer()).post('/auth/register').send(testUser);

    // Verify OTP
    const otp = await redisService.get(`otp:${testUser.email}`);
    await request(app.getHttpServer())
      .post('/auth/verify')
      .send({ email: testUser.email, otp });

    // Login to get token
    const loginRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: testUser.email, password: testUser.password });
    accessToken = loginRes.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    // Small delay to allow previous test's unawaited async persistence to finish
    await new Promise((resolve) => setTimeout(resolve, 100));
    await redisService.del(`fx:rates:${Currency.USD}`);
    await fxRateRepo.clear();
  });

  it('GET /fx/rates - Should return fresh rates from API', async () => {
    const mockRates = { NGN: 1600, EUR: 0.92, GBP: 0.78 };
    provider.getLatestRates.mockResolvedValue(mockRates);

    const res = await request(app.getHttpServer())
      .get('/fx/rates?base=USD')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.stale).toBe(false);
    expect(res.body.rates.NGN).toBe(1600);
    expect(res.body.base).toBe(Currency.USD);
  });

  it('GET /fx/rates - Should return stale rates from DB if API fails', async () => {
    // Pre-populate DB
    const staleDate = new Date(Date.now() - 3600000); // 1 hour ago
    await fxRateRepo.save({
      base: Currency.USD,
      quote: Currency.NGN,
      rate: new Decimal(1550) as any,
      fetchedAt: staleDate,
    });

    // Mock API Failure
    provider.getLatestRates.mockRejectedValue(new Error('API Error'));

    const res = await request(app.getHttpServer())
      .get('/fx/rates?base=USD')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(200);

    expect(res.body.stale).toBe(true);
    expect(res.body.rates.NGN).toBe(1550);
    expect(new Date(res.body.fetchedAt)).toEqual(staleDate);
  });

  it('GET /fx/rates - Should return 503 if API fails and DB is empty', async () => {
    provider.getLatestRates.mockRejectedValue(new Error('API Error'));

    await request(app.getHttpServer())
      .get('/fx/rates?base=USD')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(503);
  });

  it('GET /fx/rates - Should return 400 for invalid base currency', async () => {
    await request(app.getHttpServer())
      .get('/fx/rates?base=INVALID')
      .set('Authorization', `Bearer ${accessToken}`)
      .expect(400);
  });

  it('GET /fx/rates - Should return 401 without JWT', async () => {
    await request(app.getHttpServer()).get('/fx/rates?base=USD').expect(401);
  });
});
