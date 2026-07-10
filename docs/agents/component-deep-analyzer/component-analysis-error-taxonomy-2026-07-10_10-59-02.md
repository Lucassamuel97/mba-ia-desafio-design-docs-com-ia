# Component Deep Analysis Report

**Component:** Error Taxonomy — `AppError` and subclasses (`src/shared/errors`)
**Analysis date:** 2026-07-10
**Scope:** `src/shared/errors/*`, consumers across `src/`, and the centralized error-handling middleware (`src/middlewares/error.middleware.ts`) that translates the taxonomy (plus Zod and Prisma errors) into HTTP responses.
**Ignored paths:** `node_modules`, `dist`, `coverage`, `.git`, `.claude`

---

## 1. Executive Summary

The component is a small, dependency-free error taxonomy rooted in a single base class, `AppError` (`src/shared/errors/app-error.ts`), extended by seven concrete HTTP-error subclasses defined in `src/shared/errors/http-errors.ts`, and re-exported through a barrel file (`src/shared/errors/index.ts`). It is the sole mechanism by which domain/service-layer code communicates a structured, client-facing failure (HTTP status + machine-readable `errorCode` + human message + optional `details` payload) up through Express's `next(err)` mechanism to a single centralized error-handling middleware (`src/middlewares/error.middleware.ts`), which is the only place in the codebase that turns any thrown error into an HTTP JSON response.

Key findings:

- The taxonomy is intentionally minimal: `AppError` carries exactly three pieces of contract data (`statusCode`, `errorCode`, `details`) plus the inherited `message`. There is no error registry, no i18n, no error class per business rule beyond two — `InvalidStatusTransitionError` and `InsufficientStockError` — everything else is either a generic HTTP-family class (`NotFoundError`, `ConflictError`, `UnprocessableEntityError`, `UnauthorizedError`, `ForbiddenError`, `ValidationError`, `BadRequestError`) instantiated directly by callers with a custom message/code, or a specialization of one of those.
- The centralized `errorMiddleware` performs a strict, ordered instanceof/type cascade: `AppError` → `ZodError` → `Prisma.PrismaClientKnownRequestError` (only `P2002` and `P2025` codes are mapped) → generic 500 fallback with structured logging via `pino`.
- `BadRequestError` is defined and exported but has **zero** call sites anywhere in `src/` or `tests/` — it is dead/unused code in the current codebase (confirmed by project-wide search).
- There is no dedicated unit test suite for `src/shared/errors/*` or for `error.middleware.ts` in isolation. All coverage is indirect, via Supertest integration tests (`tests/auth.test.ts`, `tests/orders.test.ts`) that assert on the resulting HTTP status and `error.code` field of specific end-to-end flows.
- The `ZodError` branch in `errorMiddleware` is effectively unreachable in the current codebase: the only place a Zod schema is invoked with a throwing `.parse()` is `validate.middleware.ts`, which already catches `ZodError` and converts it to a `ValidationError` before calling `next()`. `src/config/env.ts` uses `safeParse` (non-throwing). The branch is a defensive/forward-compatibility hook rather than an exercised path.
- The error-code convention is a plain, colocated string constant per throw site (e.g., `'EMAIL_ALREADY_USED'`, `'SKU_ALREADY_USED'`, `'INACTIVE_PRODUCT'`, `'INVALID_ORDER_STATE_FOR_DELETE'`) — there is no central enum/const registry of error codes; uniqueness and naming consistency rely entirely on developer discipline.
- A naming collision exists: the string literal `'INVALID_STATUS_TRANSITION'` is used both by the dedicated `InvalidStatusTransitionError` subclass and, independently, by a raw `ConflictError('...', 'INVALID_STATUS_TRANSITION', ...)` call in `order.service.ts:141-146` for a different scenario (order already in target status). Both map to different HTTP semantics implicitly (409 in both cases here, but via different classes) — documented in detail in Business Rules.
- This taxonomy is the intended extension point for a future webhooks module: no `WEBHOOK_*` codes or webhook-related error classes exist yet anywhere in the repository (confirmed via project-wide search for "webhook").

---

## 2. Data Flow Analysis

Two intertwined flows exist: (A) how an error is *raised* from business/validation code, and (B) how the centralized middleware *consumes* it and produces the HTTP response.

**A. Error origination flow (example: creating an order with insufficient stock)**

```
1. Request enters via OrderController.changeStatus (src/modules/orders/order.controller.ts)
2. Route-level validation in `validate` middleware (src/middlewares/validate.middleware.ts)
   - Zod schema.parse() throws ZodError -> caught -> new ValidationError(...) -> next(err)
   - (if validation passes, request proceeds)
3. Authentication/authorization in auth.middleware.ts
   - Missing/invalid JWT -> new UnauthorizedError(...) -> next(err)
   - Insufficient role -> new ForbiddenError(...) -> next(err)
4. Business logic in OrderService.changeStatus (src/modules/orders/order.service.ts)
   - Order not found -> new NotFoundError('Order') -> thrown (inside a Prisma $transaction callback)
   - Same-status transition -> new ConflictError(msg, 'INVALID_STATUS_TRANSITION', {from,to}) -> thrown
   - Illegal transition -> new InvalidStatusTransitionError(from, to) -> thrown
   - Insufficient stock during debitStock() -> new InsufficientStockError(unavailable) -> thrown
5. Error propagates out of the async transaction callback / async controller method
6. Express catches the rejected promise / thrown error (controllers wrap calls, see below) and
   routes it to app.use(errorMiddleware) (src/middlewares/error.middleware.ts), registered last in src/app.ts
7. errorMiddleware type-cascade:
   a. instanceof AppError -> res.status(err.statusCode).json({ error: { code, message, details? } })
   b. instanceof ZodError -> 400 VALIDATION_ERROR with formatted issues (defensive path)
   c. instanceof Prisma.PrismaClientKnownRequestError -> P2002 => 409 CONFLICT, P2025 => 404 NOT_FOUND
   d. otherwise -> logger.error(...) structured log with requestId/method/path -> 500 INTERNAL_SERVER_ERROR
8. JSON error envelope returned to caller: { error: { code, message, details? } }
```

**B. Response envelope shape (uniform across all branches)**

```
{
  "error": {
    "code": "<string>",       // always present
    "message": "<string>",    // always present
    "details": <object|array> // present only when defined (AppError.details !== undefined)
  }
}
```

Note: unhandled/unknown errors (`Error`, `TypeError`, driver-level Prisma errors other than P2002/P2025, etc.) never leak `message`/`stack` to the client — they are logged server-side via `pino` and a generic `Internal server error` message is returned, avoiding information disclosure.

---

## 3. Business Rules & Logic

### Overview of the business rules

| Rule Type | Rule Description | Location |
|-----------|-------------------|----------|
| Contract | Every domain-facing error must carry `statusCode`, `errorCode`, `message`, optional `details` | `src/shared/errors/app-error.ts:3-16` |
| Contract | `errorCode` is a free-form string, not an enum; convention is `UPPER_SNAKE_CASE` | `src/shared/errors/http-errors.ts` (all classes) |
| HTTP mapping | 400 = Bad Request / Validation, 401 = Unauthorized, 403 = Forbidden, 404 = Not Found, 409 = Conflict, 422 = Unprocessable Entity | `src/shared/errors/http-errors.ts:3-43` |
| Validation | `ValidationError` defaults to code `VALIDATION_ERROR`, status 400, and carries Zod issue arrays as `details` | `src/shared/errors/http-errors.ts:9-13`, `src/middlewares/validate.middleware.ts:26-33` |
| Business Logic | Order status transitions are governed by a fixed state machine; illegal transitions raise `InvalidStatusTransitionError` (409, code `INVALID_STATUS_TRANSITION`) | `src/modules/orders/order.status.ts:3-14`, `src/modules/orders/order.service.ts:147-149` |
| Business Logic | Re-requesting the same status the order is already in is treated as a distinct Conflict (also coded `INVALID_STATUS_TRANSITION`, but via a raw `ConflictError`, not the dedicated subclass) | `src/modules/orders/order.service.ts:140-146` |
| Business Logic | Stock is debited only on PENDING→PAID transition; insufficient stock raises `InsufficientStockError` (422, code `INSUFFICIENT_STOCK`) with a per-SKU shortage breakdown | `src/modules/orders/order.status.ts:26-28`, `src/modules/orders/order.service.ts:204-231` |
| Business Logic | Stock is replenished on PAID/PROCESSING→CANCELLED transitions | `src/modules/orders/order.status.ts:30-34`, `src/modules/orders/order.service.ts:154-156` |
| Validation | Discount cannot exceed order subtotal (`ValidationError`, 400) | `src/modules/orders/order.service.ts:87-91` |
| Validation | Order must contain at least one line item (`ValidationError`, 400) | `src/modules/orders/order.service.ts:51-53` |
| Business Logic | Inactive products cannot be ordered (`UnprocessableEntityError`, 422, code `INACTIVE_PRODUCT`) | `src/modules/orders/order.service.ts:66-73` |
| Business Logic | Orders can only be deleted while `PENDING` or `CANCELLED` (`ConflictError`, 409, code `INVALID_ORDER_STATE_FOR_DELETE`) | `src/modules/orders/order.service.ts:184-190` |
| Uniqueness | Duplicate email on user/customer registration → `ConflictError`, 409, code `EMAIL_ALREADY_USED` | `src/modules/users/user.service.ts:23-25`, `src/modules/customers/customer.service.ts:31-33,47-49` |
| Uniqueness | Duplicate SKU on product create/update → `ConflictError`, 409, code `SKU_ALREADY_USED` | `src/modules/products/product.service.ts:32-34,47-51` |
| AuthN | Invalid credentials, missing/invalid/expired bearer token → `UnauthorizedError`, 401, code `UNAUTHORIZED` | `src/modules/auth/auth.service.ts:33-39`, `src/middlewares/auth.middleware.ts:27-46` |
| AuthZ | Authenticated but insufficient role → `ForbiddenError`, 403, code `FORBIDDEN` | `src/middlewares/auth.middleware.ts:49-60` |
| Routing | Unmatched route → `NotFoundError`, 404, code `NOT_FOUND` | `src/app.ts:69-70` |
| Persistence fallback | Prisma unique-constraint violation (P2002) not caught earlier at the service layer → 409 `CONFLICT` | `src/middlewares/error.middleware.ts:37-47` |
| Persistence fallback | Prisma "record not found" on update/delete (P2025) not caught earlier → 404 `NOT_FOUND` | `src/middlewares/error.middleware.ts:48-53` |
| Resilience | Any error not matching the above → 500 `INTERNAL_SERVER_ERROR`, logged with `requestId`/`method`/`path`, message never leaks internals | `src/middlewares/error.middleware.ts:56-64` |
| Security | Sensitive fields (`password`, `passwordHash`, `token`, `accessToken`, auth headers, cookies) are redacted in all log output, including error logs | `src/shared/logger/index.ts:4-10` |
| Dead code | `BadRequestError` (400, default code `BAD_REQUEST`) is defined but never instantiated anywhere in the codebase | `src/shared/errors/http-errors.ts:3-7` |

---

### Detailed breakdown of the business rules

---

### Business Rule: `AppError` base contract

**Overview**:
`AppError` (`src/shared/errors/app-error.ts:3-16`) is the single point of truth for what a "known, expected, client-meaningful" error looks like in this system. It extends the native `Error` class and adds exactly three readonly fields: `statusCode` (a number, meant to be a valid HTTP status), `errorCode` (a string, meant to be a stable machine-readable identifier), and `details` (typed as `ErrorDetails = Record<string, unknown> | unknown[] | undefined`, i.e. either a keyed object, an array, or absent).

**Detailed description**:
The constructor signature is `(message, statusCode, errorCode, details?)`. `message` is passed to `super()` so `err.message` behaves like a normal `Error`. `this.name` is hardcoded to the literal string `'AppError'` for every instance — this is notable: subclasses do **not** override `name`, so `err.name` will read `'AppError'` even for a `NotFoundError` or `InsufficientStockError` instance. Callers wanting to discriminate by class must use `instanceof` or inspect `errorCode`/`statusCode`, not `name`. `Error.captureStackTrace?.(this, this.constructor)` is called defensively (optional chaining, since this V8-only API is not guaranteed cross-runtime) with `this.constructor` as the second argument, which correctly trims the stack trace at the most-derived subclass constructor rather than at `AppError` itself — meaning stack traces for, say, `InsufficientStockError` start at the real throw site in `order.service.ts`, not inside the error class hierarchy.

The class is the sole mechanism the rest of the codebase uses to signal "this is a handled, structured, HTTP-mappable failure" as opposed to an unexpected exception (a bug, a driver failure, a network error). This binary distinction is exactly what `errorMiddleware` uses as its first and most important branch: `if (err instanceof AppError)`. Any error that is not an `AppError` (or one of the two other explicitly recognized types, `ZodError` and `Prisma.PrismaClientKnownRequestError`) is treated as unexpected and collapses to a generic 500 with no leaked detail — this is a deliberate security/robustness boundary, not an oversight.

`ErrorDetails` is intentionally loose (`Record<string, unknown> | unknown[] | undefined`) rather than a strict generic, which keeps the base class simple but pushes all structural guarantees about `details` onto each subclass/call site (e.g., `InsufficientStockError` guarantees `{ unavailable: [...] }`, `InvalidStatusTransitionError` guarantees `{ from, to }`). There is no shared validation or schema enforcing what `details` must look like for a given `errorCode`, so the contract between error code and details shape is implicit and undocumented outside the source.

**Rule workflow**:
1. A subclass or direct instantiation supplies `(message, statusCode, errorCode, details?)`.
2. `AppError` stores all four values as readonly instance fields (message via `Error`).
3. `Error.captureStackTrace` trims the stack at the concrete subclass.
4. The instance is thrown (or passed to Express `next(err)`).
5. `errorMiddleware`'s `instanceof AppError` check succeeds for any instance in this hierarchy, regardless of how deep the subclass chain is.
6. `res.status(err.statusCode).json({ error: { code: err.errorCode, message: err.message, ...(details) } })` is returned verbatim — no additional mapping/lookup table is consulted; the class itself is the single source of the HTTP response shape.

---

### Business Rule: HTTP-family error classes and default codes

**Overview**:
`http-errors.ts` defines seven directly-usable subclasses, each pinned to one HTTP status code, with a default `errorCode` that callers may override, except for `UnauthorizedError`, `ForbiddenError`, and `NotFoundError`, whose codes are hardcoded (not parameterizable).

**Detailed description**:
Three of the seven classes accept a caller-supplied `code` (and, for some, `details`) as constructor parameters, allowing reuse of the same HTTP-family class for many distinct business scenarios: `BadRequestError(message, code = 'BAD_REQUEST', details?)`, `ConflictError(message, code = 'CONFLICT', details?)`, `UnprocessableEntityError(message, code = 'UNPROCESSABLE_ENTITY', details?)`. This is the primary mechanism used throughout the service layer for one-off business rules that don't warrant a dedicated subclass: e.g. `new ConflictError('Email already registered', 'EMAIL_ALREADY_USED')` in three different services, or `new ConflictError('Order can only be deleted while in PENDING or CANCELLED status', 'INVALID_ORDER_STATE_FOR_DELETE', { status: order.status })` in `order.service.ts:184-190`.

The remaining four classes have a fixed identity and are not intended to vary by call site: `ValidationError` is always `400`/`VALIDATION_ERROR` (message and `details` vary, code does not); `UnauthorizedError` is always `401`/`UNAUTHORIZED` with an optional message override (`'Unauthorized'` default); `ForbiddenError` is always `403`/`FORBIDDEN` with an optional message override; `NotFoundError` takes a `resource` string (default `'Resource'`) and always renders the message as `` `${resource} not found` `` with a fixed `404`/`NOT_FOUND` code — the resource name only affects the human message, never the `errorCode`, so all not-found conditions across Customers, Products, Orders, and Users share the identical `NOT_FOUND` code and are only distinguishable by message text or, at the API boundary, by the request path.

This split (parameterizable code vs. fixed code) reflects an implicit convention: use the fixed-code classes (`UnauthorizedError`, `ForbiddenError`, `NotFoundError`, `ValidationError`) for generic cross-cutting concerns where a single machine code suffices for all instances, and use the parameterizable classes (`ConflictError`, `UnprocessableEntityError`, and, unused, `BadRequestError`) when the business rule needs a distinct client-facing code per scenario.

**Rule workflow**:
1. Caller selects the HTTP-family class matching the semantics of the failure (400/401/403/404/409/422).
2. For `ConflictError`/`UnprocessableEntityError`/`BadRequestError`, caller supplies a scenario-specific `errorCode` string (by convention `UPPER_SNAKE_CASE`) and, optionally, a `details` payload describing the offending data.
3. For `ValidationError`/`UnauthorizedError`/`ForbiddenError`/`NotFoundError`, caller supplies only a message (and, for `ValidationError`, `details`); the `errorCode` is fixed by the class.
4. The instance flows to `errorMiddleware` exactly as described in the `AppError` rule above.

---

### Business Rule: Dedicated subclasses — `InvalidStatusTransitionError` and `InsufficientStockError`

**Overview**:
Two order-domain-specific error classes extend the generic HTTP-family classes to hardcode both the `errorCode` and the exact `details` shape for two recurring, structurally-rich failure scenarios: illegal order status transitions and insufficient stock at checkout time.

**Detailed description**:
`InvalidStatusTransitionError extends ConflictError` (`http-errors.ts:45-53`). Its constructor takes `(from: string, to: string)` and calls `super(`Invalid status transition from ${from} to ${to}`, 'INVALID_STATUS_TRANSITION', { from, to })`. This guarantees, for every call site, an identical message template, a fixed `errorCode`, and a `details` object of exactly `{ from, to }` — callers cannot vary the code or shape, only the two status values. It is used exactly once in the codebase, in `OrderService.changeStatus` (`order.service.ts:147-149`), guarded by `if (!canTransition(from, to))`, where `canTransition` is a pure function over a static transition table in `order.status.ts` (`PENDING → {PAID, CANCELLED}`, `PAID → {PROCESSING, CANCELLED}`, `PROCESSING → {SHIPPED, CANCELLED}`, `SHIPPED → {DELIVERED}`, `DELIVERED/CANCELLED → {}` terminal).

Notably, the identical string code `'INVALID_STATUS_TRANSITION'` is *also* produced by a separate, un-subclassed `ConflictError` call two lines above (`order.service.ts:140-146`), for the different scenario where `from === to` (the order is already in the requested target status). Both paths return HTTP 409 with the same `errorCode`, but one is constructed via the dedicated subclass (with implicit, structurally-guaranteed `details`) and the other via a raw `ConflictError` call with a hand-written message (`` `Order is already in ${to} status` ``) and manually-constructed but identically-shaped `details: { from, to }`. This is a duplication/coupling risk: the two call sites must be kept in sync by hand if the code or `details` shape ever changes, since only one of them goes through the dedicated class.

`InsufficientStockError extends UnprocessableEntityError` (`http-errors.ts:55-63`). Its constructor takes `unavailable: { sku: string; requested: number; available: number }[]` and calls `super('One or more products do not have enough stock', 'INSUFFICIENT_STOCK', { unavailable })`, fixing the message, the `errorCode`, and the `details` shape to a single array key. It is raised in `OrderService.debitStock` (`order.service.ts:204-231`), which is invoked only when `shouldDebitStock(from, to)` returns true (i.e., specifically on the `PENDING → PAID` transition — `order.status.ts:26-28`). The method loads the current products, compares `product.stockQuantity` against each requested item quantity, and accumulates every shortfall (not just the first) into the `unavailable` array before throwing — so a single request can surface multiple insufficient-stock lines in one response. If stock is sufficient, quantities are decremented item-by-item inside the same Prisma transaction as the status change, meaning the debit and the status transition are atomic (rolled back together if any later step in the transaction fails).

**Rule workflow (InvalidStatusTransitionError)**:
1. `OrderService.changeStatus` loads the order and compares `order.status` (`from`) to the requested `input.toStatus` (`to`).
2. If `from === to`, throw a raw `ConflictError` with code `INVALID_STATUS_TRANSITION` (same-status case).
3. Else, call `canTransition(from, to)` against the static transition table.
4. If not allowed, throw `new InvalidStatusTransitionError(from, to)`.
5. If allowed, proceed to conditionally debit/replenish stock and persist the new status + history row, all inside one `$transaction`.

**Rule workflow (InsufficientStockError)**:
1. Transition is validated as legal and identified as a stock-debiting transition (`PENDING → PAID`).
2. `debitStock` re-fetches current product rows for all order line items inside the transaction.
3. For each item, if the product is missing or `stockQuantity < quantity`, record a shortage entry `{ sku, requested, available }`.
4. If any shortages were recorded, throw `InsufficientStockError(unavailable)` — the whole transaction is aborted (Prisma rolls back), so no partial stock decrement is committed.
5. If no shortages, decrement stock for every item and let the transaction continue to update order status and history.

---

### Business Rule: Validation error propagation from Zod

**Overview**:
Two independent code paths can produce a `ValidationError`/`VALIDATION_ERROR` response: the request-level `validate` middleware (schema violations on `body`/`query`/`params`) and direct throws in `OrderService` for business-rule validations that are not expressible as static Zod schemas.

**Detailed description**:
`validate.middleware.ts` wraps `schemas.body.parse(req.body)`, `schemas.query.parse(req.query)`, and `schemas.params.parse(req.params)` in a single try/catch. If any `.parse()` call throws a `ZodError`, the catch block maps `err.issues` to `{ path: issue.path.join('.') || '(root)', message: issue.message }[]` and calls `next(new ValidationError('Validation failed', details))` — this happens *before* the error ever reaches `errorMiddleware`'s own `ZodError` branch, meaning that branch is effectively dead for all current call sites (all schema validation goes through this middleware; `env.ts` uses `safeParse`, which never throws). If the caught error is not a `ZodError`, it is forwarded via `next(err)` unchanged (defensive passthrough for unexpected middleware failures).

Separately, `OrderService.create` performs two validations that Zod's static schema cannot express because they require cross-field or state comparisons: an empty `items` array (`ValidationError('Order must contain at least one item')`, no details) and a discount exceeding the computed subtotal (`ValidationError('Discount cannot exceed subtotal', [{ path: 'discountCents', message: 'Discount exceeds subtotal' }])`). Both reuse the exact `details` shape convention established by the Zod-issue formatter (`{ path, message }[]`), even though they are hand-constructed rather than derived from a Zod parse — this is an implicit but consistent convention for how `ValidationError.details` should be shaped when it is an array (mirroring Zod's issue format), even outside a Zod context.

**Rule workflow**:
1. Request enters a route with an attached `validate(schemas)` middleware.
2. Each declared schema (`body`/`query`/`params`) is parsed in sequence; first thrown `ZodError` short-circuits the rest.
3. On `ZodError`, issues are flattened to `{ path, message }[]` and wrapped in `ValidationError` → `next(err)`.
4. On success, `req.body`/`req.query`/`req.params` are replaced with the parsed (and possibly transformed/coerced) values, and `next()` continues to the controller/service.
5. Independently, deep in `OrderService.create`, cross-field business invariants that Zod cannot statically enforce raise `ValidationError` directly with the same `{ path, message }[]` detail convention.
6. Both paths converge on `errorMiddleware`'s `instanceof AppError` branch (not the `ZodError` branch), since `ValidationError extends AppError`.

---

### Business Rule: Centralized error-to-HTTP mapping in `errorMiddleware`

**Overview**:
`error.middleware.ts` is the single Express error-handling middleware (`(err, req, res, _next) => void`, registered last via `app.use(errorMiddleware)` in `src/app.ts:73`) responsible for converting any thrown/`next()`-ed error, of any origin, into the final JSON HTTP response. It implements an ordered, mutually exclusive cascade of four branches.

**Detailed description**:
Branch order matters and is deliberate: (1) `AppError` is checked first because it is the most specific, intentional, fully-specified case — the middleware trusts `err.statusCode`/`err.errorCode`/`err.message`/`err.details` completely and does no further inspection. (2) `ZodError` is checked second as a defensive fallback for any code path that might throw a raw Zod error without going through `validate.middleware.ts` (currently none, per this analysis, but the branch exists for forward compatibility, e.g., if a future service performs its own `.parse()` calls). (3) `Prisma.PrismaClientKnownRequestError` is checked third, but only two of Prisma's many known error codes are handled explicitly: `P2002` (unique constraint violation) is mapped to 409 with code `CONFLICT`, extracting the violated field(s) from `err.meta?.target` when available to build a more informative message; `P2025` (record to update/delete not found) is mapped to 404 with code `NOT_FOUND`. Any other `PrismaClientKnownRequestError` code (e.g., `P2003` foreign-key constraint, `P2000` value too long, etc.) falls through to branch (4) since there is no `else` catch-all inside the Prisma `if` block. (4) Everything else — including unhandled Prisma codes, `PrismaClientValidationError`, `PrismaClientInitializationError`, generic `TypeError`/`Error`, or any thrown non-Error value — is logged via `logger.error({ err, requestId, method, path }, 'Unhandled error in request')` (with `requestId` sourced from `req.id`, set upstream by `requestLogger` middleware, defaulting to `'unknown'` if absent) and answered with a fixed 500 `INTERNAL_SERVER_ERROR` body that never echoes the original message.

This design enforces a strict security/robustness boundary: only errors the developer has explicitly modeled (via `AppError` or the two whitelisted Prisma codes) can influence the response status/code/message seen by API clients; everything else is opaque from the client's perspective but fully diagnosable server-side via structured logs (which also benefit from `pino`'s field redaction of secrets configured in `src/shared/logger/index.ts`).

**Rule workflow**:
1. Any middleware/controller/service in the request lifecycle calls `next(err)` or an async handler's rejected promise reaches Express's error pipeline.
2. `errorMiddleware` receives `(err, req, res, next)` as the last-registered `app.use()` handler.
3. `err instanceof AppError` → respond with `err.statusCode`, `{ code: err.errorCode, message: err.message, details? }`, return.
4. Else `err instanceof ZodError` → respond 400, `{ code: 'VALIDATION_ERROR', message: 'Validation failed', details: formatZodIssues(err) }`, return.
5. Else `err instanceof Prisma.PrismaClientKnownRequestError`:
   - `err.code === 'P2002'` → respond 409, `{ code: 'CONFLICT', message: <target-aware or generic> }`, return.
   - `err.code === 'P2025'` → respond 404, `{ code: 'NOT_FOUND', message: 'Resource not found' }`, return.
   - any other Prisma code → fall through to step 6.
6. Log the error with request context and respond 500, `{ code: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' }`.

---

### Business Rule: Error code naming and ownership convention (implicit)

**Overview**:
There is no enum, const object, or registry enumerating valid `errorCode` values; the convention is entirely implicit, established by precedent across call sites, and enforced only by code review.

**Detailed description**:
Observed convention (inferred, not documented in code): `errorCode` strings are `UPPER_SNAKE_CASE`; codes for uniqueness violations follow `<FIELD>_ALREADY_USED` (`EMAIL_ALREADY_USED`, `SKU_ALREADY_USED`); codes for domain state-machine violations follow `<DOMAIN>_...` (`INVALID_STATUS_TRANSITION`, `INVALID_ORDER_STATE_FOR_DELETE`); codes for resource-availability violations follow `<CONDITION>_<NOUN>` (`INSUFFICIENT_STOCK`, `INACTIVE_PRODUCT`); generic cross-cutting codes reuse the HTTP-family default (`VALIDATION_ERROR`, `UNAUTHORIZED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`, `UNPROCESSABLE_ENTITY`, unused `BAD_REQUEST`); and the middleware's own fallback branches contribute two more implicit codes not defined anywhere in `shared/errors` at all: `CONFLICT`/`NOT_FOUND` (reused, for Prisma-originated errors) and `INTERNAL_SERVER_ERROR` (defined only inline in `error.middleware.ts:63`, with no corresponding `AppError` subclass — it can never be thrown as an `AppError`, only produced by the middleware's own fallback branch).

Because there is no central list, nothing currently prevents two unrelated features from picking the same `errorCode` for different semantics (as already happened, arguably harmlessly, between the dedicated `InvalidStatusTransitionError` and the raw same-status `ConflictError` in `order.service.ts`), nor does anything prevent a typo divergence between a code used in source and a code asserted in a test.

**Rule workflow**:
1. Developer identifies a new failure scenario.
2. Developer picks (by convention, not enforced) an HTTP-family base class matching the desired status code.
3. Developer invents a new `UPPER_SNAKE_CASE` errorCode string inline at the throw site (or defines a new dedicated subclass in `http-errors.ts` if the failure recurs with a fixed `details` shape, as done for `InvalidStatusTransitionError`/`InsufficientStockError`).
4. Nothing statically validates the chosen code against existing codes; collisions or near-duplicates are only caught by code review or, indirectly, by integration tests asserting on `res.body.error.code`.

---

## 4. Component Structure

```
src/shared/errors/
├── app-error.ts        # Base AppError class + ErrorDetails type. No external deps beyond native Error.
├── http-errors.ts       # 7 concrete HTTP-family classes + 2 domain-specific subclasses, all extending AppError (directly or via ConflictError/UnprocessableEntityError)
└── index.ts             # Barrel re-export of AppError, ErrorDetails, and all http-errors.ts classes

src/middlewares/
└── error.middleware.ts  # Centralized Express error handler: consumes AppError, ZodError, Prisma.PrismaClientKnownRequestError, and unknown errors; the only file that instantiates the HTTP JSON error envelope

Consumers (not part of the component but analyzed as its API surface):
src/app.ts                              # registers errorMiddleware last; throws NotFoundError for unmatched routes
src/middlewares/validate.middleware.ts  # converts ZodError -> ValidationError
src/middlewares/auth.middleware.ts      # throws UnauthorizedError, ForbiddenError
src/modules/auth/auth.service.ts        # throws UnauthorizedError
src/modules/auth/auth.controller.ts     # throws UnauthorizedError (guard on req.user)
src/modules/users/user.service.ts       # throws ConflictError, NotFoundError
src/modules/customers/customer.service.ts # throws ConflictError, NotFoundError
src/modules/products/product.service.ts   # throws ConflictError, NotFoundError
src/modules/orders/order.service.ts     # throws NotFoundError, ValidationError, ConflictError,
                                         #   UnprocessableEntityError, InvalidStatusTransitionError,
                                         #   InsufficientStockError
src/modules/orders/order.controller.ts  # throws UnauthorizedError (guard on req.user)
```

There is no `webhooks` module yet in the codebase (verified by project-wide search); the error taxonomy as documented above is the full and only pattern a future webhooks module would need to extend.

---

## 5. Dependency Analysis

```
Internal Dependencies (within the component):
http-errors.ts        → app-error.ts (AppError, ErrorDetails)
index.ts               → app-error.ts, http-errors.ts (pure re-export, no logic)
InvalidStatusTransitionError → ConflictError (same file, http-errors.ts)
InsufficientStockError       → UnprocessableEntityError (same file, http-errors.ts)

Internal Dependencies (component → rest of src/):
error.middleware.ts → shared/errors/index.ts (AppError)
error.middleware.ts → shared/logger/index.ts (logger, for the 500 fallback path)

Internal Dependencies (rest of src/ → component):
app.ts, validate.middleware.ts, auth.middleware.ts, auth.service.ts, auth.controller.ts,
user.service.ts, customer.service.ts, product.service.ts, order.service.ts, order.controller.ts
  → shared/errors/index.ts (various classes, see Component Structure above)

External Dependencies:
- Node.js `Error` (built-in) - AppError base class parent
- zod (package.json-managed) - ZodError type check in both validate.middleware.ts and error.middleware.ts
- @prisma/client (5.22.0) - Prisma.PrismaClientKnownRequestError type check in error.middleware.ts
- pino (via src/shared/logger) - structured logging of unhandled errors, with secret redaction
- express (type ErrorRequestHandler) - the middleware signature/contract itself
```

No database, queue, cache, or third-party HTTP dependency exists inside `src/shared/errors` itself — it is a pure, side-effect-free data/type module. All I/O (logging) is confined to `error.middleware.ts`.

---

## 6. Afferent and Efferent Coupling

Granularity: TypeScript classes (OOP paradigm). Afferent (Ca) = number of distinct files outside the component that instantiate or reference the class. Efferent (Ce) = number of distinct external types/classes the class itself depends on (extends or type-checks against).

| Component | Afferent Coupling | Efferent Coupling | Critical |
|-----------|--------------------|---------------------|----------|
| `AppError` | 2 (error.middleware.ts instanceof check; http-errors.ts extends, counted separately below) | 1 (Node `Error`) | High — single point of failure for the entire error contract |
| `NotFoundError` | 5 (app.ts, customer.service.ts, product.service.ts, order.service.ts, user.service.ts) | 1 (`AppError`) | Medium |
| `ConflictError` | 4 direct (customer.service.ts, product.service.ts, order.service.ts, user.service.ts) + 1 as base class (InvalidStatusTransitionError) | 1 (`AppError`) | Medium |
| `UnauthorizedError` | 4 (auth.service.ts, auth.controller.ts, order.controller.ts, auth.middleware.ts) | 1 (`AppError`) | Medium |
| `ValidationError` | 2 (validate.middleware.ts, order.service.ts) | 1 (`AppError`) | Medium |
| `ForbiddenError` | 1 (auth.middleware.ts) | 1 (`AppError`) | Low |
| `UnprocessableEntityError` | 1 direct (order.service.ts) + 1 as base class (InsufficientStockError) | 1 (`AppError`) | Low |
| `InvalidStatusTransitionError` | 1 (order.service.ts) | 1 (`ConflictError`) | Low (narrow, single-purpose) |
| `InsufficientStockError` | 1 (order.service.ts) | 1 (`UnprocessableEntityError`) | Low (narrow, single-purpose) |
| `BadRequestError` | 0 | 1 (`AppError`) | Low — dead code, but zero blast radius if removed |
| `errorMiddleware` (function, not a class, included for completeness) | 1 (app.ts, registered once) | 4 (`AppError`, `ZodError`, `Prisma.PrismaClientKnownRequestError`, `logger`) | High — single point of failure for all HTTP error responses |

`AppError` and `errorMiddleware` are the two highest-criticality nodes: every other class/module in the taxonomy either extends `AppError` or is type-checked against it by `errorMiddleware`, and every controller/service in the system ultimately funnels error responses through `errorMiddleware`. A defect in either has system-wide blast radius (every endpoint's error responses).

---

## 7. Integration Points

| Integration | Type | Purpose | Protocol | Data Format | Error Handling |
|--------------|------|---------|----------|--------------|-----------------|
| Express error pipeline | Internal framework | Deliver thrown/`next(err)`-ed errors to `errorMiddleware` | In-process function call (`ErrorRequestHandler`) | JS Error object | Last-registered `app.use()` handler catches all; no `next(err)` calls at the end of the chain (always terminates the response) |
| Zod (`zod` package) | External library | Schema validation of request `body`/`query`/`params` (via `validate.middleware.ts`) and defensively re-checked in `error.middleware.ts` | In-process `instanceof ZodError` | Zod `issues[]` mapped to `{ path, message }[]` | Converted to `ValidationError` before reaching the middleware in all current call sites; middleware branch is a defensive fallback |
| Prisma (`@prisma/client`) | External library / DB driver | Persistence errors surfaced from `PrismaClient` calls (mostly inside `$transaction` blocks in services) | In-process `instanceof Prisma.PrismaClientKnownRequestError` | Prisma error `code` + `meta.target` | Only `P2002` and `P2025` explicitly mapped; all other Prisma error types (including `PrismaClientValidationError`, `PrismaClientInitializationError`, and unmapped `PrismaClientKnownRequestError` codes) fall through to the generic 500 path |
| pino logger (`src/shared/logger`) | Internal library | Structured logging of unhandled (500-path) errors with request correlation (`requestId`, `method`, `path`) | In-process function call | JSON (pino) | Redacts `authorization`, `cookie`, `password`, `passwordHash`, `token`, `accessToken` fields before writing |

---

## 8. Design Patterns & Architecture

| Pattern | Implementation | Location | Purpose |
|---------|------------------|-----------|---------|
| Template Method / Base Class Hierarchy | `AppError` as abstract-like base (not declared `abstract`, but never instantiated directly in practice), subclassed by all HTTP-family and domain-specific errors | `src/shared/errors/app-error.ts`, `src/shared/errors/http-errors.ts` | Guarantee every domain error carries a consistent `(statusCode, errorCode, message, details)` shape |
| Chain of Responsibility (single-handler cascade) | `errorMiddleware`'s ordered `if/else` cascade over `AppError` → `ZodError` → `Prisma.PrismaClientKnownRequestError` → fallback | `src/middlewares/error.middleware.ts:14-64` | Centralize all error-to-HTTP mapping in one place, in priority order |
| Facade / Barrel Export | `src/shared/errors/index.ts` re-exports everything from `app-error.ts` and `http-errors.ts` | `src/shared/errors/index.ts` | Single, stable import path (`../../shared/errors/index.js`) for all consumers regardless of internal file layout |
| Fail-fast / Guard Clauses | Extensive `if (!x) throw new XxxError(...)` guard clauses at the top of service methods | All `*.service.ts` files | Keep the "happy path" of each method un-nested and push error handling to early returns/throws |
| Structured Error Payload (API contract) | Every error response follows `{ error: { code, message, details? } }` | `error.middleware.ts` (all four branches follow the same envelope) | Predictable, machine-parseable API error contract for all clients |
| Defense in Depth (defensive/dead branch) | `ZodError` branch in `errorMiddleware` duplicates handling already done in `validate.middleware.ts` | `src/middlewares/error.middleware.ts:26-35` | Forward-compatibility safety net in case a future code path throws Zod errors directly |
| Information Hiding on Failure | Non-`AppError`/unmapped errors are logged in full server-side but reduced to a fixed generic message client-side | `src/middlewares/error.middleware.ts:56-64` | Prevent leaking stack traces, internal messages, or driver details to API clients |

---

## 9. Technical Debt & Risks

| Risk Level | Component Area | Issue | Impact |
|------------|------------------|-------|--------|
| Medium | `http-errors.ts` | `BadRequestError` is defined and exported but has zero call sites in `src/` or `tests/` | Dead code; also means the `400`/`BAD_REQUEST` generic path is entirely untested and unused, so any future consumer adopting it starts with no precedent or verification |
| Medium | `order.service.ts:140-149` | Two different code paths (`ConflictError` raw call vs. `InvalidStatusTransitionError` subclass) both produce the identical `errorCode` `'INVALID_STATUS_TRANSITION'` for two distinct scenarios (same-status vs. illegal-transition) | Client cannot distinguish "already in target status" from "illegal transition" by `errorCode` alone; maintenance risk if one call site is updated without the other |
| Medium | `shared/errors` (whole component) | No central registry/enum of valid `errorCode` strings; codes are free-form string literals scattered across service files | Risk of silent code collisions or typos between similar features (e.g., a future webhooks module could accidentally reuse an existing code); no compiler-level protection |
| Medium | `error.middleware.ts:37-54` | Only Prisma error codes `P2002` and `P2025` are explicitly handled; all other `PrismaClientKnownRequestError` codes (e.g., `P2003` FK violation, `P2000` value too long, `P2024` transaction timeout) fall through to the generic 500 | Legitimate, potentially client-actionable database constraint violations are reported as opaque 500s instead of meaningful 4xx responses, and are only visible via server logs |
| Low | `error.middleware.ts:26-35` | The `ZodError` branch is currently unreachable dead code given that `validate.middleware.ts` always intercepts and converts `ZodError` first, and `env.ts` uses `safeParse` | Adds a maintenance burden without current test coverage exercising it; could mask future refactors that unintentionally bypass `validate.middleware.ts` |
| Low | `app-error.ts:10` | `this.name` is hardcoded to `'AppError'` for every subclass instance rather than being set to the concrete subclass name (e.g., via `this.constructor.name`) | Anything relying on `err.name` (e.g., generic error loggers, some testing frameworks' error diffing) cannot distinguish `NotFoundError` from `InsufficientStockError` by name; only `errorCode`/`statusCode`/`instanceof` can |
| Low | `error.middleware.ts:39` | The P2002 message derivation (`` `Unique constraint violation on: ${target}` ``) exposes raw Prisma `meta.target` field names (likely internal DB column names) to the API client | Minor internal-schema leakage to clients in the specific case of an *unhandled* unique-constraint violation (i.e., one not already caught by a service-level `ConflictError` such as `EMAIL_ALREADY_USED`/`SKU_ALREADY_USED`) |
| Low | Whole component | No unit tests directly instantiate `AppError` or its subclasses to assert on `statusCode`/`errorCode`/`details` shape in isolation; no unit test exercises `error.middleware.ts` directly (e.g., feeding it a raw `Error`, an unmapped Prisma code, or a `ZodError`) | Regressions in the error contract itself (e.g., a typo changing a default code, or a broken `instanceof` check) would only be caught indirectly, and only for the specific scenarios covered by existing integration tests |

---

## 10. Test Coverage Analysis

| Component | Unit Tests | Integration Tests | Coverage | Test Quality |
|------------|------------|---------------------|----------|----------------|
| `AppError` (`app-error.ts`) | 0 | 0 direct (indirectly exercised by every integration test below) | Untested in isolation | No assertions target `statusCode`/`errorCode`/`details`/`name` fields directly; behavior only verified transitively through HTTP response shape |
| `http-errors.ts` classes | 0 | Indirect, via `tests/auth.test.ts` and `tests/orders.test.ts` (see below) | Partial, indirect only | Same caveat as above — no direct construction/assertion of class instances |
| `errorMiddleware` (`error.middleware.ts`) | 0 | Indirect, via Supertest requests in `tests/auth.test.ts`, `tests/orders.test.ts` | Partial — only the `AppError` branch is exercised (via various thrown `AppError` subclasses reaching real endpoints); the `ZodError` branch, the `Prisma.PrismaClientKnownRequestError` branch (`P2002`/`P2025`), and the generic-500 fallback branch have **no** test coverage found anywhere in `tests/` | No dedicated middleware-level test; Prisma-error and 500-fallback paths are entirely unverified by the test suite |
| `NOT_FOUND` responses | 0 | `tests/orders.test.ts:44-56` (`rejects an order with non-existent product` → asserts `res.status===404`, `res.body.error.code==='NOT_FOUND'`) | Covered for one scenario (missing product on order create) | Good: asserts both status and code; does not assert message or absence of `details` |
| `VALIDATION_ERROR` responses | 0 | `tests/auth.test.ts:32-38` (registering with invalid input → `res.status===400`, `error.code==='VALIDATION_ERROR'`, `Array.isArray(error.details)===true`) | Covered for one scenario (registration validation) | Good: asserts details is an array (matching Zod-issue shape), but does not assert its contents |
| `UNAUTHORIZED` responses | 0 | `tests/auth.test.ts:56-62` (wrong password login → 401/`UNAUTHORIZED`), `tests/auth.test.ts:78-82` (missing/invalid token on `/me` → 401) | Covered for two scenarios | Good coverage of the class's two primary triggers (bad credentials, bad token); does not test the `ForbiddenError`/role-based 403 path anywhere in `tests/` |
| `CONFLICT` (`EMAIL_ALREADY_USED`) | 0 | `tests/auth.test.ts:20-27` (duplicate registration → 409/`EMAIL_ALREADY_USED`) | Covered for user registration only | Does not cover the equivalent `customer.service.ts` or `product.service.ts` (`SKU_ALREADY_USED`) duplicate paths in the test suite |
| `INVALID_STATUS_TRANSITION` | 0 | `tests/orders.test.ts:~90-106` (illegal transition attempt → 409/`INVALID_STATUS_TRANSITION`) | Covers the `InvalidStatusTransitionError` subclass path | Does not appear to separately cover the same-status raw-`ConflictError` path (`from === to`) with its own test case — the collision noted in Technical Debt is untested from either direction |
| `INSUFFICIENT_STOCK` | 0 | `tests/orders.test.ts:~110-131` (order exceeding stock → 422/`INSUFFICIENT_STOCK`, and asserts `error.details.unavailable[0].sku`) | Well covered, including `details` structure | Best-covered error scenario in the suite — asserts status, code, and a field inside `details` |
| `INVALID_ORDER_STATE_FOR_DELETE` | 0 | `tests/orders.test.ts:~205-217` (deleting a non-deletable order → 409/`INVALID_ORDER_STATE_FOR_DELETE`) | Covered | Asserts status and code only |
| `INACTIVE_PRODUCT`, `SKU_ALREADY_USED`, `FORBIDDEN`, `BAD_REQUEST` | 0 | 0 found | Uncovered | No test in `tests/` exercises these codes at all |

Test files located: `tests/auth.test.ts`, `tests/orders.test.ts`, `tests/helpers/factories.ts` (test data/app bootstrap helpers, e.g. `getTestApp`, `bootstrapAuthenticatedUser`, `createTestCustomer`, `createTestProduct`), `tests/setup.ts` (Vitest global setup). Test runner: Vitest 2.1.4 (`package.json` `"test": "vitest run"`), HTTP assertions via Supertest 7.0.0 against an in-memory `Express` app built with `getTestApp()`, backed by a real Prisma-connected test database (per `import { prisma } from '../src/config/database.js'` in `orders.test.ts`) rather than mocks — meaning the Prisma-error-mapping branches in `errorMiddleware` (`P2002`/`P2025`) are technically reachable in this test environment but are not currently exercised by any assertion. No component/module in the repository has a `*.spec.ts`/`*.test.ts` file colocated under `src/shared/errors/` or `src/middlewares/` — all testing of this component is black-box, from `tests/` at the HTTP layer.

---

## Guidance for extending the taxonomy (e.g., a future webhooks module)

Purely descriptive of the existing pattern — no code changes proposed. To plug a new domain into this taxonomy consistently with current conventions, based on the mechanics documented above, a new error subclass (or set of raw calls) must:

1. Ultimately extend `AppError` (directly, or via one of the existing HTTP-family classes in `http-errors.ts`) so that `errorMiddleware`'s `instanceof AppError` check catches it — this is the only requirement for the middleware to recognize it at all.
2. Select the HTTP-family base whose fixed `statusCode` matches the intended response: `ConflictError` (409) and `UnprocessableEntityError` (422) are the two classes designed to be subclassed/parameterized for new domain codes (as `InvalidStatusTransitionError` and `InsufficientStockError` demonstrate); `BadRequestError` (400) is available but currently has zero precedent in the codebase.
3. Follow the observed `errorCode` naming convention: `UPPER_SNAKE_CASE`, prefixed by domain where useful — a webhooks module would plausibly follow the `<CONDITION>_<NOUN>` or `<DOMAIN>_<CONDITION>` patterns already used (e.g., `INSUFFICIENT_STOCK`, `INACTIVE_PRODUCT`, `INVALID_ORDER_STATE_FOR_DELETE`), yielding something like `WEBHOOK_SIGNATURE_INVALID`, `WEBHOOK_ALREADY_PROCESSED`, `WEBHOOK_ENDPOINT_UNREACHABLE` — there being no central registry, uniqueness against existing codes (see Technical Debt) must be manually verified.
4. Decide, per the same either/or convention observed today, whether the new codes warrant a dedicated subclass in `http-errors.ts` (recommended when the same failure recurs with a fixed message template and a fixed `details` shape, as with `InvalidStatusTransitionError`/`InsufficientStockError`) or can simply be raw calls to `new ConflictError(msg, 'WEBHOOK_...', details)` / `new UnprocessableEntityError(msg, 'WEBHOOK_...', details)` at each throw site (as with `EMAIL_ALREADY_USED`/`SKU_ALREADY_USED`/`INACTIVE_PRODUCT`).
5. If `details` is supplied, follow the two shape conventions already in use: an object with named keys mirroring the failure's structured data (`{ from, to }`, `{ unavailable }`), or, for validation-style failures, an array of `{ path, message }` mirroring Zod's issue format.
6. Export the new class (if any) from `src/shared/errors/http-errors.ts` and re-export it from `src/shared/errors/index.ts`, matching the existing barrel pattern — no changes to `app-error.ts` or `error.middleware.ts` are required, since the middleware's `instanceof AppError` branch is generic and requires no per-class registration.
7. Be aware that nothing in the current architecture maps Prisma errors that might arise from webhook-related persistence (e.g., duplicate webhook delivery IDs causing `P2002`) to a webhook-specific code automatically — the existing `P2002`/`P2025` branches in `errorMiddleware` are generic (`CONFLICT`/`NOT_FOUND`) and would need the webhook service layer to catch and re-throw as a proper `WEBHOOK_*`-coded `AppError` beforehand if a more specific code is desired at the API boundary (following the same pattern used by `customer.service.ts`/`product.service.ts`/`user.service.ts` for `EMAIL_ALREADY_USED`/`SKU_ALREADY_USED`, which pre-empt the generic Prisma P2002 path with a service-level check).
