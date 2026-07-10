# Architectural Analysis Report

**Project:** order-management-api (mba-ia-desafio-design-docs-com-ia)
**Analysis date:** 2026-07-10
**Scope:** Entire project root
**Excluded:** node_modules, dist, coverage, .git, .claude

---

## 1. Executive Summary

The repository contains a small, single-service **REST API for Order Management (OMS)** built with **Node.js 20, TypeScript (strict mode), Express 4, Prisma 5 (MySQL 8), Zod, JWT (jsonwebtoken), bcrypt, and Pino**. The codebase follows a consistent **layered / modular-monolith architecture**: each business domain (`auth`, `users`, `customers`, `products`, `orders`) is organized as a self-contained module with `routes → controller → service → repository` layers, all wired together manually (no DI container) in a composition root (`src/app.ts`).

The system is small (32 TypeScript source files under `src`, ~1,600 LOC), has no message broker, no cache layer, no external third-party API integrations, and a single external dependency: a MySQL database accessed exclusively through Prisma. Test coverage is limited to two integration test files (`tests/auth.test.ts`, `tests/orders.test.ts`) run against a real database via Vitest + Supertest.

The repository is currently in an early documentation stage: `docs/PRD.md`, `docs/FDD.md`, `docs/RFC.md`, and `docs/TRACKER.md` are placeholders ("documento a ser elaborado") and `docs/adrs/` contains no ADRs yet. This report is produced as part of the "Design Docs Gerados por IA" challenge, ahead of an upcoming **webhooks feature** that is expected to hook into the order status lifecycle.

Key findings:
- The **order status state machine** (`src/modules/orders/order.status.ts`) is a small, pure, well-isolated module that fully encodes valid transitions and stock side-effects; it has a single consumer today (`order.service.ts`) but is the natural integration point for any future status-change notification/webhook logic.
- The **`OrderService.changeStatus`** method (`src/modules/orders/order.service.ts`) is the single transactional method that mutates order status, adjusts stock, and appends history — all inside one `prisma.$transaction`. It currently has no hook, event-emission, or outbox mechanism; any webhook dispatch added here needs to be reconciled with the transactional boundary.
- **Authorization is inconsistent across modules**: `requireRole` (defined in `src/middlewares/auth.middleware.ts`) is used only on `GET /users/:id` (ADMIN-only). All order, product, and customer mutation endpoints only require `authenticate` (i.e., any authenticated user, ADMIN or OPERATOR, can create orders, change order status, delete products/customers).
- Error handling is centralized through a single **`errorMiddleware`** and a small **`AppError` class hierarchy** (`src/shared/errors`), consistently used by all services and controllers.
- Logging is centralized through a single **Pino logger instance** (`src/shared/logger/index.ts`) with secret redaction, consumed by the request logger and the error middleware.
- There is no containerization of the application itself — `docker-compose.yml` only provisions the MySQL database; the Node process is expected to run outside Docker (`npm run dev` / `npm start`).
- Two single points of contention exist: the singleton Prisma Client instance (`src/config/database.ts`) shared by the whole process, and the `OrderNumberSequence` single-row counter table used to generate sequential order numbers inside every order-creation transaction.

---

## 2. System Overview

```
mba-ia-desafio-design-docs-com-ia/
├── src/
│   ├── app.ts                    # Composition root: wires repositories/services/controllers, builds Express app
│   ├── server.ts                 # Process entrypoint: starts HTTP server, graceful shutdown
│   ├── config/
│   │   ├── env.ts                # Zod-validated environment configuration (fails fast on invalid env)
│   │   └── database.ts           # Prisma Client singleton factory
│   ├── middlewares/
│   │   ├── auth.middleware.ts    # JWT authentication (`authenticate`) + role-based guard (`requireRole`)
│   │   ├── error.middleware.ts   # Centralized error-handling middleware (last in the chain)
│   │   ├── request-logger.middleware.ts  # Per-request correlation id + structured access log
│   │   └── validate.middleware.ts        # Zod-based request (body/query/params) validation
│   ├── modules/
│   │   ├── auth/                 # Login/register/JWT issuance (routes, controller, service, schemas)
│   │   ├── users/                # User lookup (routes, controller, service, repository, schemas)
│   │   ├── customers/            # Customer CRUD (routes, controller, service, repository, schemas)
│   │   ├── products/             # Product CRUD + stock (routes, controller, service, repository, schemas)
│   │   └── orders/               # Order lifecycle (routes, controller, service, repository, schemas,
│   │                              #   order.status.ts state machine)
│   ├── routes/
│   │   └── index.ts              # Aggregates all module routers under /api/v1
│   └── shared/
│       ├── errors/                # AppError base class + typed HTTP error subclasses
│       ├── http/response.ts       # Pagination helper shared by list endpoints
│       └── logger/index.ts        # Pino logger factory (redaction, transport, log level)
├── prisma/
│   ├── schema.prisma              # Data model (User, Customer, Product, Order, OrderItem,
│   │                               #   OrderStatusHistory, OrderNumberSequence)
│   ├── migrations/                # SQL migration history (single init migration)
│   └── seed.ts                    # Deterministic seed script (users, customers, products, orders)
├── tests/
│   ├── auth.test.ts                # Integration tests for auth flows (Supertest + real DB)
│   ├── orders.test.ts              # Integration tests for order lifecycle
│   ├── helpers/factories.ts        # Test app builder + DB fixture factories
│   └── setup.ts                    # Vitest global setup: DB connect + table truncation between tests
├── docs/
│   ├── PRD.md / FDD.md / RFC.md / TRACKER.md   # Placeholders, not yet written
│   ├── adrs/                       # Empty ADR directory (only README with naming convention)
│   └── agents/                     # Output folders for this analyzer and companion agents
├── docker-compose.yml              # Provisions MySQL 8.0 only (no app/container for the API itself)
└── .env.example                    # Documents required environment variables
```

**Architectural pattern identified:** Layered / modular-monolith with **manual dependency injection** (constructor injection wired by hand in `buildControllers()`), organized by business domain ("module-per-feature") rather than by technical layer at the top level. Within each module, a classic `Router → Controller → Service → Repository` layering is applied uniformly across all five modules. Cross-cutting concerns (authentication, validation, error handling, logging) are implemented as Express middlewares composed at the app or router level. There is no CQRS, no event bus, no domain-event mechanism, and no repository abstraction/interface layer (repositories are concrete classes depending directly on `PrismaClient`).

---

## 3. Critical Components Analysis

Coupling is reported using two classic metrics. **Afferent coupling (Ca)** is the number of other internal components/files that depend on (import from) the component being measured — a proxy for how many things would break or need retesting if the component's contract changed, and for how central/critical the component is. **Efferent coupling (Ce)** is the number of other internal components/files that the component itself depends on (imports) — a proxy for how exposed the component is to changes elsewhere in the system and how hard it is to test in isolation. Both metrics were determined by statically tracing internal `import` statements (relative paths and `../` module references) between TypeScript files in `src/`, `tests/`, and `prisma/`; imports of third-party packages (e.g., `express`, `zod`, `@prisma/client` as a type-only enum reference) are counted only where they represent a structurally significant integration (e.g., the Prisma Client itself, listed as its own component below). Numbers reflect file-level, not class-level, coupling.

| Component | Type | Location | Afferent Coupling (Ca) | Efferent Coupling (Ce) | Architectural Role |
|-----------|------|----------|------------------------|-------------------------|---------------------|
| Composition Root (`buildControllers`/`buildApp`) | Bootstrap | src/app.ts | 1 (server.ts, tests via factories) | 18 | Wires every repository/service/controller and assembles the Express app; single place that constructs the whole dependency graph |
| Process Entrypoint | Bootstrap | src/server.ts | 0 | 4 | Starts the HTTP server, handles SIGINT/SIGTERM graceful shutdown |
| API Router Aggregator | Routing | src/routes/index.ts | 1 | 10 | Mounts all five module routers under `/api/v1` |
| Environment Configuration | Configuration | src/config/env.ts | 5 | 0 | Zod-validated, fail-fast environment loading; sole source of typed env vars |
| Prisma Client Provider | Infrastructure | src/config/database.ts | 3 (server, tests, factories) | 1 | Singleton `PrismaClient` instance shared by the whole process |
| Prisma Client / ORM Layer | Infrastructure/Integration | @prisma/client (generated) | ~15 (all repositories, order.service, error.middleware, config/database, seed, tests) | 1 (MySQL) | Data-access bridge to MySQL; used directly (not just via repositories) in `order.service.ts` for transactions |
| Authentication Middleware (`authenticate`) | Middleware | src/middlewares/auth.middleware.ts | 5 (all module routers except users uses same file) | 2 | Verifies JWT, populates `req.user`; gatekeeper for all protected routes |
| Role Guard (`requireRole`) | Middleware | src/middlewares/auth.middleware.ts | 1 (user.routes.ts only) | 0 (shares file with `authenticate`) | Coarse-grained RBAC guard; currently applied to a single endpoint |
| Centralized Error Middleware | Middleware | src/middlewares/error.middleware.ts | 1 (app.ts, last middleware in chain) | 2 | Single translation point from `AppError`/`ZodError`/Prisma errors to HTTP responses; also logs unhandled errors |
| Request Logger Middleware | Middleware | src/middlewares/request-logger.middleware.ts | 1 | 1 | Assigns/propagates `X-Request-Id`, emits structured access log per request |
| Validation Middleware (`validate`) | Middleware | src/middlewares/validate.middleware.ts | 5 (all module routers) | 1 | Generic Zod-based body/query/params validator used identically by every module |
| Error Taxonomy (`AppError` + subclasses) | Shared/Cross-cutting | src/shared/errors/ | 11 | 0 | Base `AppError` plus typed subclasses (`NotFoundError`, `ConflictError`, `InvalidStatusTransitionError`, `InsufficientStockError`, etc.); the contract every service/controller/middleware relies on for consistent HTTP error semantics |
| Pagination Helper | Shared utility | src/shared/http/response.ts | 3 (customer/product/order services) | 0 | Builds consistent `{data, pagination}` envelopes for all list endpoints |
| Pino Logger Factory | Shared/Cross-cutting | src/shared/logger/index.ts | 3 | 1 | Single structured-logging instance with secret redaction; consumed by error middleware, request logger, and server bootstrap |
| Order Status State Machine | Domain logic | src/modules/orders/order.status.ts | 1 (order.service.ts) | 0 | Pure functions encoding the finite-state machine for `OrderStatus` (allowed transitions, terminal states, stock debit/replenish triggers) |
| Order Service — `changeStatus` transactional method | Business logic | src/modules/orders/order.service.ts | 2 (app.ts, order.controller.ts) | 5 | Core transactional method: validates transition via the state machine, conditionally debits/replenishes stock, updates status, appends `OrderStatusHistory`, all within one `prisma.$transaction` |
| Order Service — other methods (`list`, `getById`, `create`, `delete`) | Business logic | src/modules/orders/order.service.ts | 2 | 5 | Order creation (multi-entity transaction: customer/product validation, price snapshot, order-number reservation), listing, retrieval, deletion guard |
| Order Repository | Data access | src/modules/orders/order.repository.ts | 2 | 0 | Read/delete queries for `Order`; write/transactional logic lives in the service, not here |
| Order Controller | API layer | src/modules/orders/order.controller.ts | 2 | 3 | Thin HTTP adapter: parses request, delegates to service, forwards errors via `next()` |
| Order Routes | Routing | src/modules/orders/order.routes.ts | 1 | 4 | Mounts `authenticate` for the whole router; no `requireRole` on any order endpoint |
| Order Schemas | Validation contracts | src/modules/orders/order.schemas.ts | 3 | 0 | Zod schemas for create/list/status-update payloads; source of `CreateOrderInput`/`UpdateOrderStatusInput` types |
| Auth Service | Business logic | src/modules/auth/auth.service.ts | 2 | 5 | Login (bcrypt compare + JWT sign) and register (delegates to `UserService`) |
| Auth Controller | API layer | src/modules/auth/auth.controller.ts | 2 | 3 | Exposes register/login/me |
| Auth Routes | Routing | src/modules/auth/auth.routes.ts | 1 | 4 | Public register/login endpoints + authenticated `/me` |
| Auth Schemas | Validation contracts | src/modules/auth/auth.schemas.ts | 2 | 0 | `loginSchema`/`registerSchema` |
| User Service | Business logic | src/modules/users/user.service.ts | 4 (app, auth.service, auth.controller, user.controller) | 3 | User creation (bcrypt hashing) and lookup; reused by `AuthService` for registration |
| User Controller | API layer | src/modules/users/user.controller.ts | 2 | 1 | Exposes `getById` only |
| User Repository | Data access | src/modules/users/user.repository.ts | 3 | 0 | `findById`/`findByEmail`/`create` against `User` table |
| User Routes | Routing | src/modules/users/user.routes.ts | 1 | 3 | Only module applying `requireRole('ADMIN')`; defines its own inline id-param schema instead of reusing `user.schemas.ts` |
| User Schemas | Validation contracts | src/modules/users/user.schemas.ts | 1 (user.service.ts) | 0 | `createUserSchema`/`userIdParamSchema` (the latter currently unused — routes re-declare their own) |
| Customer Service | Business logic | src/modules/customers/customer.service.ts | 2 | 4 | CRUD + email-uniqueness checks |
| Customer Controller | API layer | src/modules/customers/customer.controller.ts | 2 | 2 | Thin HTTP adapter for customer CRUD |
| Customer Repository | Data access | src/modules/customers/customer.repository.ts | 2 | 0 | CRUD + `contains` search filter against `Customer` |
| Customer Routes | Routing | src/modules/customers/customer.routes.ts | 1 | 4 | `authenticate`-only; no role restriction on create/update/delete |
| Customer Schemas | Validation contracts | src/modules/customers/customer.schemas.ts | 3 | 0 | Includes nested `addressSchema` (JSON column) |
| Product Service | Business logic | src/modules/products/product.service.ts | 2 | 4 | CRUD + SKU-uniqueness checks; stock/price fields also mutated directly by `OrderService` outside this service |
| Product Controller | API layer | src/modules/products/product.controller.ts | 2 | 2 | Thin HTTP adapter for product CRUD |
| Product Repository | Data access | src/modules/products/product.repository.ts | 2 | 0 | CRUD + `active`/search filters; `findManyByIds` is defined but unused (order flow queries products directly via `tx.product` inside `OrderService`) |
| Product Routes | Routing | src/modules/products/product.routes.ts | 1 | 4 | `authenticate`-only; no role restriction on create/update/delete |
| Product Schemas | Validation contracts | src/modules/products/product.schemas.ts | 3 | 0 | Includes `active` query-param boolean coercion |
| Prisma Data Model | Data model | prisma/schema.prisma | N/A (schema, not code) | N/A | Defines `User`, `Customer`, `Product`, `Order`, `OrderItem`, `OrderStatusHistory`, `OrderNumberSequence`, plus `UserRole`/`OrderStatus` enums |
| Database Migrations | Infrastructure | prisma/migrations/ | N/A | N/A | Single `20260519182739_init` migration; no incremental migration history yet |
| Seed Script | Tooling | prisma/seed.ts | 0 | 1 (Prisma Client, direct, not via repositories) | Deterministic fixture data (2 users, 10 customers, 20 products, 26 orders across all statuses); duplicates `reserveOrderNumber` logic from `OrderService` |
| Integration Test Suite | Testing | tests/*.ts | 0 | 3 (app.ts, config/database.ts, all modules indirectly via HTTP) | Black-box tests via Supertest against the real `buildApp()`/Prisma stack; no unit tests or mocks of repositories/services exist |

---

## 4. Dependency Mapping

```
High-level dependency flow:

  HTTP Request
       │
       ▼
  requestLogger middleware  ──────────────► Pino Logger
       │
       ▼
  /api/v1 Router (routes/index.ts)
       │
       ├──► authenticate / requireRole (auth.middleware.ts) ──► jsonwebtoken, env
       ├──► validate (validate.middleware.ts) ────────────────► Zod schemas, shared/errors
       │
       ▼
  Module Router (auth | users | customers | products | orders)
       │
       ▼
  Controller  ── (thin HTTP adapter, calls next(err) on failure)
       │
       ▼
  Service  ── business rules, orchestrates repositories, throws AppError subclasses
       │        (Order/Auth/User/Customer/Product Service)
       │
       ├──► Repository ──► Prisma Client ──► MySQL 8 (single external system)
       │
       └──► (Order Service only) prisma.$transaction directly, bypassing the
             Repository for multi-entity writes (order creation, status changes,
             stock debit/replenish)

  Any unhandled error / AppError bubbles to:
       ▼
  errorMiddleware (last in chain) ──► Pino Logger (on 5xx) / JSON error envelope

Module-internal composition (identical shape across auth/users/customers/products/orders):

  Routes ──uses──► Controller ──uses──► Service ──uses──► Repository ──uses──► PrismaClient

Cross-module dependency (the one exception to per-module isolation):

  AuthService ──depends on──► UserRepository + UserService  (registration delegates to Users module)

Composition root:

  app.ts ──constructs──► {User,Customer,Product,Order}Repository
        ──constructs──► AuthService, UserService, CustomerService, ProductService, OrderService
        ──constructs──► AuthController, UserController, CustomerController, ProductController, OrderController
        ──passes to───► routes/index.ts (buildApiRouter)
```

Notably, **`OrderService` is the only service that holds a direct reference to `PrismaClient`** (in addition to its repository), because order creation and status changes require multi-table transactions (`order`, `orderItem`, `orderStatusHistory`, `product` stock, `orderNumberSequence`) that a single-entity repository does not model. This is an intentional deviation from the otherwise uniform `Service → Repository → PrismaClient` chain used by the other four modules.

---

## 5. Integration Points

| Integration | Type | Location | Purpose | Risk Level |
|-------------|------|----------|---------|------------|
| MySQL 8.0 (via Prisma Client) | Database | src/config/database.ts, all repositories, docker-compose.yml | Sole system of record for users, customers, products, orders, order items, status history, order-number sequence | Medium — single database, no read replica, no connection-pool configuration visible beyond Prisma defaults |
| JWT (jsonwebtoken) | Auth token issuance/verification | src/modules/auth/auth.service.ts, src/middlewares/auth.middleware.ts | Stateless bearer-token authentication; token embeds `sub`, `email`, `role` | Medium — secret is a single shared `JWT_SECRET` env var; no key rotation, revocation list, or refresh-token flow found |
| bcrypt | Password hashing | src/modules/users/user.service.ts, src/modules/auth/auth.service.ts, prisma/seed.ts | Password hashing (10 rounds) for stored user credentials | Low |
| Pino / pino-http / pino-pretty | Logging | src/shared/logger/index.ts, src/middlewares/*.ts | Structured JSON logging with field redaction (authorization headers, cookies, password/token fields) | Low |
| Zod | Schema validation | src/middlewares/validate.middleware.ts, all `*.schemas.ts` files, src/config/env.ts | Runtime validation of environment variables and all HTTP request payloads | Low |
| Prisma Migrate / Prisma CLI | Schema migration tooling | prisma/schema.prisma, prisma/migrations/, package.json scripts | Schema versioning and (via `SHADOW_DATABASE_URL`) migration diffing | Low |
| Docker Compose (MySQL only) | Local infrastructure | docker-compose.yml | Provides a local MySQL instance for development/tests; does **not** containerize the API process itself | Informational |

No third-party payment gateways, message queues/brokers, cache layers, external REST/SOAP APIs, cloud provider SDKs, or webhook receivers/senders currently exist in the codebase. This absence is directly relevant to the upcoming webhooks feature: there is no existing outbound-HTTP client, retry/backoff utility, or event/queue abstraction to build on — a webhook dispatcher would be a wholly new integration surface.

---

## 6. Architectural Risks & Single Points of Failure

| Risk Level | Component | Issue | Impact | Details |
|------------|-----------|--------|--------|---------|
| Critical | Prisma Client / MySQL (src/config/database.ts) | Single database, single client instance, no visible pool/replica configuration | System-wide | Every module (auth, users, customers, products, orders) and the test suite depend on one `PrismaClient` singleton connecting to one MySQL instance; its unavailability halts the entire API (`/health` endpoint itself does not check DB connectivity) |
| High | `OrderNumberSequence` table (prisma/schema.prisma, order.service.ts `reserveOrderNumber`) | Single-row counter updated via `upsert`/`increment` inside every order-creation transaction | Order creation throughput | All concurrent order creations serialize on updates to the single row (`id: 1`) in `order_number_sequence`, making it a contention point/bottleneck under concurrent load; the same logic is duplicated (not reused) in `prisma/seed.ts` |
| High | Authorization model (auth.middleware.ts `requireRole`, all `*.routes.ts`) | `requireRole` is defined but applied to only one endpoint (`GET /users/:id`) | Data integrity / access control | Any authenticated user regardless of role (ADMIN or OPERATOR) can create/delete customers and products, and can create orders and change order status (including cancellations that trigger stock replenishment) — there is no role differentiation enforced on business-critical mutations |
| Medium | `OrderService.changeStatus` (order.service.ts) | Fully synchronous, single-transaction method with no extension point (no event emission, no outbox table, no after-commit hook) | Extensibility for the upcoming webhooks feature | Any webhook notification added directly inside this `prisma.$transaction` would execute an outbound network call while holding open a database transaction/row locks (on `order`, `product`, `orderStatusHistory`), coupling transaction duration to external HTTP latency; there is currently no separation between "commit the state change" and "notify interested parties" |
| Medium | `UserService` / `UserRepository` (src/modules/users/) | `AuthService` directly imports and calls into the Users module's repository and service | Cross-module coupling | Breaks the otherwise clean per-module isolation; a change to `UserRepository`'s constructor or `UserService.createUser` signature affects the Auth module as well |
| Medium | Product stock mutation (order.service.ts `debitStock`/`replenishStock`) | Stock is read and updated directly via `tx.product` inside `OrderService`, bypassing `ProductRepository` entirely | Maintainability / consistency | Two different code paths can mutate `Product.stockQuantity` (via `ProductService.update` and via `OrderService`'s private stock methods) with no single point of truth for stock-change rules |
| Low | `/health` endpoint (src/app.ts) | Returns `200 ok` unconditionally, without checking Prisma/database connectivity | Observability | A degraded or disconnected database would not be reflected by the health check |
| Low | Duplicated order-number logic | `reserveOrderNumber` is implemented independently in both `order.service.ts` and `prisma/seed.ts` | Maintainability | Any change to the numbering scheme (e.g., format, padding, reset policy) must be made in two places to stay consistent |
| Low | Test suite (tests/) | Only two integration test files exist, no unit tests, no mocking of `PrismaClient` in repositories/services | Change safety | Refactors to service/repository internals can only be validated end-to-end against a live MySQL instance; there is no fast feedback loop isolated from the database |
| Informational | Application containerization | docker-compose.yml provisions only MySQL; no Dockerfile or app container definition found | Deployment repeatability | The API process itself has no containerized runtime definition in this repository as of the analysis date |

---

## 7. Technology Stack Assessment

- **Runtime:** Node.js ≥20, ECMAScript modules (`"type": "module"` in package.json), TypeScript 5.6 compiled with `strict`, `noUncheckedIndexedAccess`, and `noImplicitOverride` enabled — a relatively strict type-safety configuration.
- **Web framework:** Express 4.21, used with a manual middleware pipeline (JSON body parsing, request logging, per-module routers, centralized error handler) rather than a framework-provided module system.
- **ORM / Data access:** Prisma 5.22 targeting MySQL 8.0, with `@prisma/client` generated types used both through repository classes and directly for transactional multi-table writes in `OrderService`.
- **Validation:** Zod 3.23, used uniformly for environment variables, request bodies, query strings, and route params via the shared `validate` middleware.
- **AuthN/AuthZ:** `jsonwebtoken` 9.0.2 for stateless bearer tokens, `bcrypt` 5.1.1 for password hashing; role model limited to two roles (`ADMIN`, `OPERATOR`) defined in the Prisma schema and mirrored in `AuthUser`/JWT payload types.
- **Logging:** Pino 9.5 (+ `pino-pretty` for development, `pino-http`-style redaction) configured once in `src/shared/logger`.
- **Testing:** Vitest 2.1 + Supertest 7.0, run against a live database (no in-memory or mocked Prisma layer).
- **Tooling:** ESLint 8.57 with `@typescript-eslint` (strict unused-vars, consistent type-imports, `eqeqeq`), Prettier 3.3, `tsx` for dev/seed execution.
- **Build:** `tsc -p tsconfig.build.json` producing a `dist/` output for `node --env-file=.env dist/server.js` in production; `dist` and `coverage` are excluded from lint/version control conventions.

No frontend, no API gateway, no service mesh, and no additional backend services were found; this is a single deployable unit (monolith).

---

## 8. Security Architecture and Risks

- **Authentication:** Stateless JWT verified in `authenticate` (src/middlewares/auth.middleware.ts) using a single shared `JWT_SECRET` (validated at boot by `env.ts` to be at least 16 characters). Tokens carry `sub`, `email`, and `role` with an expiry (`JWT_EXPIRES_IN`, default `8h`). There is no refresh-token mechanism, token revocation/blacklist, or rotation strategy visible in the codebase — a compromised or leaked token remains valid until natural expiry.
- **Authorization:** Role-based access control exists (`requireRole`) but, as noted in Section 6, is applied to only one route (`GET /users/:id`, ADMIN-only). All other mutating endpoints (orders, customers, products, order status changes) are reachable by any authenticated user regardless of role, meaning the `ADMIN`/`OPERATOR` distinction is largely not enforced at the API boundary today.
- **Secret handling:** `env.ts` fails fast (`process.exit(1)`) if `JWT_SECRET` or `DATABASE_URL` are missing/invalid, reducing the risk of running with an insecure default. `.env.example` documents a clearly non-production placeholder secret with a warning-style name (`change-me-in-production-please-use-a-long-random-secret`).
- **Password storage:** Passwords are hashed with bcrypt (10 rounds) before persistence (`user.service.ts`); plaintext passwords are never logged (Pino redact paths include `*.password`, `*.passwordHash`, `*.token`, `*.accessToken`, `req.headers.authorization`, `req.headers.cookie`).
- **Input validation:** All request bodies/queries/params pass through Zod schemas before reaching controllers, reducing injection and malformed-input risk at the application layer; Prisma's query builder (parameterized) is used throughout, so raw SQL injection risk is low.
- **Error disclosure:** The centralized `errorMiddleware` distinguishes `AppError` (safe, intentional messages), `ZodError` (validation details), and known Prisma error codes (`P2002` unique-constraint, `P2025` not-found) from unexpected errors, which are logged server-side and returned to the client as a generic `INTERNAL_SERVER_ERROR` without leaking stack traces or internal details.
- **Transport security:** No HTTPS/TLS termination, CORS configuration, rate limiting, or security headers (e.g., Helmet) were found in `src/app.ts`; these are presumably expected to be handled outside this codebase (reverse proxy/infrastructure layer) but are not visible in-repo.
- **Multi-tenancy / data scoping:** There is no tenant or ownership scoping visible — any authenticated user can read/list all customers, products, and orders system-wide; access is only partitioned by the coarse `ADMIN`/`OPERATOR` role, and (per the above) even that is barely enforced.
- **Webhook-relevant consideration:** Because no outbound HTTP/webhook mechanism exists yet, there is currently no secret-signing (e.g., HMAC signatures), retry, or allow-listing pattern established in the codebase for the upcoming webhooks feature to follow or diverge from.

---

## 9. Infrastructure Analysis

- **`docker-compose.yml`** defines a single service, `mysql` (image `mysql:8.0`), with a named volume (`oms_mysql_data`), a healthcheck (`mysqladmin ping`), and environment-driven credentials (`MYSQL_ROOT_PASSWORD`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`, all with insecure defaults meant for local development). No `Dockerfile` for the Node.js API and no application service entry in `docker-compose.yml` were found, so the API itself is expected to run directly on the host (via `npm run dev`/`npm start`) rather than in a container in this repository's current state.
- **Database migrations** are managed by Prisma Migrate; only one migration (`20260519182739_init`) exists, and a `SHADOW_DATABASE_URL` is configured for migration diffing, per Prisma's standard workflow.
- **Process lifecycle:** `src/server.ts` implements graceful shutdown on `SIGINT`/`SIGTERM` (stops accepting new connections, disconnects Prisma, then exits), which is a reasonable pattern for container/orchestrator-driven restarts even though no orchestrator manifests (Kubernetes, ECS, etc.) are present in the repository.
- **Configuration:** All runtime configuration is environment-variable-driven and validated centrally (`src/config/env.ts`), with `.env.example` documenting the expected variables; no environment-specific config files (e.g., `config/production.json`) were found.
- **No CI/CD pipeline files** (e.g., `.github/workflows`, `.gitlab-ci.yml`) were found in the analyzed scope, so build/test/deploy automation, if any, is not present in this repository.

---

## Notes on Documentation State

At the time of this analysis, `docs/PRD.md`, `docs/FDD.md`, `docs/RFC.md`, and `docs/TRACKER.md` are placeholder files with no content beyond their headings, and `docs/adrs/` contains no individual ADR files (only the naming-convention README). This architectural report is therefore based entirely on direct source-code inspection rather than existing design documentation.
