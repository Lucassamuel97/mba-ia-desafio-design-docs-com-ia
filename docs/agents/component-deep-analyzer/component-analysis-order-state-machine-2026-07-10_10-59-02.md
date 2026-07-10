# Component Deep Analysis Report

**Component:** Order Status State Machine
**Primary file:** `src/modules/orders/order.status.ts`
**Analysis date:** 2026-07-10
**Analyzed by:** component-deep-analyzer

---

## 1. Executive Summary

`src/modules/orders/order.status.ts` is a small, pure, dependency-free TypeScript module that encodes the entire lifecycle of an `Order` in the Order Management System. It is the single source of truth for:

- The complete set of valid `OrderStatus` values (imported from the generated `@prisma/client` enum, itself declared in `prisma/schema.prisma:16-23`).
- The directed graph of allowed status transitions (`transitions` map, lines 3-10).
- Two derived query helpers over that graph (`canTransition`, `allowedTransitions`) and one classification helper (`isTerminal`).
- Two domain side-effect predicates that are transition-shaped but not part of the transition graph itself: `shouldDebitStock` (stock decrement on `PENDING → PAID`) and `shouldReplenishStock` (stock increment on cancellation from `PAID` or `PROCESSING`).

The module has exactly one runtime consumer today: `OrderService.changeStatus` in `src/modules/orders/order.service.ts:126-179`, which is the only code path in the entire codebase that mutates `Order.status`. The module exports no classes, holds no state, and performs no I/O — it is a pure, side-effect-free lookup table plus four small pure functions operating on it.

Key findings:

- The state machine is intentionally linear/mostly-linear: `PENDING → PAID → PROCESSING → SHIPPED → DELIVERED`, with `CANCELLED` reachable only from `PENDING`, `PAID`, or `PROCESSING`, and no path back into an earlier state (no cycles, no skips except the ones explicitly listed).
- `DELIVERED` and `CANCELLED` are the only terminal states (`isTerminal` returns true for both because their transition arrays are empty).
- Two of the four exported functions (`allowedTransitions` and `isTerminal`) are **not currently invoked anywhere** in the codebase (application code or tests). They exist as a public surface with no current consumer — a strong signal that they were authored in anticipation of a future consumer, most plausibly the upcoming webhooks feature described in `TRANSCRICAO.md` and `DESAFIO.md`.
- There is no unit test file dedicated to `order.status.ts`. Its behavior is exercised only indirectly, through HTTP-level integration tests in `tests/orders.test.ts` that drive `OrderService.changeStatus` via `PATCH /api/v1/orders/:id/status`.
- `prisma/seed.ts` independently re-implements a partial, reversed view of the same transition graph (`flowFromStatus`, `prisma/seed.ts:255-261`) instead of importing `allowedTransitions`/`transitions` from `order.status.ts`. This is a duplication risk: the two representations of "valid history" can silently drift apart if the state machine changes.
- The module is architecturally significant beyond its size: the upcoming Order Webhooks feature (per `TRANSCRICAO.md:194,198`) filters outbound events by target status ("only notify me when it becomes SHIPPED or DELIVERED") and the outbox record is expected to carry `from_status`/`to_status`. Both of those values are produced by exactly the code path this module gates (`canTransition` inside `OrderService.changeStatus`), making `order.status.ts` the de facto contract that any webhook event-filtering logic will need to agree with.

---

## 2. Data Flow Analysis

The state machine itself has no entry/exit points of its own (it is a pure function library). The relevant data flow is the request path through its sole consumer, `OrderService.changeStatus`:

```
1. HTTP PATCH /api/v1/orders/:id/status
   → src/modules/orders/order.routes.ts:19-23 (route registered, auth + validation middleware attached)
2. Middleware: authenticate (src/middlewares/auth.middleware.ts:27) verifies JWT, sets req.user
3. Middleware: validate({ params: orderIdParamSchema, body: updateOrderStatusSchema })
   (src/middlewares/validate.middleware.ts) parses/coerces req.params.id (UUID) and
   req.body.{toStatus, reason} against Zod schemas in order.schemas.ts:18-21
4. OrderController.changeStatus (order.controller.ts:38-46)
   → calls OrderService.changeStatus(id, body, req.user.id)
5. OrderService.changeStatus (order.service.ts:126-179), inside prisma.$transaction:
   a. Load current order + items (tx.order.findUnique)                       [order.service.ts:132-135]
   b. from = order.status; to = input.toStatus                               [order.service.ts:138-139]
   c. Same-status guard: from === to → ConflictError INVALID_STATUS_TRANSITION [order.service.ts:140-146]
   d. canTransition(from, to)  ← order.status.ts:12-14                        [order.service.ts:147-149]
      → false: throw InvalidStatusTransitionError(from, to) (HTTP 409, code INVALID_STATUS_TRANSITION)
   e. shouldDebitStock(from, to) ← order.status.ts:29-31                      [order.service.ts:151-153]
      → true: debitStock() validates stock availability, decrements Product.stockQuantity,
        or throws InsufficientStockError (HTTP 422) which rolls back the whole transaction
   f. shouldReplenishStock(from, to) ← order.status.ts:33-37                  [order.service.ts:154-156]
      → true: replenishStock() increments Product.stockQuantity back
   g. tx.order.update({ status: to })                                        [order.service.ts:158]
   h. tx.orderStatusHistory.create({ fromStatus: from, toStatus: to, ... })   [order.service.ts:159-167]
   i. Re-fetch order with relations (items, history, customer)                [order.service.ts:169-176]
6. OrderController.changeStatus responds 200 with the refreshed OrderWithRelations JSON
7. On any thrown AppError subclass, Express error middleware
   (src/middlewares/error.middleware.ts) maps it to { error: { code, message, details } }
   with the corresponding HTTP status code
```

Notable characteristics of this flow:

- `canTransition` is evaluated strictly *after* the same-status short-circuit, so `canTransition(from, from)` (which would always be `false`, since no status transitions to itself in the map) is never actually reached in practice for the identity case — the identity case has its own distinct error code (`INVALID_STATUS_TRANSITION` via `ConflictError`, not `InvalidStatusTransitionError`, though both surface as HTTP 409 with the same error code string).
- The stock side-effect predicates (`shouldDebitStock`, `shouldReplenishStock`) are evaluated independently of `canTransition` but always *after* it, so they only ever run on transitions already confirmed valid by the state machine.
- Everything — status validation, stock mutation, status update, history insert, and re-read — happens inside one Prisma transaction (`this.prisma.$transaction`). There is currently no post-transaction hook (no event emission, no outbox insert), which is the exact extension point the future webhooks feature is expected to use (per `TRANSCRICAO.md:238-242`, which proposes a `publishWebhookEvent(tx, order, fromStatus, toStatus)` call inserted into this same transaction).

---

## 3. Business Rules & Logic

### Overview of the business rules

| Rule Type | Rule Description | Location |
|-----------|-------------------|----------|
| Domain enumeration | Order lifecycle has exactly 6 statuses: PENDING, PAID, PROCESSING, SHIPPED, DELIVERED, CANCELLED | `prisma/schema.prisma:16-23`, `src/modules/orders/order.status.ts:3-10` |
| Transition rule | PENDING → PAID or CANCELLED only | `order.status.ts:4` |
| Transition rule | PAID → PROCESSING or CANCELLED only | `order.status.ts:5` |
| Transition rule | PROCESSING → SHIPPED or CANCELLED only | `order.status.ts:6` |
| Transition rule | SHIPPED → DELIVERED only (cancellation no longer possible) | `order.status.ts:7` |
| Terminal state rule | DELIVERED has no outgoing transitions | `order.status.ts:8` |
| Terminal state rule | CANCELLED has no outgoing transitions | `order.status.ts:9` |
| Validation | `canTransition(from, to)` must be true or the change is rejected | `order.status.ts:12-14`, enforced in `order.service.ts:147-149` |
| Validation | Same-status transition (`from === to`) is rejected before reaching `canTransition` | `order.service.ts:140-146` |
| Business logic | Stock is debited exactly once, on PENDING → PAID | `order.status.ts:24-31`, `order.service.ts:151-153` |
| Business logic | Stock is replenished only when cancelling from PAID or PROCESSING | `order.status.ts:33-37`, `order.service.ts:154-156` |
| Business logic | No stock replenishment on cancellation from PENDING (stock was never debited) | `order.status.ts:33-37` (from must be PAID or PROCESSING) |
| Business logic | No stock replenishment path exists for SHIPPED/DELIVERED (consistent with them not allowing CANCELLED as a target) | `order.status.ts:7-8` |
| Consumer rule | Every status mutation is recorded in `OrderStatusHistory` with `fromStatus`/`toStatus` | `order.service.ts:159-167`, `prisma/schema.prisma:116-131` |
| Consumer rule | Order deletion is only allowed while status is PENDING or CANCELLED | `order.service.ts:181-192` (uses raw status comparison, not `order.status.ts` helpers) |
| Dormant/unused rule | `allowedTransitions(from)` exposes the full set of valid next statuses for a given status | `order.status.ts:16-18` (no current caller) |
| Dormant/unused rule | `isTerminal(status)` classifies DELIVERED and CANCELLED as terminal | `order.status.ts:20-22` (no current caller) |

### Detailed breakdown of the business rules

---

### Business Rule: Order Status Transition Graph

**Overview**:
The `transitions` constant (`order.status.ts:3-10`) is a `Readonly<Record<OrderStatus, ReadonlyArray<OrderStatus>>>` that exhaustively maps every one of the six `OrderStatus` enum values to the list of statuses it may legally transition into. This is the single authoritative definition of the order lifecycle in the entire system.

**Detailed description**:
The graph encodes a mostly-linear happy path — `PENDING → PAID → PROCESSING → SHIPPED → DELIVERED` — with a cancellation branch available at the first three stages only. Concretely: `PENDING` may go to `PAID` (payment confirmed) or `CANCELLED` (order abandoned before payment); `PAID` may go to `PROCESSING` (fulfillment started) or `CANCELLED` (post-payment cancellation, e.g. refund); `PROCESSING` may go to `SHIPPED` or `CANCELLED` (cancellation still possible while being prepared); `SHIPPED` may only go to `DELIVERED` — once an order has left the warehouse, the business rule is that it cannot be cancelled through this state machine, only completed. `DELIVERED` and `CANCELLED` both map to empty arrays, making them terminal: no further status change is possible for an order in either state via `changeStatus`.

Because the object is typed `Readonly<Record<OrderStatus, ...>>` and uses `as const`-style array literals (`ReadonlyArray`), TypeScript enforces at compile time that every `OrderStatus` enum member has an entry (missing a key is a type error), which guards against silently allowing "unreachable" or unspecified statuses to fall through to `undefined` at runtime. This exhaustiveness guarantee is a quality attribute of the design: introducing a new `OrderStatus` enum value in `prisma/schema.prisma` without updating `transitions` in `order.status.ts` would produce a TypeScript compile error, forcing the developer to make an explicit decision about the new state's transitions.

The rule has direct consequences for downstream features. Any consumer that needs to reason about "what can happen next" for an order (a UI showing available actions, a webhook system deciding which target statuses are even reachable, an admin dashboard) should treat this map — not any ad-hoc reimplementation — as authoritative. The seed script (`prisma/seed.ts:255-261`) currently does not do this (see Technical Debt section), which is a latent inconsistency risk.

**Rule workflow**:
```
1. Caller obtains current status (`from`) and desired status (`to`)
2. transitions[from] is looked up (guaranteed to exist for all 6 enum values)
3. to is checked for membership in transitions[from] via Array.prototype.includes
4. Result: boolean — true if the transition is permitted, false otherwise
5. Non-permitted transitions are rejected upstream with HTTP 409 / INVALID_STATUS_TRANSITION
```

---

### Business Rule: canTransition — Transition Validation Gate

**Overview**:
`canTransition(from, to)` (`order.status.ts:12-14`) is the sole boolean predicate used to authorize an order status change. It performs a direct array-membership check against the `transitions` map with no additional side conditions.

**Detailed description**:
This function is the single enforcement point for the entire transition graph described above. It takes the current status and the requested target status and returns whether the edge exists in the directed graph. It is deliberately minimal — no exceptions are thrown from within `order.status.ts` itself; the function only returns a boolean, and it is the caller's responsibility (`OrderService.changeStatus`, `order.service.ts:147-149`) to decide what to do when the answer is `false` (throw `InvalidStatusTransitionError`, mapped to HTTP 409 with error code `INVALID_STATUS_TRANSITION`).

An important nuance is that `canTransition` treats `from === to` the same as any other non-edge: since no status maps to itself in the `transitions` object, `canTransition(x, x)` is always `false` for every status. However, in practice this identity case never reaches `canTransition` in the current call site, because `OrderService.changeStatus` short-circuits it one line earlier (`order.service.ts:140-146`) with a dedicated `ConflictError` (also carrying code `INVALID_STATUS_TRANSITION`, but constructed directly rather than via `InvalidStatusTransitionError`). This means the same-status case and the "genuinely invalid edge" case currently produce indistinguishable error codes/messages to API clients even though they are validated by two different code paths — a subtle behavioral redundancy worth noting for anyone extending this logic (e.g., the webhooks feature would see identical `INVALID_STATUS_TRANSITION` payloads for both).

Because `canTransition` is pure and side-effect-free, it is trivially safe to call multiple times, from multiple call sites, or ahead-of-time for validation/preview purposes (e.g., "can this order be cancelled right now?") without any risk of inconsistent state — a desirable property for a future webhooks feature that might want to pre-validate whether a requested status is even reachable before subscribing to it.

**Rule workflow**:
```
1. from, to: OrderStatus values passed in
2. return transitions[from].includes(to)
3. Consumer (order.service.ts) branches on the boolean:
   - true  → proceed with the transition
   - false → throw InvalidStatusTransitionError(from, to) → HTTP 409
```

---

### Business Rule: allowedTransitions — Next-State Enumeration (Currently Unused)

**Overview**:
`allowedTransitions(from)` (`order.status.ts:16-18`) returns the full read-only array of statuses reachable from a given status, i.e., the row of the transition graph for that status.

**Detailed description**:
Unlike `canTransition`, which answers a yes/no question about one specific edge, `allowedTransitions` exposes the complete adjacency list for a status — useful for any caller that needs to enumerate options rather than validate one. Confirmed by repository-wide search, this function has **no current call site** anywhere in `src/`, `tests/`, or `prisma/seed.ts`. It is exported but dormant.

Its most plausible purpose, given the project context (the codebase is being analyzed ahead of an Order Webhooks Notification feature per `DESAFIO.md` and `TRANSCRICAO.md`), is to support UI/API consumers that need to answer "what actions can I take on this order right now?" or a webhooks configuration UI that needs to validate/suggest which target statuses are reachable for filtering. Since the transcript describes webhook subscriptions being filtered by target status list (`TRANSCRICAO.md:194`: "quero saber quando vira SHIPPED e DELIVERED"), a validation step confirming a subscribed status is actually reachable in the lifecycle could plausibly use `allowedTransitions` or `canTransition` in combination. This is an inference with **medium confidence** — the code offers no comments, tests, or callers confirming intended future use; it is stated here as a hypothesis grounded in the surrounding project documentation, not as an established fact of the current codebase.

Because it returns the same `ReadonlyArray` reference held in the `transitions` map (no defensive copy), callers cannot mutate the returned array (TypeScript's `ReadonlyArray` prevents `.push`/`.pop` at compile time), but a caller using a type-unsafe cast could still mutate the underlying array and corrupt the shared `transitions` object for all future lookups — a latent immutability risk if the readonly typing were ever bypassed.

**Rule workflow**:
```
1. from: OrderStatus passed in
2. return transitions[from]  (direct reference, not a copy)
3. No current caller consumes this value in the codebase
```

---

### Business Rule: isTerminal — Terminal State Classification (Currently Unused)

**Overview**:
`isTerminal(status)` (`order.status.ts:20-22`) returns `true` when a status has zero outgoing transitions, currently true only for `DELIVERED` and `CANCELLED`.

**Detailed description**:
This helper derives terminality directly from the same `transitions` map rather than hardcoding a separate list of terminal statuses, which means it stays automatically consistent if the graph changes (e.g., if a future requirement introduced a `RETURNED` status reachable from `DELIVERED`, `isTerminal(DELIVERED)` would automatically become `false` without any code change to this function). This is a notable design strength: terminality is a *derived* property of the graph, not a duplicated fact.

Like `allowedTransitions`, this function has no current caller in the codebase. Plausible future consumers include: order deletion logic (`OrderService.delete`, `order.service.ts:181-192`, which currently re-implements a narrower, hardcoded version of "is this order safely removable" by checking `status !== PENDING && status !== CANCELLED` directly rather than calling `isTerminal`), reporting/dashboards that need to distinguish "in-flight" from "closed" orders, or the webhooks feature needing to know whether further events could ever fire for a given order (i.e., whether it is safe to stop expecting webhook deliveries for that order).

Notably, `OrderService.delete` uses a business rule that is *conceptually* related to but not *identical* to `isTerminal`: deletion is permitted for `PENDING` (non-terminal) and `CANCELLED` (terminal), but not for `DELIVERED` (also terminal). This means `isTerminal` cannot be used as-is to gate deletion — deletion eligibility and lifecycle terminality are two distinct business concepts that happen to overlap only on `CANCELLED`. Anyone refactoring `OrderService.delete` to reuse `isTerminal` would introduce a bug (allowing deletion of `DELIVERED` orders) unless this distinction is preserved.

**Rule workflow**:
```
1. status: OrderStatus passed in
2. return transitions[status].length === 0
3. true  → DELIVERED or CANCELLED (no further transitions possible)
4. false → PENDING, PAID, PROCESSING, or SHIPPED (still has at least one valid next state)
```

---

### Business Rule: Stock Debit on Payment Confirmation

**Overview**:
`STOCK_DEBIT_TRANSITION` (`order.status.ts:24-27`) declares that stock is debited on exactly one edge: `PENDING → PAID`. `shouldDebitStock(from, to)` (`order.status.ts:29-31`) checks whether a given transition matches that single edge.

**Detailed description**:
This rule captures the business decision that inventory is only reserved/consumed once payment is confirmed, not at order creation time (`OrderService.create`, `order.service.ts:50-124`, creates the order in `PENDING` status without touching `Product.stockQuantity` at all) and not at any later stage of the lifecycle (`PROCESSING`, `SHIPPED`, `DELIVERED` never trigger a debit, since those transitions do not match `STOCK_DEBIT_TRANSITION`). The predicate is a strict equality check on both `from` and `to`, meaning it only fires for that one specific edge — it is not a generic "debit stock whenever moving forward" rule; a hypothetical direct `PAID → PROCESSING` does not re-debit, and this is correct since debiting already happened for that order.

Operationally, when `shouldDebitStock` returns true, `OrderService.debitStock` (`order.service.ts:204-231`) is invoked inside the same transaction: it loads the current `Product` records for all order items, computes which ones have insufficient `stockQuantity`, and if any are short, throws `InsufficientStockError` (HTTP 422, code `INSUFFICIENT_STOCK`) which — because it is thrown inside `prisma.$transaction` — rolls back the entire transaction, including the (not-yet-applied) status update and history insert. Only if all items have sufficient stock does the debit proceed, decrementing each product's `stockQuantity` by the ordered quantity. This guarantees atomicity: either the order fully transitions to `PAID` with stock correctly decremented, or nothing changes at all (the order stays `PENDING` and stock is untouched) — verified in `tests/orders.test.ts:109-132` ("returns 422 when transitioning PENDING -> PAID without enough stock").

The constant-object design (`STOCK_DEBIT_TRANSITION = { from: PENDING, to: PAID }`) rather than an inline pair of enum comparisons makes the "one specific edge" nature of the rule self-documenting and gives it a single, easily-searchable definition point, separate from the more general-purpose `shouldReplenishStock` rule below (which instead matches a *set* of source statuses against one target).

**Rule workflow**:
```
1. from, to: OrderStatus values from the requested transition
2. return from === PENDING && to === PAID
3. true  → OrderService.debitStock(tx, order.items) executes:
   a. Load current Product rows for all item productIds
   b. For each item, compare requested quantity vs product.stockQuantity
   c. If any item is short → throw InsufficientStockError (422) → transaction rollback
   d. Else → decrement stockQuantity for every item's product
4. false → no stock mutation occurs for this transition
```

---

### Business Rule: Stock Replenishment on Cancellation

**Overview**:
`shouldReplenishStock(from, to)` (`order.status.ts:33-37`) returns true when the target status is `CANCELLED` and the source status is either `PAID` or `PROCESSING` — i.e., cancellation after stock was already debited.

**Detailed description**:
This rule is the inverse counterpart to the debit rule: it only fires when stock could plausibly have been previously reserved for the order. Since stock is debited exactly on `PENDING → PAID` (per the rule above), any order that later reaches `CANCELLED` from `PAID` or `PROCESSING` has necessarily passed through a debit at some earlier point in its lifecycle; replenishing on those two source statuses correctly reverses that debit. Cancellation from `PENDING` (`PENDING → CANCELLED`, also a valid edge per the transition graph) deliberately does **not** trigger replenishment, because no debit ever occurred for an order that never left `PENDING` — replenishing in that case would incorrectly inflate stock beyond its true available quantity.

Note that `SHIPPED` and `DELIVERED` are absent from the "from" side of this predicate not because of an oversight but because the transition graph itself does not permit `CANCELLED` as a target from those statuses at all (`order.status.ts:7-8`) — so `shouldReplenishStock(SHIPPED, CANCELLED)` would never even be evaluated in practice, since `canTransition` would already have rejected the transition before `shouldReplenishStock` is checked in `OrderService.changeStatus` (`order.service.ts:147-156`). The predicate is technically over-inclusive in isolation (it would return `false` for those cases anyway since they don't match `PAID`/`PROCESSING`, so no bug arises), but its "correctness" here is contingent on the constraint already having been enforced by the transition graph one step earlier — the two rules are logically coupled even though `shouldReplenishStock` does not internally re-check `canTransition`.

Operationally, `OrderService.replenishStock` (`order.service.ts:233-242`) is a simpler routine than the debit path: it has no availability check (there is nothing to validate when adding stock back) and unconditionally increments `stockQuantity` for every item in the order, inside the same transaction as the status update. This is exercised in `tests/orders.test.ts:134-161` ("replenishes stock when going PAID -> CANCELLED"), which confirms stock returns to its pre-debit value after a debit-then-cancel sequence.

**Rule workflow**:
```
1. from, to: OrderStatus values from the requested (already-validated) transition
2. return to === CANCELLED && (from === PAID || from === PROCESSING)
3. true  → OrderService.replenishStock(tx, order.items) executes:
   a. For each item, increment product.stockQuantity by the ordered quantity
   b. No availability check needed (replenishment cannot fail on quantity grounds)
4. false → no stock mutation (covers PENDING → CANCELLED, and any non-cancellation transition)
```

---

## 4. Component Structure

`order.status.ts` is a single flat file with no sub-modules. It is one of five files that make up the broader `orders` module, shown here for context (files outside the state machine itself are marked accordingly):

```
src/modules/orders/
├── order.status.ts        # ANALYZED COMPONENT — pure state machine: transitions map,
│                           #   canTransition, allowedTransitions, isTerminal,
│                           #   STOCK_DEBIT_TRANSITION, shouldDebitStock, shouldReplenishStock
├── order.service.ts        # (context) sole consumer — OrderService.changeStatus enforces
│                           #   the state machine and applies stock side effects
├── order.controller.ts     # (context) HTTP handler layer, delegates to OrderService
├── order.routes.ts         # (context) Express route registration + middleware wiring
├── order.schemas.ts        # (context) Zod schemas — updateOrderStatusSchema validates
│                           #   `toStatus` is a member of the OrderStatus enum
└── order.repository.ts     # (context) Prisma-backed read/list/delete queries (not involved
                             #   in status transitions, which go through the service directly)
```

Internal structure of `order.status.ts` itself (lines 1-38):

```
order.status.ts
├── import { OrderStatus } from '@prisma/client'                    (line 1)
├── const transitions: Readonly<Record<OrderStatus, ...>>           (lines 3-10)  — the graph
├── function canTransition(from, to): boolean                       (lines 12-14)
├── function allowedTransitions(from): ReadonlyArray<OrderStatus>   (lines 16-18)
├── function isTerminal(status): boolean                            (lines 20-22)
├── const STOCK_DEBIT_TRANSITION = { from: PENDING, to: PAID }       (lines 24-27)
├── function shouldDebitStock(from, to): boolean                    (lines 29-31)
└── function shouldReplenishStock(from, to): boolean                (lines 33-37)
```

No classes, no interfaces beyond the inline `Record` type, no I/O, no external configuration. The entire file is 38 lines.

---

## 5. Dependency Analysis

```
Internal Dependencies:

order.status.ts
  → @prisma/client (type-only: OrderStatus enum)          [compile-time / generated code dependency]

order.service.ts
  → order.status.ts (canTransition, shouldDebitStock, shouldReplenishStock)
  → order.repository.ts (OrderRepository, OrderWithRelations types)
  → order.schemas.ts (CreateOrderInput, UpdateOrderStatusInput types)
  → shared/errors/index.ts (ConflictError, InsufficientStockError,
      InvalidStatusTransitionError, NotFoundError, UnprocessableEntityError, ValidationError)
  → shared/http/response.ts (paginated, PaginatedResponse)

order.controller.ts
  → order.service.ts (OrderService)
  → order.schemas.ts (ListOrdersQuery)
  → shared/errors/index.ts (UnauthorizedError)

order.routes.ts
  → order.controller.ts (OrderController)
  → order.schemas.ts (all Zod schemas)
  → middlewares/auth.middleware.ts (authenticate)
  → middlewares/validate.middleware.ts (validate)

prisma/seed.ts
  → @prisma/client (OrderStatus) — DOES NOT import order.status.ts; re-implements
    a partial transition/history view independently (flowFromStatus, seed.ts:255-261)

No production consumer of order.status.ts other than order.service.ts was found.

External Dependencies:
- @prisma/client (5.22.0) — generates the OrderStatus TypeScript enum from
  prisma/schema.prisma:16-23; order.status.ts depends on this generated type only,
  no runtime Prisma client calls occur inside order.status.ts itself.
- MySQL (via Prisma datasource, prisma/schema.prisma:5-9) — the underlying persistence
  for the `orders`, `order_status_history`, and `products` tables that OrderService
  mutates in response to the state machine's decisions. order.status.ts has no direct
  dependency on the database; all persistence is performed by order.service.ts.
```

`order.status.ts` itself has **zero runtime external dependencies** — its only import is a TypeScript type/enum (`OrderStatus`) from the generated Prisma client, making it effectively a standalone, framework-agnostic pure module.

---

## 6. Afferent and Efferent Coupling

Coupling is analyzed at the function/export level, since this is a functional (non-OOP) module with no classes. "Afferent" = number of distinct call sites across the codebase that depend on the export; "Efferent" = number of distinct external symbols the export depends on.

| Export | Afferent Coupling | Efferent Coupling | Critical |
|--------|--------------------|---------------------|----------|
| `transitions` (internal, not exported) | 4 (all 4 functions in this file) | 1 (`OrderStatus` enum) | High |
| `canTransition` | 1 (`order.service.ts:147`) | 1 (`transitions`) | High |
| `allowedTransitions` | 0 (no current caller) | 1 (`transitions`) | Low (dormant) |
| `isTerminal` | 0 (no current caller) | 1 (`transitions`) | Low (dormant) |
| `STOCK_DEBIT_TRANSITION` | 1 (`shouldDebitStock`, internal use) | 1 (`OrderStatus` enum) | Medium |
| `shouldDebitStock` | 1 (`order.service.ts:151`) | 1 (`STOCK_DEBIT_TRANSITION`) | High |
| `shouldReplenishStock` | 1 (`order.service.ts:154`) | 0 (compares enum values directly, no shared constant) | High |

Module-level coupling (order.status.ts as a whole):

| Component | Afferent Coupling | Efferent Coupling | Critical |
|-----------|---------------------|---------------------|----------|
| `order.status.ts` (whole module) | 1 (imported only by `order.service.ts`) | 1 (`@prisma/client` OrderStatus type) | High |
| `order.service.ts` (consumer) | 2 (`order.controller.ts`, tests via HTTP) | 6 (`order.status.ts`, `order.repository.ts`, `order.schemas.ts`, `shared/errors`, `shared/http/response.ts`, `@prisma/client`) | High |

Interpretation: `order.status.ts` has very low afferent coupling in absolute terms (one consumer file) but that single consumer is the most business-critical write path in the `orders` module (the only place `Order.status` is ever mutated), which is why the module is marked "Critical: High" despite the low fan-in count — a defect here would silently corrupt every order status transition and every stock adjustment in the system. `allowedTransitions` and `isTerminal` are flagged "Low" criticality only because they currently have zero callers; their criticality would rise sharply if/when a future consumer (e.g., webhooks) adopts them.

---

## 7. Endpoints

`order.status.ts` itself exposes no endpoints — it is a pure internal library module. The HTTP endpoint that consumes it (`OrderService.changeStatus`, via `OrderController.changeStatus`) is documented here for traceability, since it is the only externally observable surface of this state machine's behavior:

| Endpoint | Method | Description |
|----------|--------|-------------|
| /api/v1/orders/:id/status | PATCH | Change an order's status; validated against the state machine in `order.status.ts` (`canTransition`), applies stock debit/replenishment side effects, and appends an `OrderStatusHistory` record. Body: `{ toStatus: OrderStatus, reason?: string }`. Returns 200 with the full order (including items, history, customer) on success; 404 if the order does not exist; 409 if `toStatus` equals the current status or the transition is not permitted by the state machine; 422 if the transition requires a stock debit that cannot be satisfied. |

(Other `orders` module endpoints — `GET /`, `GET /:id`, `POST /`, `DELETE /:id` — do not invoke the state machine and are out of scope for this analysis; they are omitted per the component boundary.)

---

## 8. Integration Points

| Integration | Type | Purpose | Protocol | Data Format | Error Handling |
|-------------|------|---------|----------|-------------|-----------------|
| `@prisma/client` generated `OrderStatus` enum | Internal (generated code) | Type-safe representation of the 6 order statuses, generated from `prisma/schema.prisma:16-23` | N/A (compile-time TS import) | TypeScript enum | N/A — compile-time only; a schema/enum mismatch would be a build-time TypeScript error, not a runtime one |
| `OrderService.changeStatus` (order.service.ts) | Internal (in-process function call) | Sole runtime consumer; calls `canTransition`, `shouldDebitStock`, `shouldReplenishStock` synchronously within a Prisma transaction | Direct function call | Plain JS/TS values (enum members) | Consumer throws `InvalidStatusTransitionError` (HTTP 409) when `canTransition` returns false; no error can originate from within `order.status.ts` itself since all its functions are total (no thrown exceptions, no partial/undefined results for any valid `OrderStatus` input) |
| MySQL `orders` / `order_status_history` tables (indirect, via `OrderService`) | External datastore (indirect) | Durable storage of the status that the state machine gates changes to, and the history of `fromStatus`/`toStatus` pairs it produces | Prisma Client (SQL under the hood) | Relational rows | Handled entirely in `order.service.ts`, not in `order.status.ts`; all mutations occur inside a single `prisma.$transaction`, so a stock-debit failure rolls back the status update and history insert together |
| (Planned, not yet implemented) Webhook outbox / event filter | External-facing (future) | Per `TRANSCRICAO.md:194,198,238-242`, a future `webhook_outbox` insert is planned to occur in the same transaction as `OrderService.changeStatus`, filtered by the customer's subscribed target statuses, carrying `fromStatus`/`toStatus` produced by this exact code path | Not yet defined (planned: HTTP callbacks from a separate worker, per outbox pattern) | Not yet defined (planned: JSON payload with `X-Webhook-Id`, HMAC-SHA256 signature) | Not yet implemented; noted here strictly as a documented planned integration point that depends on the exact status values and transition edges this module defines |

---

## 9. Design Patterns & Architecture

| Pattern | Implementation | Location | Purpose |
|---------|------------------|----------|---------|
| Table-driven / lookup-table state machine | `transitions: Readonly<Record<OrderStatus, ReadonlyArray<OrderStatus>>>` | `order.status.ts:3-10` | Encodes the entire transition graph as data rather than as a chain of `if`/`switch` statements, making the ruleset exhaustively enumerable and easy to audit at a glance |
| Pure function / functional core | All exported functions (`canTransition`, `allowedTransitions`, `isTerminal`, `shouldDebitStock`, `shouldReplenishStock`) | `order.status.ts:12-37` | No side effects, no I/O, no mutation of inputs; deterministic given inputs — classic "functional core, imperative shell" split, with `order.service.ts` acting as the imperative shell that performs the actual I/O |
| Derived predicate (query built from source-of-truth data) | `isTerminal` computed from `transitions[status].length === 0` rather than a separately maintained terminal-status list | `order.status.ts:20-22` | Avoids duplicated/divergent terminal-state definitions; terminality is always consistent with the graph |
| Named constant for a single significant edge | `STOCK_DEBIT_TRANSITION = { from: PENDING, to: PAID }` | `order.status.ts:24-27` | Documents and centralizes the specific transition that triggers stock debit, rather than an unlabeled inline comparison |
| Guard clause / fail-fast validation | `canTransition` check immediately followed by `throw` in the consumer, before any state mutation begins | `order.service.ts:147-149` | Standard defensive-programming pattern ensuring invalid transitions never reach the persistence layer |
| Transactional consistency boundary | `prisma.$transaction` wrapping status check, stock mutation, status update, and history insert together | `order.service.ts:131-178` | Guarantees the state machine's decision and its side effects (stock, history) either all commit or all roll back atomically |
| Immutable/read-only data structures | `Readonly<Record<...>>`, `ReadonlyArray<OrderStatus>`, `as const` on `STOCK_DEBIT_TRANSITION` | `order.status.ts:3, 16, 24-27` | Prevents accidental mutation of the shared transition graph or constant at the type level |

---

## 10. Technical Debt & Risks

| Risk Level | Component Area | Issue | Impact |
|------------|------------------|-------|--------|
| Medium | `prisma/seed.ts:255-261` (`flowFromStatus`) | The seed script independently hardcodes a reversed/partial view of valid transition paths instead of importing/deriving it from `order.status.ts`'s `transitions` map (or `allowedTransitions`) | If the state machine in `order.status.ts` changes (new status, new edge, removed edge), the seed script's hand-maintained history paths can silently diverge and produce seed data that is inconsistent with the real, enforced business rules — a subtle data-integrity blind spot that would not surface as a compile error |
| Low-Medium | `order.status.ts:16-22` (`allowedTransitions`, `isTerminal`) | Both functions are exported but have zero current callers anywhere in `src/`, `tests/`, or `prisma/seed.ts` | Dead/dormant public API surface: increases the module's apparent complexity without current runtime benefit; if truly unused, it is undocumented why they exist (no comment/ADR ties them to the planned webhooks feature), creating ambiguity for future maintainers about whether they are safe to remove or must be preserved for an upcoming feature |
| Low | `order.service.ts:181-192` (`OrderService.delete`) | Deletion eligibility (`status === PENDING || status === CANCELLED`) is checked with a direct enum comparison rather than reusing any helper from `order.status.ts` (notably not `isTerminal`, which would incorrectly also match `DELIVERED`) | Business logic for "is this order in a safe-to-delete state" is duplicated as an inline condition rather than being expressed through the state-machine module; the concept is related to but subtly different from `isTerminal`, so no direct refactor is safe without care, but the current lack of any shared vocabulary between the two rules makes the relationship easy to miss during future changes |
| Low | `order.service.ts:140-149` | The same-status guard (`from === to` → `ConflictError` with code `INVALID_STATUS_TRANSITION`) and the state-machine rejection (`!canTransition(from, to)` → `InvalidStatusTransitionError`, same code `INVALID_STATUS_TRANSITION`) are two separate code paths that produce the same error code to API clients | Slight redundancy/ambiguity: from a purely external (API-contract) point of view, a client cannot distinguish "you asked for the same status you're already in" from "that edge doesn't exist in the graph" — both come back as the same `INVALID_STATUS_TRANSITION` 409. Not a correctness bug, but worth flagging for anyone designing client-facing error semantics (including future webhook failure-reason payloads) |
| Informational | `order.status.ts` (whole module) | No dedicated unit tests exist; all coverage is indirect via HTTP integration tests in `tests/orders.test.ts` | See Test Coverage Analysis below — several valid/invalid edges of the transition graph, and both dormant functions, are never directly exercised by any test |
| Informational (forward-looking) | `order.status.ts` as the implicit contract for the planned webhooks feature | Per `TRANSCRICAO.md`, the webhooks feature will filter events by target status and record `from_status`/`to_status` derived from this exact module's decisions, but there is currently no ADR, interface, or version-pinning mechanism tying the webhooks design to this specific transition graph | Any future change to the transition graph (e.g., allowing `SHIPPED → CANCELLED`, or adding a new status) could silently change which webhook events are even possible to subscribe to, with no explicit cross-reference in the code connecting the two concerns today |

---

## 11. Test Coverage Analysis

No dedicated unit test file exists for `order.status.ts` (no `order.status.test.ts` or equivalent was found anywhere under `tests/` or elsewhere in the project). All coverage is indirect, via HTTP-level integration tests in `tests/orders.test.ts` that exercise `OrderService.changeStatus` (and therefore `canTransition`/`shouldDebitStock`/`shouldReplenishStock`) through the full Express app + real MySQL database stack (bootstrapped via `tests/setup.ts` and `tests/helpers/factories.ts`).

| Component | Unit Tests | Integration Tests | Coverage (of exported behavior) | Test Quality |
|-----------|------------|---------------------|-----------------------------------|----------------|
| `canTransition` (valid edges) | 0 | 2 (`tests/orders.test.ts:59-87` PENDING→PAID; `tests/orders.test.ts:134-161` PAID→CANCELLED as part of a two-step PAID→CANCELLED test) | Partial — only 2 of the 8 valid edges (PENDING→PAID, PENDING→CANCELLED, PAID→PROCESSING, PAID→CANCELLED, PROCESSING→SHIPPED, PROCESSING→CANCELLED, SHIPPED→DELIVERED) are exercised end-to-end; PENDING→CANCELLED, PAID→PROCESSING, PROCESSING→SHIPPED, PROCESSING→CANCELLED, and SHIPPED→DELIVERED are never directly tested by an HTTP call in `tests/orders.test.ts` | Good assertions on the two edges that are tested (checks response status, resulting `status` field, and `history` array shape), but leaves the majority of the graph's valid edges unverified by any test |
| `canTransition` (invalid edges / rejection) | 0 | 1 (`tests/orders.test.ts:89-107`, PENDING→SHIPPED expecting 409 `INVALID_STATUS_TRANSITION`) | Minimal — only a single invalid edge out of many possible invalid combinations (e.g., DELIVERED→anything, CANCELLED→anything, SHIPPED→PROCESSING, PAID→SHIPPED, etc.) is verified | Adequate for the one case covered, but does not verify terminal-state rejections (attempting to transition a DELIVERED or CANCELLED order) at all |
| Same-status guard (`from === to`) | 0 | 0 | None found — no test drives `changeStatus` with `toStatus` equal to the order's current status to confirm the `ConflictError`/409 behavior in `order.service.ts:140-146` | Gap — this specific guard clause is entirely untested |
| `allowedTransitions` | 0 | 0 | None — function has no caller and no test references it directly | Untested; risk is currently low only because the function is unused in production code |
| `isTerminal` | 0 | 0 | None — function has no caller and no test references it directly; no test attempts a status change on a DELIVERED or CANCELLED order to indirectly confirm terminal behavior via `canTransition`'s rejection either | Untested, and notably the terminal-state rejection behavior (attempting any transition out of DELIVERED/CANCELLED) is also not covered by the integration suite |
| `shouldDebitStock` / stock debit side effect | 0 | 2 (`tests/orders.test.ts:59-87` success path decrementing stock; `tests/orders.test.ts:109-132` failure path — insufficient stock, expects 422 and unchanged `stockQuantity`) | Good coverage of the one edge this predicate matches (PENDING→PAID), including both the success and failure branches | Good assertions, verifies both the HTTP response and the resulting `Product.stockQuantity` directly against the database |
| `shouldReplenishStock` / stock replenishment side effect | 0 | 1 (`tests/orders.test.ts:134-161`, PAID→CANCELLED verifying stock is restored to its pre-debit value) | Partial — only the PAID→CANCELLED edge is tested; the PROCESSING→CANCELLED edge (the other source status this predicate matches) is never exercised, nor is the "no replenishment on PENDING→CANCELLED" negative case | Good assertion quality for the one path tested (checks exact stock value before and after), but misses the second matching source status and the negative case entirely |
| `OrderService.delete` interaction with terminal/lifecycle rules | 0 | 1 (`tests/orders.test.ts:197-218`, deleting a PAID order expects 409 `INVALID_ORDER_STATE_FOR_DELETE`) | Only the "reject" path is tested; no test confirms successful deletion while PENDING or CANCELLED | Adequate for the one negative case covered; positive deletion paths (PENDING, CANCELLED) are untested |

**Summary judgment:** Test coverage of the state machine's *side effects* (stock debit/replenish) on their primary happy-path and one failure path is solid and well-asserted. Coverage of the *transition graph itself* is sparse: the majority of valid edges (5 of 8), all terminal-state rejections, the same-status guard, and both currently-unused helper functions (`allowedTransitions`, `isTerminal`) have no direct or indirect test evidence anywhere in the repository. Given that this module has been identified as the implicit contract for an upcoming webhooks feature, the untested majority of the transition graph represents a documentation/verification gap for any team about to build on top of it.

---

*End of report.*
