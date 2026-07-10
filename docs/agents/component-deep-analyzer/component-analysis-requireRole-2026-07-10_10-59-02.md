# Component Deep Analysis Report

**Component:** Role Guard — `authenticate` and `requireRole` (`src/middlewares/auth.middleware.ts`)
**Analysis date:** 2026-07-10
**Scope:** Single file component boundary — `src/middlewares/auth.middleware.ts` — plus every route module that consumes it and every test that exercises it, across the full project root, excluding `node_modules`, `dist`, `coverage`, `.git`, `.claude`.

---

## 1. Executive Summary

`src/middlewares/auth.middleware.ts` is the single authentication/authorization boundary for the entire Express API. It exports two Express `RequestHandler` factories:

- **`authenticate`** — a stateless JWT bearer-token verifier. It reads the `Authorization` header, verifies the token signature/expiry against `env.JWT_SECRET` using `jsonwebtoken`, and — on success — attaches a minimal `req.user` object (`{ id, email, role }`) derived directly from the token's claims (no database lookup). On any failure (missing header, malformed header, missing/invalid/expired token) it calls `next()` with a `401 UnauthorizedError`.
- **`requireRole(...roles)`** — a higher-order factory that returns a `RequestHandler` enforcing that `req.user.role` is one of the roles passed in. It must run **after** `authenticate` (it depends on `req.user` already being populated) and throws `401 UnauthorizedError` if `req.user` is absent (defensive check — should not normally trigger if wired correctly) or `403 ForbiddenError` if the role does not match.

The component's design is intentionally minimal and stateless: authorization decisions rely entirely on the JWT payload's `role` claim, with no per-request database check of the user's current role or account status (e.g., no check for disabled/deleted users). Today `requireRole('ADMIN')` is applied to exactly **one** route in the whole codebase: `GET /api/v1/users/:id`. All other protected routers use only `authenticate` (no role restriction), and two public routes (`POST /auth/register`, `POST /auth/login`) bypass the middleware entirely.

**Key finding relevant to the requested extension:** this component is directly reusable, with zero modification, to gate a new admin-only webhook replay endpoint. The exact wiring pattern is documented in Section 3 ("Rule workflow" of the `requireRole` rule) and Section 7. The most significant gap found is a **complete absence of automated test coverage** for `requireRole` and for the one existing route that uses it (`GET /api/v1/users/:id` is not exercised by any test file in `tests/`), which is a material risk to reuse on a new admin route without adding tests.

---

## 2. Data Flow Analysis

### 2.1 `authenticate` — token verification flow

```
1. Express router dispatches request to a router that has `authenticate` mounted
   (either via router.use(authenticate) for a whole router, or inline on a single route)
2. authenticate reads req.headers.authorization
   -> if missing OR does not start with "bearer " (case-insensitive) => next(UnauthorizedError) => STOP
3. Extract token: header.slice(7).trim()
   -> if empty string after trim => next(UnauthorizedError) => STOP
4. jwt.verify(token, env.JWT_SECRET)
   -> throws on bad signature, malformed token, or expired token (default jsonwebtoken behavior)
   -> catch block swallows the specific jwt error and re-throws as next(UnauthorizedError('Invalid or expired token')) => STOP
5. On success: payload cast to JwtPayload { sub, email, role, iat?, exp? }
6. req.user = { id: payload.sub, email: payload.email, role: payload.role }
7. next() -> control passes to the next middleware/handler in the chain
   (typically requireRole, or validate, or the controller action directly)
```

### 2.2 `requireRole` — authorization flow (runs after `authenticate`)

```
1. Express dispatches request to requireRole(...roles) middleware
   (mounted strictly after authenticate in the same route's middleware chain)
2. if !req.user => next(UnauthorizedError()) => STOP
   (defensive: only reachable if requireRole is mis-wired without authenticate first,
    since authenticate always sets req.user or short-circuits with 401)
3. if !roles.includes(req.user.role) => next(ForbiddenError('Insufficient permissions')) => STOP
4. next() -> control passes to the next middleware (e.g. validate) or the controller action
```

### 2.3 End-to-end example — the one existing ADMIN-gated route

```
GET /api/v1/users/:id
1. Request enters via Express router (buildUserRouter, src/modules/users/user.routes.ts:12-18)
2. authenticate  -> verifies JWT, sets req.user = { id, email, role }
3. requireRole('ADMIN') -> 403 if req.user.role !== 'ADMIN'
4. validate({ params: idParamSchema }) -> Zod validation of :id as UUID
5. controller.getById (UserController.getById, src/modules/users/user.controller.ts:7-14)
6. UserService.getById(id) -> repository lookup, throws NotFoundError if absent
7. res.status(200).json(user) — public user shape (no passwordHash)
   Any thrown error at any step is routed to errorMiddleware (src/middlewares/error.middleware.ts)
   which maps AppError subclasses to their statusCode/errorCode JSON shape.
```

### 2.4 Error propagation flow (shared by both functions)

```
authenticate / requireRole call next(err)
  -> Express error-handling pipeline
  -> errorMiddleware (src/middlewares/error.middleware.ts:14)
     -> if err instanceof AppError: res.status(err.statusCode).json({ error: { code, message, details? } })
     -> UnauthorizedError -> 401 { code: 'UNAUTHORIZED' }
     -> ForbiddenError    -> 403 { code: 'FORBIDDEN' }
```

---

## 3. Business Rules & Logic

## Overview of the business rules

| Rule Type | Rule Description | Location |
|-----------|------------------|----------|
| Validation | Authorization header must exist and start with `bearer ` (case-insensitive) | src/middlewares/auth.middleware.ts:28-32 |
| Validation | Bearer token must be non-empty after trimming the `Bearer ` prefix | src/middlewares/auth.middleware.ts:34-38 |
| Business Logic | JWT signature and expiry are verified using `jsonwebtoken.verify` against a single shared secret `env.JWT_SECRET` | src/middlewares/auth.middleware.ts:41 |
| Business Logic | Any JWT verification error (bad signature, malformed, expired) is normalized to a generic `401 Invalid or expired token` — no distinction is surfaced to the client | src/middlewares/auth.middleware.ts:44-46 |
| Data Contract | `req.user` shape is fixed to `{ id: string; email: string; role: 'ADMIN' \| 'OPERATOR' }`, sourced directly from JWT claims, not re-fetched from the database | src/middlewares/auth.middleware.ts:6-10, 42 |
| Data Contract | JWT payload shape is `{ sub, email, role, iat?, exp? }`; `sub` maps to `req.user.id` | src/middlewares/auth.middleware.ts:19-25 |
| Business Logic | Role is a closed, two-value enum: `ADMIN` and `OPERATOR` (enforced at the TypeScript type level and mirrored in the Prisma `UserRole` enum) | src/middlewares/auth.middleware.ts:9; prisma/schema.prisma:11-14 |
| Business Logic | `requireRole` is a variadic factory — it accepts one or more roles and passes if the authenticated user's role is included in that set (`roles.includes(req.user.role)`) | src/middlewares/auth.middleware.ts:49, 55 |
| Business Logic | `requireRole` must run after `authenticate` in the middleware chain; it does not itself perform authentication | src/middlewares/auth.middleware.ts:49-61 (implicit ordering contract, not enforced by types) |
| Validation | If `req.user` is absent when `requireRole` executes, the request is rejected with 401 (defensive fallback for incorrect middleware ordering) | src/middlewares/auth.middleware.ts:51-54 |
| Business Logic | Role mismatch yields `403 Forbidden — Insufficient permissions`, distinct from the `401 Unauthorized` used for missing/invalid authentication | src/middlewares/auth.middleware.ts:55-58 |
| Business Logic | Token issuance (outside this component, but the producer of the contract this component consumes): tokens are signed with `sub`, `email`, `role` claims and `env.JWT_EXPIRES_IN` expiry | src/modules/auth/auth.service.ts:40, 47-50 |
| Business Logic | Default role for newly registered users is `OPERATOR` (both at the Prisma schema level and the test factory default) | prisma/schema.prisma:30; tests/helpers/factories.ts:27 |
| Business Logic (current application) | Exactly one route in the codebase currently restricts access by role: `GET /api/v1/users/:id` requires `ADMIN` | src/modules/users/user.routes.ts:12-18 |
| Business Logic (current application) | All other protected routers (`/customers`, `/products`, `/orders`, `GET /auth/me`) require only a valid authenticated session — no role restriction (any `ADMIN` or `OPERATOR` user may access) | src/modules/customers/customer.routes.ts:14; src/modules/products/product.routes.ts:14; src/modules/orders/order.routes.ts:14; src/modules/auth/auth.routes.ts:12 |
| Business Logic (current application) | `POST /auth/register` and `POST /auth/login` are public — neither `authenticate` nor `requireRole` is applied | src/modules/auth/auth.routes.ts:10-11 |

## Detailed breakdown of the business rules

---

### Business Rule: JWT Bearer Token Extraction and Format Validation

**Overview:**
Before any cryptographic verification happens, `authenticate` enforces a strict textual contract on the `Authorization` header: it must be present, and its value must start with the literal (case-insensitive) prefix `bearer `. Only the remainder of the string, trimmed, is treated as a candidate JWT.

**Detailed description:**
This is the very first gate in the request pipeline for any protected route. The check `!header || !header.toLowerCase().startsWith('bearer ')` handles three failure classes at once: no header sent at all, a header using a different auth scheme (e.g. `Basic ...`, `Digest ...`), and a header that is present but empty or malformed. Using `toLowerCase()` on the scheme comparison makes the middleware tolerant of clients that send `Bearer`, `bearer`, or `BEARER` as the scheme name, which is common because HTTP header casing is not guaranteed by all client libraries; however the comparison is only applied to the fixed 7-character prefix, not case-folding the whole header, so the token portion itself remains case-sensitive (as it must, since JWTs are base64url-encoded and case-significant).

After the scheme check passes, the middleware extracts the token with `header.slice(7).trim()`. The `slice(7)` assumes exactly 7 characters for `"bearer "` (6 letters + 1 space), which is safe given the prior `startsWith` check guarantees at least those 7 characters exist. The subsequent `.trim()` protects against a header like `"Bearer    "` (whitespace-only token) or `"Bearer  <token>  "` with incidental leading/trailing whitespace, either of which would otherwise produce a token string that `jsonwebtoken` would reject in a way indistinguishable from a genuinely invalid token. By trimming first and checking `if (!token)` explicitly, the middleware produces a clearer, dedicated error message (`'Missing bearer token'`) versus reusing the generic `'Invalid or expired token'` message reserved for actual cryptographic failures.

This two-stage validation (header shape, then token presence) means any new route that reuses `authenticate` inherits identical, consistent behavior for malformed auth headers without any additional code — there is no per-route customization point for how the header is parsed, which guarantees uniform 401 semantics platform-wide, including for a new admin webhook replay endpoint.

**Rule workflow:**
```
if no Authorization header OR header does not start with "bearer " (case-insensitive):
    -> 401 UnauthorizedError('Missing or invalid Authorization header')
else:
    token = header without the first 7 characters, trimmed
    if token is empty string:
        -> 401 UnauthorizedError('Missing bearer token')
    else:
        proceed to JWT verification (see next rule)
```

---

### Business Rule: JWT Signature and Expiry Verification

**Overview:**
The extracted token is verified using `jsonwebtoken.verify(token, env.JWT_SECRET)`, which validates both the cryptographic signature (HMAC by default, since `auth.service.ts` calls `jwt.sign` without specifying an algorithm) and the `exp` claim if present. Any failure — bad signature, tampered payload, malformed structure, or expiration — collapses into a single generic outcome.

**Detailed description:**
`JWT_SECRET` is a single, shared, symmetric secret loaded from environment configuration (`src/config/env.ts:8`), validated at process startup to be at least 16 characters via a Zod schema (`z.string().min(16, ...)`). There is no key rotation mechanism, no `kid` (key ID) header handling, and no support for asymmetric (RS256/ES256) signing — the system relies entirely on `jsonwebtoken`'s default HMAC-SHA256 verification against this one secret. This means the same secret used to *verify* tokens in `authenticate` must exactly match the secret used to *sign* tokens in `AuthService.signToken` (`src/modules/auth/auth.service.ts:47-50`); any secret rotation would immediately invalidate every previously issued token with no graceful transition window.

The call is wrapped in a `try/catch` that discards the specific error object from `jwt.verify` (which could be `TokenExpiredError`, `JsonWebTokenError`, `NotBeforeError`, etc. from the `jsonwebtoken` library) and always re-throws the same `UnauthorizedError('Invalid or expired token')`. This is a deliberate (or at least consistent) security posture: it avoids leaking information to a caller about *why* a token failed (e.g., not confirming "this token's signature is invalid" versus "this token expired," which could otherwise help an attacker fingerprint validation logic or distinguish forged tokens from stale-but-once-valid tokens). The tradeoff is that legitimate clients get no actionable signal to auto-refresh vs. re-login, and server-side debugging of authentication issues (e.g., clock skew causing spurious expiry) requires log correlation rather than reading the error response.

Because verification is purely cryptographic and stateless — no database or cache lookup of the token, user, or a revocation list occurs — a token remains valid for its entire lifetime (`JWT_EXPIRES_IN`, default `'8h'`, configured in `env.ts:9` and used when signing in `auth.service.ts:48`) regardless of subsequent account changes (e.g., a user's role being changed, or the account being disabled) after the token was issued. This is an important constraint for anyone reusing `authenticate`/`requireRole` on a new endpoint: role changes do not take effect until the affected user obtains a new token (next login), and there is no mechanism in this component to force-invalidate an existing admin token.

**Rule workflow:**
```
try:
    payload = jwt.verify(token, env.JWT_SECRET) as JwtPayload
    req.user = { id: payload.sub, email: payload.email, role: payload.role }
    next()  // proceed to next middleware (e.g. requireRole) or controller
catch (any error from jwt.verify — expired, bad signature, malformed):
    -> 401 UnauthorizedError('Invalid or expired token')   // error detail discarded
```

---

### Business Rule: Authenticated User Shape (`req.user` / `AuthUser`) Contract

**Overview:**
On successful verification, the middleware augments the Express `Request` type (via TypeScript module augmentation) with an optional `user` property of type `AuthUser = { id: string; email: string; role: 'ADMIN' | 'OPERATOR' }`, populated directly and only from the JWT payload's `sub`, `email`, and `role` claims.

**Detailed description:**
The `AuthUser` type is the single source of truth, at the type level, for what "being authenticated" means downstream: any controller or middleware that runs after `authenticate` can rely on `req.user` being either `undefined` (not authenticated / not yet reached this middleware) or a fully-populated `AuthUser`. This is enforced through a `declare module 'express-serve-static-core'` augmentation (`auth.middleware.ts:12-17`) that extends Express's `Request` interface project-wide — any file importing Express's `Request` type in this codebase sees `req.user?: AuthUser` and `req.id?: string` (the latter set by `request-logger.middleware.ts`, not by this component, but declared in the same augmentation block).

Critically, `req.user` is *not* re-derived from the database on every request — it is a direct, trusted projection of whatever `sub`, `email`, and `role` were embedded in the JWT at sign time. This has two direct implications for anyone building on this component: first, `req.user.email` and `req.user.role` reflect the state of the user *at token-issuance time*, not necessarily their current state (e.g., if an admin's role were downgraded in the database after they logged in, their existing token would still carry `role: 'ADMIN'` and `requireRole('ADMIN')` would still pass until the token expires or the user logs in again). Second, consumers needing guaranteed-fresh user data (e.g., `AuthController.me`, `src/modules/auth/auth.controller.ts:30-38`) explicitly perform their own database lookup via `req.user.id` rather than trusting the token's cached fields for anything beyond identity and role-gating.

The `role` field's type is a TypeScript union literal `'ADMIN' | 'OPERATOR'`, mirroring the Prisma schema's `UserRole` enum (`prisma/schema.prisma:11-14`). This closed set is not re-validated at runtime by `authenticate` itself — the `payload as JwtPayload` cast (`auth.middleware.ts:41`) is an unchecked type assertion, not a runtime schema validation (e.g., no Zod parse of the decoded payload). Consequently, if a token were ever crafted or corrupted with a `role` value outside the two known literals, TypeScript would not catch this at runtime, and `requireRole`'s `roles.includes(req.user.role)` check would simply evaluate to `false` for any unrecognized value, safely falling through to `403 Forbidden` rather than granting unintended access — but this is a consequence of `Array.includes` semantics, not an explicit validation rule in the code.

**Rule workflow:**
```
JwtPayload = { sub: string, email: string, role: 'ADMIN' | 'OPERATOR', iat?: number, exp?: number }
on successful jwt.verify:
    req.user = {
      id:    payload.sub,      // token subject claim becomes the user id
      email: payload.email,
      role:  payload.role      // trusted as-is from the token, no DB re-check
    }
// req.user is now available, unchanged, to every subsequent middleware/handler
// in the same request's chain (requireRole, validate, controller actions)
```

---

### Business Rule: Role-Based Access Enforcement (`requireRole`)

**Overview:**
`requireRole(...roles: AuthUser['role'][])` is a middleware *factory*: calling it with one or more role literals (e.g., `requireRole('ADMIN')`) returns a new Express `RequestHandler` closed over that specific role set. The returned handler allows the request to proceed only if `req.user.role` is a member of that set.

**Detailed description:**
The factory pattern is what makes this component trivially reusable across arbitrarily many routes with different role requirements, without modifying `auth.middleware.ts` itself. Each call site supplies its own list of acceptable roles as variadic arguments, and the check itself, `!roles.includes(req.user.role)`, is a simple set-membership test — meaning `requireRole('ADMIN', 'OPERATOR')` (though never used in the current codebase, since it would be equivalent to just `authenticate` alone with the current two-role enum) is a fully supported invocation shape, as is a future `requireRole('ADMIN')` on a brand-new route. There is no capability to express "any role except X" or hierarchical/inherited roles (e.g., "ADMIN implies OPERATOR permissions") — the model is a strict flat allow-list evaluated per-route.

`requireRole` performs a defensive `if (!req.user)` check before the role comparison, returning `401 Unauthorized` (not `403`) if no user is attached to the request. This branch is not expected to trigger under correct usage, because every current call site places `requireRole(...)` immediately after `authenticate` in the same middleware chain (`user.routes.ts:14-15`), and `authenticate` either populates `req.user` or short-circuits the entire chain with its own `401` before `requireRole` would ever run. This defensive check exists purely as a safety net against a wiring mistake (e.g., a developer accidentally applying `requireRole` to a route where `authenticate` was omitted or was bypassed) — it fails closed (rejects) rather than allowing an unauthenticated request to slip through a role check that has nothing to check against.

When `req.user` is present but its role is not in the allowed set, the middleware calls `next(new ForbiddenError('Insufficient permissions'))`, producing a `403` response (distinct HTTP semantics from the `401` used for authentication failures — `401` means "who are you," `403` means "I know who you are, but you may not do this"). This distinction is consumed uniformly by `errorMiddleware`, which maps any `AppError` subclass to its own `statusCode`/`errorCode` (`UnauthorizedError` → `401`/`UNAUTHORIZED`; `ForbiddenError` → `403`/`FORBIDDEN`), so any new route reusing `requireRole('ADMIN')` automatically gets this same, already-established `403 FORBIDDEN` JSON error shape with zero additional error-handling code.

**Rule workflow:**
```
requireRole(...roles) returns RequestHandler:
    if req.user is undefined:
        -> 401 UnauthorizedError()          // defensive: authenticate should have already run
    else if req.user.role is not in roles:
        -> 403 ForbiddenError('Insufficient permissions')
    else:
        next()   // role check passed, proceed to next middleware/controller
```

---

### Business Rule: Current Application of Role Gating Across the API Surface

**Overview:**
As of this analysis, `requireRole` is applied to exactly one route in the entire codebase — `GET /api/v1/users/:id` with `requireRole('ADMIN')`. Every other protected route uses `authenticate` alone (any authenticated user, regardless of role, may access), and two routes are fully public.

**Detailed description:**
Route-by-route, the current authorization posture is: `POST /api/v1/auth/register` and `POST /api/v1/auth/login` (`src/modules/auth/auth.routes.ts:10-11`) require no authentication at all — they are the entry points that issue credentials/tokens in the first place, so gating them behind `authenticate` would be circular. `GET /api/v1/auth/me` (`auth.routes.ts:12`) requires `authenticate` only — any authenticated user (ADMIN or OPERATOR) may fetch their own profile, with no role restriction, since the identity used is always `req.user.id` (self-lookup), not an arbitrary target. All of `/api/v1/customers/*` (`customer.routes.ts:14`), `/api/v1/products/*` (`product.routes.ts:14`), and `/api/v1/orders/*` (`order.routes.ts:14`) apply `router.use(authenticate)` — a single guard for the entire sub-router, meaning every CRUD operation on customers, products, and orders (list, get, create, update, delete, and order status transitions) is available to any authenticated user of either role, with no `requireRole` calls anywhere in these three route files.

The sole exception is `/api/v1/users/:id` (`GET`), where the router applies both `authenticate` and `requireRole('ADMIN')`, in that literal order, before the `validate` middleware and the controller action (`user.routes.ts:12-18`). This effectively means: fetching another user's profile by ID is an ADMIN-only operation, while fetching your own profile (via `/auth/me`) is open to any authenticated role. There is no other user-management route (no create/update/delete/list on `/users` — `user.routes.ts` exposes only the single `GET /:id` handler), so the `UserController`/`UserService` write paths (`createUser`, used internally by `AuthService.register`) are not separately role-gated at the route layer; user creation happens only through the public `/auth/register` endpoint, which itself accepts an optional `role` field in its request body (`tests/auth.test.ts:11` sends `role: 'OPERATOR'` explicitly) — meaning the *initial* role assignment for a newly created user is controlled by whatever `registerSchema` in `auth.schemas.ts` allows, not by this middleware component (this component only enforces role checks on already-issued tokens, it does not restrict who can *set* a role at registration time — that is a separate concern belonging to `auth.schemas.ts`/`AuthService.register`, outside this component's boundary).

For the purpose of the new admin webhook replay endpoint referenced in the task: it should follow the exact pattern used by `/api/v1/users/:id` — mount `authenticate` then `requireRole('ADMIN')` (in that order) ahead of any `validate` middleware and the controller handler, on whichever router/path the new endpoint is added to (a new `webhook.routes.ts`-style module registered in `src/routes/index.ts`, or as an addition to an existing router if the webhook feature is nested under an existing module).

**Rule workflow:**
```
Route                              | authenticate | requireRole   | Any-role access?
------------------------------------------------------------------------------------
POST /api/v1/auth/register          | no           | no            | public
POST /api/v1/auth/login             | no           | no            | public
GET  /api/v1/auth/me                | yes          | no            | any authenticated role (self only)
GET  /api/v1/users/:id              | yes          | ADMIN only    | ADMIN only
/api/v1/customers/* (all methods)   | yes          | no            | any authenticated role
/api/v1/products/*  (all methods)   | yes          | no            | any authenticated role
/api/v1/orders/*    (all methods)   | yes          | no            | any authenticated role

New admin webhook replay endpoint (to be added):
router.post(
  '/replay',                       // or whatever path the new route uses
  authenticate,                    // must run first — populates req.user from JWT
  requireRole('ADMIN'),            // reuse verbatim — no changes needed to auth.middleware.ts
  validate({ ... }),               // optional, if the route needs body/param validation
  controller.replay,               // new controller action
);
```

---

## 4. Component Structure

The component itself is a single file. Its direct collaborators (types it depends on, and route modules that consume it) are shown for boundary clarity.

```
src/middlewares/
└── auth.middleware.ts          # THE COMPONENT: authenticate + requireRole + AuthUser/JwtPayload types
                                 #   - declares Express Request.user / Request.id augmentation

Direct consumers (route modules wiring authenticate / requireRole):
src/modules/
├── auth/
│   └── auth.routes.ts          # authenticate on GET /me only; register/login are public
├── users/
│   └── user.routes.ts          # authenticate + requireRole('ADMIN') on GET /:id  <-- only role-gated route
├── customers/
│   └── customer.routes.ts      # router.use(authenticate) for entire router
├── products/
│   └── product.routes.ts       # router.use(authenticate) for entire router
└── orders/
    └── order.routes.ts         # router.use(authenticate) for entire router

Upstream producer of the JWT contract this component verifies (not part of the component,
but essential to understand the data it consumes):
src/modules/auth/
└── auth.service.ts             # AuthService.signToken() — signs { sub, email, role } with env.JWT_SECRET

Configuration this component depends on:
src/config/
└── env.ts                      # env.JWT_SECRET (min 16 chars), env.JWT_EXPIRES_IN (used by signer, not verifier)

Error types this component throws (via next(err)):
src/shared/errors/
├── http-errors.ts              # UnauthorizedError (401), ForbiddenError (403)
└── index.ts                    # barrel re-export

Downstream consumer of the errors this component raises:
src/middlewares/
└── error.middleware.ts         # maps AppError subclasses to their statusCode/errorCode JSON response
```

---

## 5. Dependency Analysis

```
Internal Dependencies (compile-time imports):
auth.middleware.ts -> ../config/env.js                       (env.JWT_SECRET)
auth.middleware.ts -> ../shared/errors/index.js               (UnauthorizedError, ForbiddenError)

Internal Dependents (who imports authenticate / requireRole):
auth.routes.ts      -> authenticate                            (GET /me only)
user.routes.ts      -> authenticate, requireRole                (GET /:id — the only requireRole call site)
customer.routes.ts  -> authenticate                             (router.use, whole router)
product.routes.ts   -> authenticate                             (router.use, whole router)
order.routes.ts     -> authenticate                              (router.use, whole router)

Runtime data-contract dependency (not a compile-time import, but a coupling nonetheless):
auth.middleware.ts (verifier)  <-- shares env.JWT_SECRET and claim shape { sub, email, role} -->  auth.service.ts (signer)
  Both files independently read env.JWT_SECRET; there is no shared constant/module enforcing
  that the claim names used by the signer (auth.service.ts:49, `{ sub, email, role }`) match
  the claim names read by the verifier (auth.middleware.ts:19-25, JwtPayload) — they are
  currently kept in sync only by convention/code review, not by a shared type.

External Dependencies:
- jsonwebtoken (9.0.2)   - JWT signing (auth.service.ts) and verification (this component)
- express (4.21.1)        - RequestHandler type, Request augmentation
  (bcrypt 5.1.1 is used by auth.service.ts for password hashing, not by this component directly)

Indirect/transitive dependency exposed by this component to all its consumers:
- zod (3.23.8) - not used inside auth.middleware.ts itself, but every route that mounts
  authenticate/requireRole also mounts `validate(...)` from validate.middleware.ts immediately
  after, forming a consistent three-stage chain (authenticate -> requireRole? -> validate) across
  the codebase's protected routes.
```

---

## 6. Afferent and Efferent Coupling

Analyzed at the function/export level (this is a small TypeScript module, so the meaningful "components" are its two exported middleware factories and the two type definitions they rely on).

| Component | Afferent Coupling (who depends on it) | Efferent Coupling (what it depends on) | Critical |
|-----------|----------------------------------------|------------------------------------------|----------|
| `authenticate` | 5 (auth.routes.ts, user.routes.ts, customer.routes.ts, product.routes.ts, order.routes.ts) | 2 (`env.JWT_SECRET`, `UnauthorizedError`) | High |
| `requireRole` | 1 (user.routes.ts — sole current call site) | 1 (`ForbiddenError`; also implicitly depends on `AuthUser` type and on `authenticate` having already run) | High (low current usage, but high blast-radius: any bug here silently changes who can access admin-only data, and it is the exact mechanism the new admin webhook endpoint will depend on) |
| `AuthUser` (type) | Project-wide (any file that reads `req.user`: auth.controller.ts, request-logger.middleware.ts, and transitively every controller/service that could inspect `req.user`) | 0 (pure type definition) | Medium (type-only; a shape change would ripple to every consumer of `req.user` at compile time) |
| `JwtPayload` (type) | 1 (used only inside `authenticate` for the `jwt.verify` cast) | 0 | Low (internal to the module, not exported) |

Notes:
- `requireRole`'s afferent coupling is currently very low (1) precisely because the codebase has applied fine-grained role gating to only a single route so far — this is expected to grow (e.g., with the new admin webhook replay endpoint) without requiring any change to the component itself, which is a sign of good cohesion/low coupling design for this specific piece.
- `authenticate`'s afferent coupling (5) reflects that it is the de facto default guard for almost the entire authenticated surface of the API; it is the highest-blast-radius piece of this component.

---

## 7. Endpoints

The component itself exposes no HTTP endpoints (it is middleware). The following table lists every REST endpoint in the project alongside its current authentication/authorization posture, since that is the operative "interface" of this component as experienced by the rest of the system, and directly informs where/how a new admin-only endpoint should be wired.

| Endpoint | Method | `authenticate` applied | `requireRole` applied | Description |
|----------|--------|------------------------|------------------------|-------------|
| /api/v1/auth/register | POST | No | No | Public user registration |
| /api/v1/auth/login | POST | No | No | Public login, issues JWT |
| /api/v1/auth/me | GET | Yes | No | Get own profile (any authenticated role) |
| /api/v1/users/:id | GET | Yes | Yes — `ADMIN` | Get any user's profile by ID (admin only) |
| /api/v1/customers | GET, POST | Yes (router-level) | No | List / create customers (any authenticated role) |
| /api/v1/customers/:id | GET, PATCH, DELETE | Yes (router-level) | No | Get / update / delete a customer (any authenticated role) |
| /api/v1/products | GET, POST | Yes (router-level) | No | List / create products (any authenticated role) |
| /api/v1/products/:id | GET, PATCH, DELETE | Yes (router-level) | No | Get / update / delete a product (any authenticated role) |
| /api/v1/orders | GET, POST | Yes (router-level) | No | List / create orders (any authenticated role) |
| /api/v1/orders/:id | GET, DELETE | Yes (router-level) | No | Get / delete an order (any authenticated role) |
| /api/v1/orders/:id/status | PATCH | Yes (router-level) | No | Change order status (any authenticated role) |
| /health | GET | No | No | Liveness check, outside `/api/v1`, no auth |

**How to apply `requireRole('ADMIN')` to a new admin webhook replay endpoint** (the exact, minimal-change pattern, mirroring `src/modules/users/user.routes.ts:12-18`):

```ts
import { Router } from 'express';
import { authenticate, requireRole } from '../../middlewares/auth.middleware.js';
import { validate } from '../../middlewares/validate.middleware.js';
import type { WebhookController } from './webhook.controller.js'; // hypothetical new controller

export function buildWebhookRouter(controller: WebhookController): Router {
  const router = Router();

  router.post(
    '/replay',                     // or '/:id/replay', per the new feature's schema
    authenticate,                  // MUST come first — populates req.user from the JWT
    requireRole('ADMIN'),          // reused verbatim — no changes to auth.middleware.ts needed
    validate({ /* params/body schema, if any */ }),
    controller.replay,             // new controller action
  );

  return router;
}
```
Then register the new router in `src/routes/index.ts` alongside the existing `router.use('/customers', ...)` etc. calls, e.g. `router.use('/webhooks', buildWebhookRouter(controllers.webhooks));`, and wire the new controller/service into `buildControllers` in `src/app.ts`. No modification to `auth.middleware.ts` itself is required — this is exactly the intended, already-proven reuse path (identical to how `user.routes.ts` gates its single admin route today).

---

## 8. Integration Points

| Integration | Type | Purpose | Protocol | Data Format | Error Handling |
|-------------|------|---------|----------|-------------|----------------|
| `jsonwebtoken` library | External library (in-process) | Sign (in `auth.service.ts`) and verify (in this component) JWTs | In-process function call | JWT (base64url, HMAC-signed) | try/catch around `jwt.verify`; all failures normalized to `401 UnauthorizedError` |
| `env.JWT_SECRET` / `env.JWT_EXPIRES_IN` | Configuration (env vars via Zod-validated `env.ts`) | Shared secret for signing/verification; token lifetime | Process environment | String | Fails fast at process startup if `JWT_SECRET` < 16 chars (`env.ts:8`, `process.exit(1)` on invalid config) |
| Express `Request`/`Response` pipeline | Internal framework integration | Middleware chain execution, `next(err)` propagation | In-process (Express middleware contract) | N/A | Errors passed to `next()` are routed to `errorMiddleware` |
| `errorMiddleware` | Internal middleware | Converts `UnauthorizedError`/`ForbiddenError` (and other `AppError`s) into JSON HTTP responses | In-process | JSON (`{ error: { code, message } }`) | Centralized; this component does not format responses itself |

This component makes no direct calls to a database, cache, message queue, or any external HTTP service — it is entirely stateless and in-process.

---

## 9. Design Patterns & Architecture

| Pattern | Implementation | Location | Purpose |
|---------|----------------|----------|---------|
| Middleware chain / Chain of Responsibility | `authenticate`, `requireRole`, `validate` composed in sequence per route | src/modules/*/*.routes.ts | Layered request processing: identity, then authorization, then input validation, then business logic |
| Factory function (higher-order function) | `requireRole(...roles)` returns a closured `RequestHandler` | src/middlewares/auth.middleware.ts:49-61 | Parameterizes the same authorization logic per-route without duplicating code |
| Fail-closed / deny-by-default | Every branch in both functions either calls `next(err)` with a rejection or falls through to `next()` on success; there is no implicit "allow" path | src/middlewares/auth.middleware.ts (entire file) | Security-oriented default: any ambiguous or malformed input is rejected rather than passed through |
| Declaration merging / module augmentation | `declare module 'express-serve-static-core'` extends `Request` with `user?` and `id?` | src/middlewares/auth.middleware.ts:12-17 | Project-wide, type-safe access to `req.user` without a custom Request subtype |
| Centralized error taxonomy (Error hierarchy) | `AppError` base class with `statusCode`/`errorCode`; `UnauthorizedError`/`ForbiddenError` subclasses | src/shared/errors/app-error.ts, http-errors.ts | Consistent, single-point HTTP error formatting decoupled from where the error originates |
| Stateless authentication (no session store) | `authenticate` performs no DB/cache lookup; identity is entirely reconstructed from the JWT | src/middlewares/auth.middleware.ts:40-46 | Horizontal scalability without shared session state; tradeoff is no server-side token revocation |

---

## 10. Technical Debt & Risks

| Risk Level | Component Area | Issue | Impact |
|------------|----------------|-------|--------|
| High | `requireRole` usage / test coverage | Zero automated tests exercise `requireRole` or the one route that uses it (`GET /api/v1/users/:id`) — no test asserts 403 for a non-admin, 200 for an admin, or 401 for missing auth on this route | A regression in role enforcement (e.g., an accidental removal of `requireRole('ADMIN')`, or a typo in the role literal) would not be caught by CI; directly relevant since a new admin-only endpoint is about to depend on the same untested mechanism |
| Medium | `authenticate` | JWT verification errors are collapsed into one generic message/status, with the underlying `jsonwebtoken` error (e.g., `TokenExpiredError`) silently discarded (`catch { ... }` with no bound variable) | Reduced observability/debuggability of authentication failures in production logs; cannot easily distinguish "expired" from "tampered" from "wrong secret" without additional instrumentation |
| Medium | `authenticate` | No revocation/blacklist mechanism — a compromised or logged-out token remains valid until natural expiry (`JWT_EXPIRES_IN`, default `8h`) | An admin token cannot be invalidated early (e.g., on role downgrade, account deactivation, or suspected compromise) without waiting out the token's lifetime |
| Medium | Role/claim contract | The JWT claim shape (`{ sub, email, role }`) is duplicated by convention between the signer (`auth.service.ts:49`) and the verifier (`auth.middleware.ts:19-25`, `JwtPayload` type) with no shared type/schema enforcing they stay in sync | A future change to one side (e.g., renaming `sub` or adding a new required claim) could silently desynchronize from the other side, only surfaced at runtime |
| Medium | `authenticate` | The decoded JWT payload is trusted via an unchecked type assertion (`payload as JwtPayload`) rather than a runtime schema validation (e.g., Zod) of the decoded claims | A malformed or unexpected payload structure (e.g., missing `role`) would only fail downstream (e.g., `roles.includes(undefined)` evaluating false) rather than failing explicitly and diagnosably at the point of decode |
| Low | `req.user` staleness | `req.user.role` reflects the role at token-issuance time, not the current database state; no re-fetch occurs on each request | A user's role change (e.g., ADMIN demoted to OPERATOR) does not take effect until their token expires or they re-authenticate — relevant to anyone assuming role changes are immediate |
| Low | Role model | Only a flat, closed two-value role enum (`ADMIN` | `OPERATOR`) with no hierarchy, scopes, or resource-level permissions is supported | Any future requirement more granular than "is admin / is not admin" (e.g., per-resource ownership checks) is out of scope for this component and would need to be built elsewhere |
| Low | Error message consistency | `requireRole`'s defensive `if (!req.user)` branch throws `UnauthorizedError()` with the default message ("Unauthorized"), while `authenticate`'s own missing-header case uses a more specific message — minor inconsistency in message specificity between the two failure paths | Minimal user-facing impact since this branch should not be reachable under correct route wiring, but could confuse debugging if it is ever hit |

---

## 11. Test Coverage Analysis

| Component/Route | Unit Tests | Integration Tests | Coverage | Test Quality |
|------------------|------------|--------------------|----------|---------------|
| `authenticate` (direct/isolated unit test) | 0 | 0 | None as an isolated unit — only indirectly exercised | No dedicated test file targets `src/middlewares/auth.middleware.ts` directly; no unit test mocks `req`/`res`/`next` to test `authenticate` in isolation |
| `authenticate` (via integration tests) | 0 | 2 (indirect) | Partial | Exercised indirectly through `tests/auth.test.ts:65-83` (`GET /auth/me` with a valid token returns 200; without a token returns 401) and through every `orders.test.ts` request (all requests attach a valid `Bearer` token). No test exercises an *invalid*, *expired*, or *malformed* (wrong scheme, empty token) Authorization header anywhere in the suite. |
| `requireRole` | 0 | 0 | **None** | No test in `tests/auth.test.ts` or `tests/orders.test.ts` calls `GET /api/v1/users/:id` — the only route in the codebase that uses `requireRole` is completely untested. There is no test asserting: (a) an `ADMIN` token succeeds, (b) an `OPERATOR` token gets `403 FORBIDDEN`, (c) no token gets `401`. `tests/helpers/factories.ts:76` does provide `bootstrapAuthenticatedUser(role)` which already supports creating either an `ADMIN` or `OPERATOR` test user and could be used to write such a test, but no test currently does so. |
| `GET /api/v1/users/:id` (route using `requireRole`) | 0 | 0 | **0%** | Not referenced anywhere in `tests/` (confirmed via project-wide search for `users/` inside the `tests/` directory) |
| `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | 0 | 7 (`tests/auth.test.ts`) | Good for the happy/common paths | Covers: successful registration (201, public shape only, no `passwordHash`/`password` leak), duplicate email (409), invalid payload (400 + validation details array), successful login (200 + token shape), wrong password (401), `/me` with valid token (200), `/me` without token (401). Does not cover: invalid/expired/malformed token on `/me`, wrong-scheme Authorization header, token signed with a different/wrong secret. |
| `/orders/*` (via `authenticate` only) | 0 | 9 (`tests/orders.test.ts`) | Good for business-logic paths (order lifecycle, stock, status transitions) | Every request uses a valid Bearer token (`bootstrapAuthenticatedUser()` default `OPERATOR` role) — the tests are not designed to probe `authenticate`/`requireRole` edge cases; they use the middleware only as a precondition to reach the order business logic under test. |
| `/customers/*`, `/products/*` | 0 | 0 (no dedicated test file found) | None | No `customers.test.ts` or `products.test.ts` file exists in `tests/`; these routers' reliance on `router.use(authenticate)` is untested at the route level (only indirectly exercised where `orders.test.ts` creates customers/products via helper factories that call Prisma directly, not via the HTTP routes). |

**Test infrastructure notes** (for context, not part of the component itself):
- Tests run via Vitest (`vitest.config.ts`), using Supertest against an app built by `getTestApp()` (`tests/helpers/factories.ts:10-15`), backed by a real Prisma-connected database that is reset between tests (`tests/setup.ts:8-16`, deleting all `User`, `Product`, `Customer`, `Order`, etc. rows in `beforeEach`).
- `tests/helpers/factories.ts:76-83` (`bootstrapAuthenticatedUser`) already provides exactly the fixture needed to write ADMIN-vs-OPERATOR authorization tests (it creates a user with a given role and performs a real login to obtain a genuine, correctly-signed token) — this exists in the codebase but is only ever called with its default `OPERATOR` role by `orders.test.ts`; no test currently calls it with `'ADMIN'`.

**Overall assessment:** The `authenticate` half of this component has reasonable indirect coverage of its two primary success/failure outcomes (valid token → 200, no token → 401) through unrelated feature tests, but no coverage at all of malformed-header, wrong-scheme, or invalid/expired-token paths. The `requireRole` half — the exact mechanism a new admin webhook replay endpoint is intended to reuse — has **no test coverage whatsoever**, either directly or through its sole existing consumer route. This is the most significant testing gap identified in this analysis and is directly material to the stated purpose of reusing `requireRole('ADMIN')` on a new endpoint without first establishing a regression safety net for the mechanism itself.

---
