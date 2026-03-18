# Design Decisions & Assumptions

This document outlines the architectural rationale and key assumptions made during the development of the CardPal FX Trading API.

## 🏗️ FX Rates Architecture

### 1. Provider Abstraction
**Decision**: External API interactions are abstracted behind the `IExchangeRateProvider` interface and the `EXCHANGE_RATE_PROVIDER` injection token.
- **Rationale**: Decouples the core business logic (`FxService`) from vendor-specific HTTP implementations. This allows switching between providers (e.g., ExchangeRate-API, Fixer, OpenExchangeRates) by simply swapping the registration in `FxModule`.
- **Implementation**: Uses `@nestjs/axios` for the concrete `ExchangeRateApiProvider`.

### 2. Multi-Layer Cache & Fallback Strategy
**Decision**: A prioritized retrieval strategy: **Redis Cache** (900s TTL) -> **External Provider** -> **Database (Stale fallback)**.
- **Rationale**: Optimizes performance and high availability.
    - **Redis**: Minimizes latency and protects external API quotas.
    - **Database**: Acts as a "circuit breaker" fallback. If the external API is unreachable, the system can still display rates using the last known data.

### 3. Strict Mutation Guard (The "Anti-Arbitrage" Rule)
**Decision**: Balance-affecting operations (e.g., conversion, trading) **must** use fresh rates.
- **Rationale**: Most critical financial decision. Allowing stale DB data for mutations would expose the platform to "stale price arbitrage," where users could trade against outdated prices during high volatility or API downtime.
- **Implementation**: `FxService.getRateForMutation` strictly queries Cache/API and throws a `503 Service Unavailable` if neither is available, even if stale data exists in the DB.

### 4. Asynchronous Persistence
**Decision**: Rates are persisted to Database and Cache in the background (fire-and-forget) after a successful API fetch.
- **Rationale**: Fetching rates from an external API is already slow. Stalling the response to wait for DB/Redis write operations would double the latency.
- **Side Effect**: Resolved race conditions in E2E tests by adding micro-delays to ensure background tasks complete before test cleanup.

### 5. Deadlock Prevention in Exchanges
**Decision**: Always sort currencies alphabetically before acquiring database locks in `WalletService.executeExchange`.
- **Rationale**: Prevents cyclic wait conditions when two users attempt reciprocal exchanges (e.g., NGN->USD and USD->NGN) at the same time. By enforcing a global lock order, we guarantee that one transaction will always proceed while the other waits, avoiding deadlocks.

---

## 💳 Wallet & Trading Design

### 1. NGN-Centric Funding
**Assumption**: The platform's primary entry point is Naira (NGN).
- **Rationale**: Simplifies the initial product scope. Users are expected to fund with NGN and then "purchase" other currencies via the trading/conversion features.
- **Rule**: Direct funding (`/wallet/fund`) is restricted to the `NGN` currency.

### 2. Auto-Wallet Provisions
**Decision**: 4 currency wallets (NGN, USD, EUR, GBP) are automatically provisioned upon user verification.
- **Initial Balance**: New users receive an initial balance of **1,000 NGN** to facilitate immediate testing and evaluation of the trading features.
- **Rationale**: Ensures a consistent UX where every user immediately sees their base multi-currency account ready for action and has "seed capital" to explore the platform.

### 3. Precision Management
**Decision**: All monetary values use `DECIMAL(18, 4)` in the database and the `Decimal.js` library for in-memory arithmetic.
- **Rationale**: IEEE 754 floating-point numbers (standard JS `number`) are unsuitable for financial calculations due to rounding errors (e.g., `0.1 + 0.2 !== 0.3`).

### 4. Atomic Mutations
**Decision**: All multi-step mutations (Debit Wallet A -> Credit Wallet B -> Create Transaction Record) are wrapped in TypeORM Database Transactions.
- **Rationale**: Guarantees data consistency. If any step fails (e.g., network timeout during transaction logging), the balance changes are rolled back automatically.

### 5. NGN-Centric Trading Constraint
**Decision**: The `/wallet/trade` endpoint is restricted to pairs involving `NGN`.
- **Rationale**: Aligns with the assumption that NGN is the primary local currency. Other conversions should use the `/wallet/convert` endpoint if permitted, but "trading" specifically implies NGN parity in this business model.
- **Assumption**: As requested, trading is currently single-step without a quote/confirmation phase or spread application.

---

## 🔐 Authentication & Identity

### 1. Decoupled Verification & Sessions
**Decision**: OTP verification only marks an account as `isVerified`. A subsequent `POST /auth/login` is required to obtain a JWT.
- **Rationale**: Enhances security and clarifies intent. The registration/verification flow "activates" the account, while the login flow "authenticates" the user. Avoids issuing tokens unnecessarily before a user has successfully proven their identity once.

### 2. Stateless Auth
**Decision**: Use signed JWTs for authentication.
- **Rationale**: Simplifies scaling by removing the need for session storage on the server-side.

---

## 🛠️ API & Validation Decisions

### 1. Multi-Layer Validation
**Decision**: Use both Class-Validator DTOs and manual Service-Layer guards for currency pair validation.
- **Rationale**: While DTOs provide clean 400 Bad Request responses at the edge, they are only active for HTTP requests. Manual guards in `WalletService` act as a "second line of defense," ensuring that even internal service calls or future non-HTTP triggers cannot process invalid trades (e.g., same-currency exchange), maintaining domain integrity.

### 2. Swagger Compatibility & Virtual Fields
**Decision**: Keep purely validation-focused virtual fields (like `sameCurrencyCheck`) hidden from Swagger documentation.
- **Rationale**: These fields are implementation details of the validation hack used to enforce cross-field constraints (like `fromCurrency !== toCurrency`). Including them in Swagger caused circular dependency errors during metadata generation and would confuse API consumers.
- **Implementation**: Removed `@ApiProperty` from internal validation fields.

---
 
 ## 📊 Analytics & Scalability
 
 ### 1. Database-Level Aggregations
 **Decision**: Perform all volume and frequency calculations using SQL `GROUP BY`, `SUM`, and `COUNT` via TypeORM `QueryBuilder`.
 - **Rationale**: Prevents "full table scans" from transferring thousands/millions of raw rows into Node.js memory. By letting the database engine group and sum the data, the network payload and Node.js CPU usage remain constant (limited by the number of currencies, not the number of transactions).
 
 ### 2. Strategic Indexing
 **Decision**: Added composite indices to `Transaction` entity on `type`, `fromCurrency`, and `toCurrency`.
 - **Rationale**: Ensures that the `GROUP BY` operations used in the analytics dashboard remain sub-millisecond even as the dataset grows to billions of rows.
 
 ## 🛠️ Environmental Assumptions

1. **ExchangeRate-API Consistency**: We assume the external vendor follows ISO currency codes and returns `conversion_rates` as a numeric map.
2. **Redis Reliability**: We assume Redis is available for caching; if Redis is down, the system defaults to fetching from the API directly (with significantly higher latency and quota impact).
3. **UTC Time**: All timestamps (`fetchedAt`, `createdAt`) are stored and retrieved in UTC to avoid time-zone-related discrepancies in rate calculations.
