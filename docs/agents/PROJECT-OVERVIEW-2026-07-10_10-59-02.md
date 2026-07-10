# mba-ia-desafio-design-docs-com-ia — Project Overview

**Generated on**: 2026-07-10 11:12:00

## Summary

The project is a small Node.js/TypeScript (strict) + Express 4 + Prisma 5/MySQL 8
Order Management System exposed as a REST API. It is organized as a modular monolith,
one module per domain (auth, users, customers, products, orders), each following a
uniform `routes → controller → service → repository` layering wired by hand in a
composition root (`src/app.ts`). MySQL via Prisma is the only external dependency —
there is no message broker, cache, queue, or outbound integration today. This absence
is exactly the gap the planned Order Webhooks feature is meant to fill.

The order lifecycle is governed by a small pure state machine (`order.status.ts`) with
6 statuses and 8 valid transitions, mutated only through `OrderService.changeStatus`,
which performs the transition, stock debit/replenish, and history append inside a single
Prisma transaction. Cross-cutting concerns — the `AppError` taxonomy, the centralized
error middleware, and the Pino logger — are single, consistently reused components.

`docs/PRD.md`, `docs/FDD.md`, `docs/RFC.md`, `docs/TRACKER.md` are still placeholders and
`docs/adrs/` is empty; producing them is the object of this challenge.

## Architecture Overview

- Modular monolith, module-per-domain under `src/modules/*`, uniform 4-layer stack.
- Composition root at `src/app.ts`; process entrypoint at `src/server.ts`.
- Authentication via JWT (`authenticate`); authorization via `requireRole(...roles)`
  with a closed role enum `'ADMIN' | 'OPERATOR'`. `requireRole('ADMIN')` is currently
  applied on exactly one endpoint (`GET /api/v1/users/:id`).
- Order state machine: PENDING → {PAID, CANCELLED}; PAID → {PROCESSING, CANCELLED};
  PROCESSING → {SHIPPED, CANCELLED}; SHIPPED → DELIVERED; DELIVERED/CANCELLED terminal.
- `OrderService.changeStatus` (`src/modules/orders/order.service.ts:126-179`) is the single
  mutation point for order status and the natural integration point for the outbox.

## Dependencies Health

- All 25 direct dependencies (8 prod, 17 dev) were externally checked; none unverified.
- Licenses: all MIT/Apache-2.0, no compatibility concern.
- Several outdated packages and CVE advisories were reported by the auditor (Node 20 EOL,
  Vitest, Express 4.21.1, Prisma 5 → 7, uuid, ESLint config format).
- NOTE: some CVE identifiers in the raw report are future-dated and should be treated as
  unverified until independently confirmed. This challenge does not modify code, so these
  findings are informational context only and are NOT cited in the design deliverables.

## Components Analyzed (deep-dive, scoped to the webhooks feature)

- **Order Service — changeStatus**: single transactional mutation point for order status;
  exact outbox hook is between the history append (`order.service.ts:167`) and the final
  rehydration read (`:169`), with `tx`, `order`, `from`, `to` already in scope. `order.status`
  is stale at that point — transition endpoints must come from the passed `from`/`to`.
- **Error Taxonomy — AppError**: base carries `statusCode`, `errorCode`, `message`, `details?`;
  the error middleware recognizes any error by `instanceof AppError`. New `WEBHOOK_*` codes plug
  in via dedicated subclasses or parameterized errors, with no middleware change.
- **Role Guard — requireRole**: JWT-claim-based, `'ADMIN' | 'OPERATOR'`; the admin webhook
  replay endpoint reuses `authenticate` + `requireRole('ADMIN')` with no middleware change.
- **Order Status State Machine**: 6 statuses, 8 edges; the de facto contract for the webhook
  event filter and the `from_status`/`to_status` payload fields.

## Critical Findings

### Security Risks
- Authorization is thin: most mutations (including order status changes) require only
  `authenticate`, not a role. `requireRole` and its sole route have zero test coverage.
- Dependency advisories reported (Node 20 EOL, Vitest, Express) — informational only; some
  CVE IDs are unverified/future-dated.

### Technical Debt
- `prisma/seed.ts` re-implements a parallel transition/history view instead of reusing
  `order.status.ts` (drift risk).
- No central error-code registry — collision risk when adding the `WEBHOOK_*` family.
- Duplicated JWT claim/role shape between signer (`auth.service.ts`) and verifier, no shared schema.

### Single Points of Failure
- Singleton Prisma Client / single MySQL instance is a system-wide SPOF.
- `OrderNumberSequence` single-row counter serializes order creation.

## Reports Index

See [MANIFEST.md](./MANIFEST.md) for the complete list of all generated reports.
