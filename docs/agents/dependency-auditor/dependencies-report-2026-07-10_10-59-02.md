# Dependency Audit Report

**Project:** order-management-api (mba-ia-desafio-design-docs-com-ia)
**Audit date:** 2026-07-10
**Scope:** Entire project root
**Excluded folders:** node_modules, dist, coverage, .git, .claude
**Ecosystem detected:** Node.js / TypeScript (npm), single manifest (`package.json` + `package-lock.json`)
**Verification method:** npm registry API (`registry.npmjs.org`), `npm audit --package-lock-only` (read-only, lockfile-based, no install performed), GitHub Security Advisories, GitHub repositories, and web search. No project files were modified during this audit.

---

## 1. Summary

The project is a single-service Node.js/TypeScript REST API ("Order Management System") built on Express, Prisma (MySQL), Zod, and Pino, with JWT-based authentication (`jsonwebtoken`) and password hashing (`bcrypt`). It has **one dependency manifest** (`package.json`, npm ecosystem) with **8 direct production dependencies** and **17 direct development dependencies**. A `package-lock.json` is present, so builds are reproducible.

Overall dependency health is **weak**: every direct production dependency is at least one release behind its current latest stable version, three of them are one or more **major** versions behind (`@prisma/client`/`prisma`, `uuid`, and effectively `express` and `zod` are on the previous major line), and several carry **known, publicly disclosed vulnerabilities** confirmed via `npm audit` against the committed lockfile. In addition, the project's `engines` field requires Node.js `>=20`, and **Node.js 20 reached end-of-life on 2026-04-30** — over two months before this audit — meaning the runtime itself no longer receives security patches from the Node.js project.

Key figures:
- 15 vulnerabilities detected by `npm audit` against the lockfile: 1 critical, 6 high, 8 moderate (mix of direct and transitive).
- 4 of those vulnerabilities affect **direct** dependencies: `express`, `tsx`, `uuid`, `vitest`.
- No direct dependency is formally "deprecated" on npm, but the `@types/uuid` dev dependency is redundant (uuid ships its own types) and ESLint 8 (installed) is two majors behind ESLint 10 (latest), which now requires the flat-config format the project does not use.
- License posture is low-risk: all direct dependencies use permissive licenses (MIT or Apache-2.0); the project itself is marked `"private": true` with no declared license, consistent with an internal/non-distributed service.

## 2. Critical Issues

1. **Node.js runtime end-of-life (Critical, infrastructure).** `package.json` declares `"engines": { "node": ">=20" }` and the dev dependency `@types/node` is pinned to `20.17.6`. Node.js 20 ("Iron") reached end-of-life on **2026-04-30**. Any environment still running Node 20 in production receives no further security patches from upstream, regardless of how current the npm dependencies are. This is the single highest-impact finding in the audit because it affects the entire runtime, not one library.

2. **Vitest — Critical RCE / arbitrary file read (direct devDependency, pinned `2.1.4`).**
   - `CVE-2025-24964` / GHSA-9crc-q9x8-hgqq — Cross-site WebSocket hijacking in Vitest's API server (no origin validation) allows an attacker-controlled website to trigger `saveTestFile` + `rerun` and achieve arbitrary code execution on the machine running Vitest. CVSS 9.6. Affects versions `>=2.0.0 <2.1.9` (installed `2.1.4` is in range).
   - `CVE-2026-47429` / GHSA-5xrq-8626-4rwp — Arbitrary file read/execution via the Vitest UI attachment endpoint using path-traversal, when the UI/API server is reachable. CVSS 9.8. Affects `<3.2.6` (installed `2.1.4` is in range).
   - Practical exploitability depends on the Vitest API/UI server being network-reachable (e.g., left bound to `0.0.0.0` in a container, CI runner, or dev machine on a shared network) while a developer visits a malicious site or an attacker reaches the port directly. Confirmed by `npm audit` as `critical` severity with a fix available (`vitest@4.1.10`, semver-major).

3. **Express — High severity, ReDoS and body-parsing DoS chain (direct dependency, pinned `4.21.1`).** `npm audit` flags the installed range (`4.0.0-rc1 - 4.22.1`) as vulnerable via three advisories in its dependency chain:
   - `CVE-2024-52798` / GHSA-rhx6-c78j-4q9w and GHSA-37ch-88jc-xwx2 — ReDoS in `path-to-regexp` (bundled transitively through Express's router), CVSS 7.7/7.5.
   - GHSA-6rw7-vpxm-498p / GHSA-q8mj-m7cp-5q26 (via `qs`, used by `body-parser`) — DoS via crafted query strings / bracket-notation arrays.
   Fix available without a major bump: `express@4.22.2` (patch-level within the 4.x line already resolves the immediate advisories; the npm-recommended latest overall is `5.2.1`, a major upgrade with breaking changes — see Risk Analysis).

4. **uuid — Moderate, buffer bounds bypass (direct dependency, pinned `11.0.3`).** `CVE-2026-41907` / GHSA-w5hq-g745-h8pq: `v3()`, `v5()`, and `v6()` do not validate offset/buffer bounds when a caller-supplied buffer is passed, unlike `v1()`, `v4()`, `v7()`. This can silently truncate/corrupt generated UUIDs instead of throwing. Fixed in `11.1.1`. The current codebase only calls the no-argument UUID generator form (see Integration Notes), which limits — but does not eliminate — exposure if any code path is added later that passes external buffers.

5. **tsx — Moderate, dev-server request exposure (direct devDependency, pinned `4.19.2`).** GHSA-67mh-4wv8-2f99: bundled `esbuild` (`<=0.24.2`) dev server accepts cross-origin requests without validation (CWE-346), allowing any website to send requests to the dev server and read responses while it's running. Dev-time only; fixed by upgrading `tsx` to `4.23.0` (non-major).

6. **Legacy ESLint configuration format (High, maintenance burden).** The project ships `.eslintrc.json` and pins `eslint@8.57.1`, two majors behind the current `10.6.0`. ESLint 9 made flat config (`eslint.config.js`) the default and ESLint 10 **removed support entirely** for the legacy `.eslintrc*` format. This means the lint tooling cannot be upgraded past ESLint 8 without first migrating the configuration file — a blocking dependency between two otherwise independent upgrades.

7. **Two-major-version gap in the ORM layer (High).** `@prisma/client` and `prisma` are pinned to `5.22.0` against a current latest of `7.8.0`. Prisma 7 changes the client generator (`prisma-client-js` → `prisma-client`), requires explicit driver adapters, moves configuration to a `prisma.config.ts` file, and stops auto-loading `.env` files. No CVE is currently published against Prisma 5, but the widening gap increases migration risk and the version in use will eventually fall out of the maintained support window.

## 3. Dependencies

### Production dependencies

| Dependency | Current Version | Latest Version | Status |
|---|---|---|---|
| @prisma/client | 5.22.0 | 7.8.0 | Legacy (2 majors behind) |
| bcrypt | 5.1.1 | 6.0.0 | Outdated (1 major behind) |
| express | 4.21.1 | 5.2.1 | Outdated / Vulnerable |
| jsonwebtoken | 9.0.2 | 9.0.3 | Outdated (patch behind) |
| pino | 9.5.0 | 10.3.1 | Outdated (1 major behind) |
| pino-http | 10.3.0 | 11.0.0 | Outdated (1 major behind) |
| uuid | 11.0.3 | 14.0.1 | Legacy / Vulnerable (3 majors behind) |
| zod | 3.23.8 | 4.4.3 | Outdated (1 major behind) |

### Development dependencies

| Dependency | Current Version | Latest Version | Status |
|---|---|---|---|
| @types/bcrypt | 5.0.2 | 6.0.0 | Outdated (1 major behind) |
| @types/express | 4.17.21 | 5.0.6 | Outdated (1 major behind) |
| @types/jsonwebtoken | 9.0.7 | 9.0.10 | Outdated (patch behind) |
| @types/node | 20.17.6 | 26.1.1 | Legacy (tracks EOL Node 20 runtime) |
| @types/supertest | 6.0.2 | 7.2.0 | Outdated (1 major behind) |
| @types/uuid | 10.0.0 | 11.0.0 | Outdated / Redundant (uuid ships own types) |
| @typescript-eslint/eslint-plugin | 8.13.0 | 8.63.0 | Outdated (minor/patch behind) |
| @typescript-eslint/parser | 8.13.0 | 8.63.0 | Outdated (minor/patch behind) |
| eslint | 8.57.1 | 10.6.0 | Legacy (2 majors behind) |
| eslint-config-prettier | 9.1.0 | 10.1.8 | Outdated (1 major behind) |
| pino-pretty | 11.3.0 | 13.1.3 | Outdated (2 majors behind) |
| prettier | 3.3.3 | 3.9.5 | Outdated (minor behind) |
| prisma | 5.22.0 | 7.8.0 | Legacy (2 majors behind) |
| supertest | 7.0.0 | 7.2.2 | Outdated (minor behind) |
| tsx | 4.19.2 | 4.23.0 | Outdated / Vulnerable (minor behind) |
| typescript | 5.6.3 | 7.0.2 | Legacy (2 majors behind) |
| vitest | 2.1.4 | 4.1.10 | Legacy / Vulnerable (2 majors behind) |

No direct dependency in this project is formally marked `deprecated` on the npm registry at its currently installed version.

## 4. Risk Analysis

| Severity | Dependency | Issue | Details |
|---|---|---|---|
| Critical | Node.js runtime (engines >=20) | End-of-life runtime | Node.js 20 reached EOL 2026-04-30; no further security patches from upstream regardless of npm package freshness. |
| Critical | vitest (2.1.4) | CVE-2025-24964 | CSWSH in Vitest API server enables remote code execution when the API server is reachable and a developer visits a malicious site. CVSS 9.6. Fixed in 2.1.9 / 3.0.5+. |
| Critical | vitest (2.1.4) | CVE-2026-47429 | Path-traversal in Vitest UI attachment endpoint allows arbitrary file read/execution when the UI server is exposed, especially on Windows. CVSS 9.8. Fixed in 3.2.6 / 4.1.0. |
| High | express (4.21.1) | CVE-2024-52798 (GHSA-rhx6-c78j-4q9w, GHSA-37ch-88jc-xwx2) | ReDoS in `path-to-regexp`, a transitive dependency pulled in by Express's router, reachable via crafted routes/paths. CVSS ~7.5-7.7. |
| High | express (4.21.1) | GHSA-6rw7-vpxm-498p / GHSA-q8mj-m7cp-5q26 (via `qs`/`body-parser`) | Denial of service via crafted query-string bracket notation or comma-format arrays processed by `qs`, used internally by `body-parser`/Express. |
| High | eslint (8.57.1) + `.eslintrc.json` | Legacy config format | ESLint 9+ defaults to flat config; ESLint 10 (latest) no longer supports `.eslintrc*` at all. Upgrading the linter requires a configuration rewrite first, blocking routine dependency maintenance. |
| High | @prisma/client / prisma (5.22.0) | Two-major version gap | Prisma 7 changes the client generator name/output, requires explicit driver adapters, relocates config to `prisma.config.ts`, and stops auto-loading `.env`. Delaying the upgrade compounds migration effort and risk of eventually running an unsupported ORM version against a production database. |
| Medium | uuid (11.0.3) | CVE-2026-41907 (GHSA-w5hq-g745-h8pq) | `v3()`/`v5()`/`v6()` silently accept out-of-range buffer/offset instead of throwing, risking malformed identifiers if external buffers are ever passed. Fixed in 11.1.1. Current usage only calls the argument-less form, limiting present exposure. |
| Medium | tsx (4.19.2) | GHSA-67mh-4wv8-2f99 (bundled esbuild) | Dev server accepts unauthenticated cross-origin requests, allowing any website to read responses from a running `tsx watch` process. Dev-time exposure only. |
| Medium | zod (3.23.8) | 1 major behind (v4 available) | No active CVE at the pinned version (prior ReDoS CVE-2023-4316 in the email regex was already fixed in 3.22.3). Zod 4 changes error-customization APIs, moves string-format validators to top-level functions, and removes `ZodError.errors`/`.formErrors` — a non-trivial but codemod-assisted migration. |
| Medium | typescript (5.6.3) | 2 majors behind | TypeScript 7.0 is a from-scratch Go-native compiler port with hard-error breaking changes (strict-by-default, `module: esnext` default, removal of legacy flags such as `target: es5`, `baseUrl`, `moduleResolution: node`). Build-time only risk, but the compiler rewrite means the upgrade path is materially different from a typical minor bump. |
| Low | bcrypt (5.1.1) | 1 major behind | No published CVE at this version; upstream repository (`kelektiv/node.bcrypt.js`) shows active 2026 commit history, so the package itself is maintained — the project is simply not tracking the latest major. |
| Low | jsonwebtoken (9.0.2) | Patch behind | No published CVE at this version (the historical CVE-2022-23529 algorithm-confusion issue was fixed in 9.0.0, before this pin). |
| Low | pino / pino-http | 1 major behind each | No known vulnerabilities; logging-only exposure. |
| Low | @types/uuid (10.0.0) | Redundant dependency | `uuid` has shipped its own TypeScript types since v9; the newer `@types/uuid@11.0.0` is explicitly marked as a "stub" package on npm recommending removal, though the currently pinned `10.0.0` does not yet carry that deprecation notice. |
| Low | @mapbox/node-pre-gyp (transitive, via bcrypt) | High-severity `tar` advisory | Flagged by `npm audit` as high severity through its `tar` dependency. Listed for awareness only — it is not a direct dependency and is out of this audit's primary scope, but it is worth tracking because it is pulled in by the direct dependency `bcrypt` for native binary installation. |

## 5. Unverified Dependencies

None. All direct dependencies declared in `package.json` were successfully resolved against the npm registry (current version, latest version, license, deprecation flag) and cross-checked against `npm audit --package-lock-only` and GitHub Security Advisories. No other dependency manifests (Python, Go, Java, PHP, Rust, etc.) were found in the project.

## 6. Critical File Analysis

The following files were identified as the most critical with respect to risky/outdated dependency exposure, based on business impact, blast radius (how many features route through the file), and concentration of vulnerable or legacy libraries.

1. **`src/app.ts`** — The composition root: builds the Express app, wires every controller/service/repository for all five modules (users, auth, customers, products, orders), and mounts the global error middleware. It is the single point of failure for the entire HTTP surface and directly instantiates `express()` — the component carrying the High-severity ReDoS/DoS advisories. Any Express-level fix or upgrade must be validated here first.

2. **`src/server.ts`** — Process entrypoint; owns the HTTP server lifecycle and the Prisma disconnect on shutdown. Bridges the outdated `@prisma/client` (2 majors behind) and `express` into the running process; a crash or unhandled exception path here affects 100% of uptime.

3. **`src/middlewares/auth.middleware.ts`** — The authentication gate for every protected route (`authenticate`, `requireRole`). Directly calls `jsonwebtoken`'s `jwt.verify` with `env.JWT_SECRET`. Because this is the sole enforcement point for authorization across all modules, any jsonwebtoken vulnerability or misconfiguration has system-wide impact.

4. **`src/modules/auth/auth.service.ts`** — Contains the two most security-sensitive dependency calls in the codebase: `bcrypt.compare` for password verification and `jwt.sign` for issuing access tokens. A regression or vulnerability in either `bcrypt` or `jsonwebtoken` compromises authentication for every user in one place.

5. **`src/modules/users/user.service.ts`** — Handles user creation/password management and is the other call site for `bcrypt` (hashing on write). Combined with `auth.service.ts`, these two files represent the entire password-handling surface of the application.

6. **`src/config/env.ts`** — Validates all runtime configuration (including `DATABASE_URL` and `JWT_SECRET`) using `zod`. It is the first code to execute and the gatekeeper for every environment variable the app depends on; a `zod` behavior change (e.g., in a future v4 migration) here would affect startup for the whole service.

7. **`src/config/database.ts`** — Instantiates the single shared `PrismaClient` used by every repository in the codebase. This is the single point of failure for all database access and the direct integration point with the two-majors-behind `@prisma/client` dependency flagged as High risk.

8. **`src/middlewares/request-logger.middleware.ts`** — Runs on every single HTTP request; generates correlation IDs via `uuid` (the dependency carrying the Medium-severity buffer-bounds CVE) and logs through `pino-http`. Because it sits in the global middleware chain, it has the broadest per-request blast radius of any file that touches a vulnerable dependency.

9. **`src/shared/logger/index.ts`** — Creates the singleton `pino` logger instance imported throughout the codebase (services, middlewares, `server.ts`). A logging outage or behavior change here affects observability for the entire application, including error handling and shutdown diagnostics.

10. **`src/modules/orders/order.service.ts`** (255 lines, the largest domain module) together with **`src/modules/orders/order.repository.ts`** — Contains the order state machine and the heaviest concentration of direct `@prisma/client` calls (transactions spanning orders, stock, and status transitions) of any module in the codebase. This makes it the module most exposed to any Prisma 5→7 migration and the most business-critical in terms of revenue/order-integrity impact if the data layer misbehaves.

## 7. Integration Notes

- **express** — Instantiated once in `src/app.ts` (`buildApp`); used for routing (`buildApiRouter`), JSON body parsing (`express.json({ limit: '1mb' })`), and the global error/not-found middlewares. All five domain modules (`auth`, `users`, `customers`, `products`, `orders`) mount their routers through it (16 files reference `express`).
- **@prisma/client** — A single `PrismaClient` instance is created in `src/config/database.ts` and injected into every repository (`UserRepository`, `CustomerRepository`, `ProductRepository`, `OrderRepository`) and into `OrderService` directly for transactional operations (14 files reference it).
- **bcrypt** — Used in exactly two files: `auth.service.ts` (login verification via `bcrypt.compare`) and `user.service.ts` (password hashing on user creation/update).
- **jsonwebtoken** — Used in exactly two files: `auth.service.ts` (token issuance via `jwt.sign`) and `auth.middleware.ts` (token verification via `jwt.verify`). No other module touches JWTs directly.
- **pino / pino-http** — `pino` is instantiated once in `src/shared/logger/index.ts` and imported wherever structured logging is needed (services, `server.ts`). `pino-http` wraps it for HTTP access logging in `request-logger.middleware.ts`.
- **uuid** — Used for request-correlation IDs in `request-logger.middleware.ts` and referenced in the Zod schemas/routes of `users`, `customers`, `orders`, and `products` modules (likely for ID format validation), six files total.
- **zod** — Used across nine files, primarily as the request/response schema-validation layer (`*.schemas.ts` per module) and for environment-variable validation in `src/config/env.ts`, enforced through `src/middlewares/validate.middleware.ts`.
- **Dev tooling (typescript, tsx, vitest, eslint, prettier, prisma CLI, supertest)** — `tsx` powers `npm run dev` and seeding; `vitest` runs the test suite (`tests/*.test.ts`) together with `supertest` for HTTP-level assertions; `eslint`/`prettier` gate code style via `npm run lint`/`format`; the `prisma` CLI drives migrations (`prisma/migrations`) and seeding independent of the runtime `@prisma/client` version pin.

---

## Report Metadata

- **Report file:** `docs/agents/dependency-auditor/dependencies-report-2026-07-10_10-59-02.md`
- **Generated:** 2026-07-10
- **Verification sources:** npm registry (registry.npmjs.org), `npm audit --package-lock-only` against the committed `package-lock.json`, GitHub Security Advisories (GHSA/CVE cross-references), and web search of official vendor documentation (Prisma, Zod, Express, ESLint, TypeScript, Node.js EOL schedule).
- **No project files were modified. This report is analysis-only.**
