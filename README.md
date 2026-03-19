# FX Trading App

A robust NestJS backend for a multi-currency FX trading platform where users can trade currencies, including Naira (NGN) and other international currencies.

- **Wallets Module**: Multi-currency wallet support (USD, NGN, EUR, GBP).
- **Exchange Module**: Peer-to-peer and bank-rate currency conversions.
- **Analytics & Tracking**: Admin-only dashboard, historical FX trends, and user activity monitoring.
- **Automated Seeding**: Default admin user automatically created on startup for easier evaluation.

## 🚀 Getting Started

### Prerequisites
- Node.js (v18+)
- PostgreSQL
- Redis

### Installation & Setup

1. **Clone the repository**:
   ```bash
   git clone <repository-url>
   cd cardpal
   ```

2. **Configure Environment**:
   Create a `.env` file in the root directory (use `.env.example` as a template).
   ```env
   # JWT Configuration
   JWT_SECRET=your_jwt_secret_here
   JWT_EXPIRES_IN=15m
   JWT_REFRESH_SECRET=your_refresh_secret_here
   JWT_REFRESH_EXPIRES_IN=7d

   # Admin Bootstrapping (Optional)
   ADMIN_EMAIL=admin@cardpal.com
   ADMIN_PASSWORD=Admin123!
   SEED_ADMIN=true
   ```

3. **Install Dependencies**:
   ```bash
   npm install
   ```

4. **Run the Application**:
   ```bash
   # Development mode (with auto-seeding)
   npm run start:dev
   ```

   > [!TIP]
   > On the first run, the system will automatically create a default admin user:
   > - **Email**: `admin@cardpal.com`
   > - **Password**: `Admin123!`
   > - **Role**: `ADMIN`
   >
   > You can use these credentials to immediately access the `/analytics` dashboards.
5. **API Documentation**
   - Once running, Swagger UI is available at `http://localhost:3000/api/docs`

2. Register with that exact email.
3. The user will be automatically assigned the `ADMIN` role.
4. Use this account to promote other users via `PATCH /api/users/:id/promote`.

---

## 🏗️ Architecture Decisions

> [!NOTE]
> For a detailed breakdown of the technical rationale and assumptions behind our design (FX Rates, Wallet Security, and Data Precision), see [**DECISIONS.md**](./DECISIONS.md).

### 1. Layered Architecture
We follow the standard NestJS modular architecture split into Controller -> Service -> Entity/Repository. This ensures:
- **Scalability**: Modules are self-contained and can be extracted into microservices if needed.
- **Testability**: Service logic can be tested independently of HTTP concerns.

### 2. Database Design & Reliability
- **PostgreSQL**: Chosen for its ACID compliance and robust transaction support, which is critical for financial applications.
- **Atomic Transactions**: All balance mutations are wrapped in DB transactions using TypeORM `QueryRunner` to ensure atomicity. If any part of a multi-step update (e.g., wallet credit + transaction log) fails, the entire process is rolled back.
- **Pessimistic Locking**: To prevent **race conditions** in high-frequency trading, we use `SELECT FOR UPDATE` when fetching balances for mutation. This ensures that concurrent requests for the same user wallet are serialized at the database level.
- **Idempotency**: All funding requests (`/wallet/fund`) require a unique reference/idempotency key. This prevents double-funding if a user or network retries a request.
- **Precision**: Monetary values are stored as `DECIMAL(18, 4)` to avoid floating-point rounding errors common in standard number types.

### 3. FX Rates & High Availability
- **Multi-layer Fallback**: To ensure reliability, FX rates follow a **Cache -> API -> DB** strategy.
    - **Redis (Fresh)**: Rates are cached with a **15-minute TTL** (900s) to balance performance and API quota usage.
    - **External API**: If cache is empty, we fetch from **ExchangeRate-API**.
    - **PostgreSQL (Stale Fallback)**: If the API is down, we fall back to the last successfully persisted rates in the database (marked with `stale: true`).
- **Data Integrity**: While stale data is allowed for reading rates, **mutations** (conversion/trading) strictly require fresh data from the cache/API to prevent financial discrepancies.

### 4. Email Delivery (Strategy Pattern)
- **Abstraction**: Email delivery is abstracted behind a `MailProvider` interface. This allows seamless switching between providers (SMTP, Resend, SES) without modifying business logic.
- **Tradeoff - Sync vs Async Email**: To maintain a low-complexity infrastructure for the MVP, OTP emails are sent **synchronously**.
    - **Pros**: Immediate client-side feedback if the provider is down; no need for message brokers (Redis/BullMQ) or separate worker processes.
    - **Cons**: Higher request latency during registration.
    - **Decision**: Deferred background workers until infrastructure scale justifies the overhead of managing a persistent queue.

### 5. Identity & Access Control (RBAC)
- **Global Protection**: All routes are protected by `JwtAuthGuard` by default.
- **Public Access**: Specific endpoints (e.g., registration, health check) are explicitly white-listed using a custom `@Public()` decorator.
- **Role System**: Simple `USER` / `ADMIN` hierarchy.
    - **Promotion**: A configured `SUPERADMIN_EMAIL` is automatically granted `ADMIN` status upon registration. This admin can then promote other users.
- **JWT Strategy**: Stateless authentication using signed JWTs.

### 6. Transaction History
- **Auditability**: Every wallet mutation creates a permanent record in the `transactions` table, storing the exact rate used and amounts in both currencies.
- **Filtering**: Users can filter their history by `type` (FUND, CONVERT, TRADE) and navigate using limit/offset pagination.

### 7. Analytics & Activity Tracking (Scalability Ready)
- **FX Trends**: With the switch from upsert to insert, `fx_rates` now stores historical data. The system uses **PostgreSQL 14+ `DISTINCT ON`** for efficient retrieval of the latest rates while maintaining full auditability of price changes.
- **User Activity**: 
    - a global `UserActivityInterceptor` tracks `lastActiveAt` on every authenticated request.
    - `AuthService` tracks `lastLoginAt` during the login flow.
    - Both updates are **non-blocking (fire-and-forget)** to ensure zero impact on request latency.
- **Aggregated Analytics**: An admin-only `AnalyticsModule` provides transaction volume and pair frequency reports. 
    - **Database-Level Aggregation**: All aggregations (SUM, COUNT, GROUP BY) are performed entirely within the database engine to ensure O(1) performance as the transaction table scales.
    - **Optimized Indexing**: The `Transaction` table is indexed on `type`, `fromCurrency`, and `toCurrency` for sub-millisecond aggregation query times.
    - **Memory Safety**: Moving processing to the DB prevents "full table scans" from loading millions of rows into Node.js heap memory.
- **Retention & Scale Strategy**: 
    - Current: Indefinite history storage (~560k rows/year).
    - Planned Evolution: 30-day raw data retention -> Hourly rollups -> Daily aggregates.
    - Storage: Future migration to **TimescaleDB** or a dedicated time-series bucket recommended for billion-row scale.

### 8. Consistent API Responses
- **Response Wrapper**: All successful responses are intercepted and wrapped in a standard JSON envelope: `{ "success": true, "statusCode": 200, "message": "...", "data": [...] }`.
- **Error Filtering**: A global `HttpExceptionFilter` ensures that even errors follow a predictable structure, aiding frontend integration.

---

## 🛠️ Key Assumptions
1. **Base Funding**: Users can only fund their wallets in **Naira (NGN)**. All other currencies must be acquired via conversion or trading.
2. **Exchange Rates**: ExchangeRate-API is used as the primary source of truth for real-time rates.
3. **Multi-currency**: A user's wallet supports NGN, USD, EUR, and GBP by default.
4. **Trade Logic**: Trading is implemented as a single-step atomic operation (no quote/reconfirmation delay). This is an MVP simplification to avoid the complexity of temporary quote management.
5. **No Spread**: For this assessment, we use mid-market rates without an additional currency spread or transaction fee.

---

## 📊 Flow Diagrams

### Currency Conversion Flow
```mermaid
sequenceDiagram
    participant User
    participant API
    participant FxService
    participant Cache
    participant DB

    User->>API: POST /wallet/convert
    API->>FxService: getRates(NGN)
    FxService->>Cache: Check for cached rates
    alt Cache Miss
        FxService->>ExternalAPI: Fetch Rates
        FxService->>Cache: Save to Redis
    end
    API->>DB: Start Transaction
    DB->>DB: Check balance
    DB->>DB: Debit NGN / Credit USD
    DB->>DB: Record Transaction
    DB->>API: Commit Transaction
    API-->>User: Success (201)
```

### Wallet Management Flow
```mermaid
graph TD
    A[User Verified] --> B{Create Wallets}
    B --> C[NGN Wallet: 0]
    B --> D[USD Wallet: 0]
    B --> E[EUR Wallet: 0]
    B --> F[GBP Wallet: 0]
    G[Fund NGN] --> H[Update Balance]
    H --> I[Log FUND Transaction]
```

