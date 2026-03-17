# FX Trading App — Implementation Plan

## Goal
Build a robust NestJS REST API for an FX trading platform.  
Each feature below is implemented **and tested** before moving to the next.

## Project Type
**BACKEND** — NestJS + TypeORM + PostgreSQL + Redis. No frontend.

## Tech Stack
| Layer | Choice |
|-------|--------|
| Framework | NestJS 11 |
| ORM | TypeORM |
| Database | PostgreSQL |
| Cache | Redis (ioredis) |
| Auth | JWT + bcrypt |
| Email/OTP | Nodemailer (Gmail SMTP) |
| FX Rates | ExchangeRate-API |
| Validation | class-validator + class-transformer |
| Testing | Jest + Supertest (NestJS built-in) |
| API Docs | @nestjs/swagger (Swagger UI at `/api/docs`) |

---

## Workflow Per Feature
For every feature below:
1. Create the module, entity, service, controller, DTOs
2. Decorate all DTOs with `@ApiProperty` and controllers with `@ApiTags` / `@ApiOperation` / `@ApiResponse`
3. Write unit tests (service logic)
4. Write integration/E2E tests (endpoint behaviour)
5. Manually verify via `.http` file or Swagger UI
6. Mark `[x]` and move on

---

## Feature 0 — Project Bootstrap
*One-time setup before any feature work.*

- [x] Install all dependencies (including `@nestjs/swagger swagger-ui-express`)
- [x] Set up `.env` + `ConfigModule`
- [x] Connect TypeORM to PostgreSQL (`synchronize: true` for dev)
- [x] Add global `ValidationPipe`, `HttpExceptionFilter`, response interceptor
- [x] Bootstrap Swagger in `main.ts`: `DocumentBuilder` with title, version, Bearer auth scheme → available at `/api/docs`
- **Verify**: `npm run start:dev` starts, DB connected, `http://localhost:3000/api/docs` loads Swagger UI

---

## Feature 1 — Auth (Register + OTP Verify + JWT)
*Creates: `AuthModule`, `UsersModule`, `User` entity*

**Implement:**
- `User` entity: `id`, `email`, `passwordHash`, `isVerified`, `otp`, `otpExpiresAt`, `createdAt`
- `POST /auth/register` — hash password, generate & email 6-digit OTP (log to console in dev)
- `POST /auth/verify` — validate OTP (10 min expiry), mark verified, return JWT
- `JwtStrategy` + `JwtAuthGuard` protecting all future routes
- Swagger: `@ApiTags('Auth')` on controller; `@ApiProperty` on all DTOs; `@ApiOperation` + `@ApiResponse` (201, 400, 401) on each endpoint

**Tests:**
- Unit: `AuthService` — OTP generation, bcrypt comparison, expiry logic
- E2E: Register → returns 201; Verify with valid OTP → returns JWT; Verify with wrong OTP → 401

**Verify manually:**
1. `POST /auth/register` → OTP logged to console
2. `POST /auth/verify` with OTP → receive `{ accessToken }`
3. Hit any guarded route without token → `401`

---

## Feature 2 — Wallet (Balances + Funding)
*Creates: `WalletModule`, `Wallet` entity*

**Implement:**
- `Wallet` entity: `id`, `userId` (FK), `currency` (enum: NGN/USD/EUR/GBP), `balance` (decimal 18,4)
- On user verification: auto-create 4 wallet rows (balance = 0) in a DB transaction
- `GET /wallet` — return all balances for authenticated user
- `POST /wallet/fund` — fund NGN wallet only; atomic balance update + `Transaction` record
- Swagger: `@ApiTags('Wallet')`, `@ApiBearerAuth()` on controller; `@ApiProperty` on DTOs; `@ApiResponse` (200, 400, 401) per endpoint

**Tests:**
- Unit: `WalletService` — fund increases balance, rejects invalid currency, rejects amount ≤ 0
- E2E: Fund 5000 NGN → balance updates; `GET /wallet` returns 4 currencies; fund without auth → 401

**Verify manually:**
1. Verify a user → DB has 4 wallet rows
2. `POST /wallet/fund { currency: "NGN", amount: 5000 }` → success
3. `GET /wallet` → NGN balance is 5000, others are 0

---

## Feature 3 — FX Rates (External API + Redis Cache)
*Creates: `FxModule`*

**Implement:**
- `FxService.getRates(base)`: check Redis key `fx:rates:{base}` (TTL 300s) → else fetch ExchangeRate-API → cache + return
- `GET /fx/rates?base=NGN` — public endpoint, no auth required
- Swagger: `@ApiTags('FX')`, `@ApiQuery({ name: 'base', enum: Currency })`, `@ApiResponse(200)` with rate schema example

**Tests:**
- Unit: `FxService` — returns cached value on second call; calls API on cache miss; handles API error gracefully
- E2E: `GET /fx/rates?base=NGN` → returns rate object with USD/EUR/GBP keys

**Verify manually:**
1. First call → logs "fetching from API"
2. Second call within 5 min → logs "cache hit"
3. Redis CLI: `GET fx:rates:NGN` → shows cached JSON

---

## Feature 4 — Currency Conversion
*Extends: `WalletModule`, `FxModule`*

**Implement:**
- `POST /wallet/convert { fromCurrency, toCurrency, amount }`
- Validate sufficient balance in `fromCurrency`
- Fetch live rate from `FxService`
- DB transaction: debit from, credit to, insert `CONVERT` transaction record
- Return `{ fromAmount, toAmount, rate, updatedBalances }`
- Swagger: `@ApiOperation({ summary: 'Convert between currencies' })`, `@ApiResponse` with ConvertResponseDto example

**Tests:**
- Unit: `WalletService.convert` — correct rate math, rejects insufficient balance, atomic on failure
- E2E: Convert 1000 NGN → USD → both balances update; insufficient balance → 400

**Verify manually:**
1. Fund NGN, then `POST /wallet/convert { fromCurrency: "NGN", toCurrency: "USD", amount: 1000 }`
2. `GET /wallet` → NGN down, USD up by correct amount

---

## Feature 5 — Trading (NGN ↔ Other)
*Extends: `WalletModule`*

**Implement:**
- `POST /wallet/trade { fromCurrency, toCurrency, amount }` — must involve NGN
- Same atomicity pattern as convert; inserts `TRADE` transaction record
- Enforce NGN-pair rule — reject if neither currency is NGN
- Swagger: `@ApiOperation({ summary: 'Trade NGN ↔ foreign currency' })`, `@ApiResponse` (200, 400) with descriptive messages

**Tests:**
- Unit: rejects non-NGN pair; correct debit/credit; stores TRADE record
- E2E: Trade 50 USD → NGN → balances correct; trade EUR → USD (no NGN) → 400

**Verify manually:**
1. `POST /wallet/trade { fromCurrency: "USD", toCurrency: "NGN", amount: 50 }` → success
2. `POST /wallet/trade { fromCurrency: "USD", toCurrency: "EUR", amount: 10 }` → 400 Bad Request

---

## Feature 6 — Transaction History
*Creates: `TransactionsModule`, `Transaction` entity*

**Implement:**
- `Transaction` entity: `id`, `userId`, `type` (FUND/CONVERT/TRADE), `fromCurrency`, `toCurrency`, `fromAmount`, `toAmount`, `rate`, `createdAt`
- `GET /transactions` — all transactions for user, newest first
- Optional query params: `?type=FUND`, `?limit=20&page=1`
- Swagger: `@ApiTags('Transactions')`, `@ApiBearerAuth()`, `@ApiQuery` for type/limit/page, `@ApiResponse(200)` with paginated Transaction schema

**Tests:**
- Unit: filters by type, paginates correctly
- E2E: After fund + convert + trade, all 3 appear; filter by type works

**Verify manually:**
1. Perform fund, convert, trade
2. `GET /transactions` → 3 records with correct `type`, amounts, and rate stored

---

## Phase X — Final Verification
- [ ] `npm run lint` → 0 errors
- [ ] `npm run test` → all unit tests pass
- [ ] `npm run test:e2e` → all integration tests pass
- [ ] `npm run build` → compiles with 0 TypeScript errors
- [ ] `python .agent/skills/vulnerability-scanner/scripts/security_scan.py .`
- [ ] Full manual E2E flow: Register → Verify → Fund → Rates → Convert → Trade → History

## Notes
- **Atomicity**: All balance mutations use TypeORM `queryRunner` — never plain `.save()`
- **Decimal precision**: `decimal(18, 4)` on all monetary columns — never `float`
- **Rate stored**: Every transaction records the rate used at the time, for auditability
- **Funding rule**: Only NGN can be directly funded; all other currencies come via conversion/trade
- **OTP in dev**: If `NODE_ENV !== production`, log OTP to console as fallback
