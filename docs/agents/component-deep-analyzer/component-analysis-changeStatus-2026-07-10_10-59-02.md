# Component Deep Analysis Report

**Component:** Order Service — `changeStatus` (`src/modules/orders/order.service.ts:126-179`)
**Analysis date:** 2026-07-10
**Analysis scope:** Strictly the `changeStatus` method and its complete transactional call graph (`debitStock`, `replenishStock`, `order.status.ts` predicates, the Prisma `$transaction` boundary, and the HTTP entry/exit points that surround it). Sibling methods (`list`, `getById`, `create`, `delete`) are referenced only where needed to explain shared context (e.g., that `OrderRepository` exists but is *not* used by `changeStatus`).
**Ignored paths:** `node_modules`, `dist`, `coverage`, `.git`, `.claude`

---

## 1. Executive Summary

`OrderService.changeStatus` is the single mutation point for the order lifecycle in this Order Management System. It is invoked via `PATCH /api/v1/orders/:id/status` and is responsible, inside one `prisma.$transaction`, for: (1) validating that the requested state transition is legal, (2) applying the transition's stock side-effects (debiting inventory on `PENDING → PAID`, replenishing it on cancellation from `PAID`/`PROCESSING`), (3) persisting the new status on the `Order` row, (4) appending an immutable audit record to `OrderStatusHistory`, and (5) returning a fully rehydrated `Order` (items, history, customer) to the caller.

The method is architecturally significant beyond its current behavior: per `TRANSCRICAO.md` (the technical design meeting transcript that is driving this repository's documentation package), this exact method is the integration point for an upcoming **outbound webhook notification system** built on the **Transactional Outbox pattern**. The team has already decided (09:40-09:41 in the transcript) that a `webhook_outbox` row must be inserted **inside this same transaction**, via a proposed pure function `publishWebhookEvent(tx, order, fromStatus, toStatus)`. Section 2a of this report pinpoints exactly where that call must be inserted and what variables are in scope at that point, based on the current code as of this analysis.

Key findings:
- `changeStatus` bypasses `OrderRepository` entirely — all reads/writes go through the raw Prisma transaction client (`tx`), unlike the service's other methods (`list`, `getById`, `delete`), which do use the repository. This is an intentional trade-off (multi-table transaction), but it duplicates the "order with relations" `include` shape in three places in the codebase.
- The transition rules (allowed paths, stock debit/replenish triggers) are fully externalized into a small, pure, dependency-free module (`order.status.ts`), which is good separation of concerns but currently has zero direct unit tests — it is only exercised transitively through HTTP integration tests.
- There is no authorization differentiation on this endpoint: any authenticated user (`ADMIN` or `OPERATOR`) can transition any order to any allowed status, including cancellations that trigger stock replenishment.
- The transaction currently performs **only** database I/O (no network calls), which is precisely the property that must be preserved when the outbox insert is added — the transcript is explicit that synchronous outbound HTTP calls inside this transaction were rejected by the team as unacceptable.

---

## 2. Data Flow Analysis

```
1.  HTTP PATCH /api/v1/orders/:id/status arrives at Express (src/app.ts)
2.  authenticate middleware (src/middlewares/auth.middleware.ts) verifies the JWT,
    populates req.user = { id, email, role }                         [order.routes.ts:14]
3.  validate middleware (src/middlewares/validate.middleware.ts) parses/validates:
      - params against orderIdParamSchema  -> { id: uuid }
      - body   against updateOrderStatusSchema -> { toStatus: OrderStatus, reason?: string }
                                                                       [order.routes.ts:19-23, order.schemas.ts:4,18-21]
4.  OrderController.changeStatus:
      - guards req.user existence (UnauthorizedError if missing)
      - delegates to OrderService.changeStatus(id, body, req.user.id)  [order.controller.ts:38-46]
5.  OrderService.changeStatus opens prisma.$transaction(async (tx) => { ... })  [order.service.ts:131]
      5.1  tx.order.findUnique({ where: { id }, include: { items: true } })     [line 132-135]
           -> throw NotFoundError('Order') if null                              [line 136]
      5.2  from = order.status; to = input.toStatus                             [line 138-139]
           -> throw ConflictError('INVALID_STATUS_TRANSITION') if from === to   [line 140-146]
      5.3  canTransition(from, to) (order.status.ts)                            [line 147]
           -> throw InvalidStatusTransitionError(from, to) if not allowed       [line 148]
      5.4  shouldDebitStock(from, to) -> if true: debitStock(tx, order.items)   [line 151-153]
             - tx.product.findMany(...) for all item productIds                [line 208-210]
             - per item: check product.stockQuantity >= item.quantity          [line 212-221]
             - throw InsufficientStockError(unavailable) if any short          [line 222-224]
             - tx.product.update({ stockQuantity: { decrement } }) per item    [line 225-230]
      5.5  shouldReplenishStock(from, to) -> if true: replenishStock(tx, order.items) [line 154-156]
             - tx.product.update({ stockQuantity: { increment } }) per item    [line 237-242]
      5.6  tx.order.update({ where: { id }, data: { status: to } })            [line 158]
      5.7  tx.orderStatusHistory.create({ orderId, fromStatus: from,
                toStatus: to, changedById: userId, reason: input.reason ?? null }) [line 159-167]
      --- 2a. THIS IS WHERE A FUTURE OUTBOX INSERT MUST HOOK IN (see 2a below) ---
      5.8  tx.order.findUnique(... full include: items+product, history, customer) [line 169-176]
           -> refreshed (guaranteed non-null; asserted with `!`)
6.  Transaction commits (all 5.1-5.8 succeed) OR rolls back atomically
    (any thrown error aborts the whole block: status change, stock change,
    and history insertion are all-or-nothing)
7.  OrderController.changeStatus returns res.status(200).json(refreshed)       [order.controller.ts:42]
8.  On any thrown error, OrderController's catch calls next(err), which is
    handled by errorMiddleware (src/middlewares/error.middleware.ts), mapping
    AppError subclasses to their statusCode/errorCode/details JSON shape.
```

### 2a. Outbox Integration Hook Point (for the upcoming webhook feature)

Per `TRANSCRICAO.md` [09:40-09:41], Bruno and Diego decided the webhook event must be inserted into `webhook_outbox` **inside the same transaction** as the status update and the history insert, via a pure function shaped as `publishWebhookEvent(tx, order, fromStatus, toStatus)` that accepts the already-open `tx` client rather than a full repository. Based on the current code, the precise insertion point and the values already in scope there are:

- **Exact hook location:** immediately **after** `order.service.ts:167` (the closing of `await tx.orderStatusHistory.create({...})`) and **before** `order.service.ts:169` (`const refreshed = await tx.order.findUnique(...)`). This ordering matches Bruno's stated sequence ("faz update na order, insere no history e atualiza estoque... vamos inserir na webhook_outbox dentro da mesma transação") — the outbox row is the last write before the transaction re-reads the final state to return to the caller.
- **Arguments available in scope at that exact point, with no further queries required:**
  - `tx` — the `Prisma.TransactionClient` (`TxClient`, declared `order.service.ts:24`), the callback parameter of `prisma.$transaction` opened at `order.service.ts:131`. This is exactly the client Diego asked for ("função pura recebendo o tx").
  - `order` — the object fetched at `order.service.ts:132-135`. It carries `id`, `orderNumber`, `customerId`, `status` (**stale**: still the pre-transition value, see caveat below), `subtotalCents`, `discountCents`, `totalCents`, `notes`, `createdById`, `createdAt`, `updatedAt`, and `items` (`{ productId, quantity, unitPriceCents, totalCents }[]`, no nested `product` relation because the query only requests `include: { items: true }`). This is sufficient to populate the payload fields the transcript specifies for the webhook body (`order_id`, `order_number`, `customer_id`, `total_cents`) — it explicitly does **not** need `items` details, since the team decided (09:43) to keep the payload "enxuto" (lean) and exclude line items.
  - `from` — the pre-transition `OrderStatus`, captured at `order.service.ts:138` from `order.status` before it is overwritten.
  - `to` — the target `OrderStatus`, captured at `order.service.ts:139` from `input.toStatus`.
  - Also technically in scope but not part of Diego's proposed signature: `userId` (the actor who requested the change, method parameter) and `input.reason` (optional free-text reason) — both already available if the outbox event schema is later extended to include an "initiated by" or "reason" field.
- **Caveat / correctness risk to flag for the implementer:** `order.status` inside the `order` object is **not** updated in-place before the hook point — the in-memory object still reflects the pre-transition status. Any `publishWebhookEvent` implementation must read the transition endpoints from the separately-passed `fromStatus`/`toStatus` arguments (as the transcript's proposed signature already does), **not** from `order.status`, or the emitted event would silently report the wrong `to_status`.
- **Additional queries the hook will likely need to add at this same point:** the transcript (09:33-09:34) also decided that per-customer webhook subscriptions filter by status **at insertion time** ("filtra na inserção... se nenhum webhook do customer quer aquele status, nem insere"). That means `publishWebhookEvent` (or a helper it calls) will need an additional `tx` query against the (not-yet-existing) webhook-configuration table, scoped by `order.customerId` and `to`, before deciding whether to write a `webhook_outbox` row — this is not visible in the current codebase and does not yet exist as a table/model in `prisma/schema.prisma`.
- **Payload snapshot decision:** the transcript (09:51-09:52) also settled that the outbox row stores the **fully rendered JSON payload at insertion time** (a snapshot), not just `order_id` to be re-rendered later by the worker — meaning the hook must build the final payload object (event_id UUID, `event_type: "order.status_changed"`, ISO-8601 timestamp, `order_id`, `order_number`, `from_status`, `to_status`, `customer_id`, `total_cents`) inline at this point, using exactly the values enumerated above.
- **Why this specific location matters:** inserting before `orderStatusHistory.create` (line 159) would still be transactionally safe but would not match the decided step order; inserting after the final `tx.order.findUnique` refresh (after line 176) is unsafe, because that read is not a write and moving the outbox insert after it would place it in a dead code path if the method were to `return` early — the current code has no such early return, but keeping the outbox insert immediately after the last state-mutating write (history) and before the read-only rehydration keeps the "state changes vs. read-back" boundary clean and matches the "insert outbox as last write" mental model agreed upon in the meeting.

---

## 3. Business Rules & Logic

### Overview of the business rules

| Rule Type | Rule Description | Location |
|-----------|-------------------|----------|
| Precondition | Order must exist | order.service.ts:136 |
| Validation | Reject no-op transition (from === to) | order.service.ts:140-146 |
| Business Logic | Finite state machine defines all legal transitions | order.status.ts:3-14 |
| Business Logic | Terminal states have no outgoing transitions | order.status.ts:8-9, 20-22 |
| Validation | Reject any transition not in the state machine | order.service.ts:147-149 |
| Business Logic | Debit stock exactly on PENDING → PAID | order.status.ts:24-31; order.service.ts:151-153, 204-230 |
| Validation | Insufficient stock blocks the PENDING → PAID transition | order.service.ts:211-224 |
| Business Logic | Replenish stock on cancellation from PAID or PROCESSING | order.status.ts:33-37; order.service.ts:154-156, 233-242 |
| Business Logic | Status persisted only after all validations/side-effects succeed | order.service.ts:158 |
| Business Logic | Every transition appends an immutable history record | order.service.ts:159-167 |
| Business Logic | History reason is optional free text | order.schemas.ts:20; order.service.ts:165 |
| Architectural Rule | Entire operation is one atomic unit (all-or-nothing) | order.service.ts:131-178 |
| Business Logic | Response returns the fully rehydrated order, not a partial view | order.service.ts:169-177 |
| Input Validation | `toStatus` must be a known `OrderStatus` enum value; `reason` capped at 500 chars | order.schemas.ts:18-21 |
| Gap (implicit rule) | No role-based restriction on who may change status | order.routes.ts:19-23; auth.middleware.ts:49-61 |

### Detailed breakdown of the business rules

---

### Business Rule: Order Existence Precondition

**Overview:**
Before any transition logic runs, the target order must exist; otherwise the operation fails fast with a 404.

**Detailed description:**
`changeStatus` opens its transaction and immediately performs `tx.order.findUnique({ where: { id }, include: { items: true } })` (`order.service.ts:132-135`). If no row is returned, a `NotFoundError('Order')` is thrown (`order.service.ts:136`), which the shared error taxonomy (`src/shared/errors/http-errors.ts:27-31`) maps to HTTP 404 with `errorCode: 'NOT_FOUND'` and the message `"Order not found"`.

This check also implicitly fetches `items` eagerly, even though at this point the code does not yet know whether the transition will require stock adjustment. This is a minor inefficiency (see Technical Debt) but is not incorrect: the `items` array is reused later by `debitStock`/`replenishStock` without a second query, so the eager fetch trades a small amount of always-paid cost for avoiding a second round trip in the debit/replenish paths.

Because this check runs *inside* the transaction rather than before it opens, a `SELECT` (not a locking read under MySQL's default `REPEATABLE READ` isolation) establishes the baseline `order.status` used for every subsequent decision in the same transaction. There is no explicit row lock (`FOR UPDATE`) here, which is relevant to the concurrency risk noted in Technical Debt & Risks.

**Rule workflow:**
`id` (path param, validated as UUID by Zod) → `tx.order.findUnique` → null? → throw `NotFoundError('Order')` (404) → else continue with `order` in scope for the rest of the transaction.

---

### Business Rule: Idempotent-Transition Rejection (Same-Status Guard)

**Overview:**
A request to change an order to the status it is already in is explicitly rejected rather than silently treated as a no-op success.

**Detailed description:**
Immediately after determining `from = order.status` and `to = input.toStatus` (`order.service.ts:138-139`), the code checks `if (from === to)` and throws a `ConflictError` with the message `` `Order is already in ${to} status` `` and error code `INVALID_STATUS_TRANSITION`, including `{ from, to }` as structured details (`order.service.ts:140-146`). This maps to HTTP 409.

This is a deliberate design choice distinct from an idempotent PUT/PATCH semantic: many REST APIs would treat "set to the same value" as a harmless no-op returning 200. Here it is treated as a client error, which means any retry logic on the caller's side (including a future webhook-driven or UI-driven double submission) must check the *current* status before resubmitting the same target status, or handle 409 gracefully.

Notably, this guard reuses the same error code (`INVALID_STATUS_TRANSITION`) as the "not a legal state-machine edge" rule below, even though the message text differs. A client parsing only `error.code` cannot distinguish "already there" from "that edge does not exist in the state machine" without also inspecting the `details.from`/`details.to` fields, or without comparing `details.from === details.to`. This is a minor API-contract ambiguity worth flagging for the FDD (Feature Design Document) covering this endpoint.

**Rule workflow:**
`from`, `to` computed → `from === to`? → yes: throw `ConflictError` (409, `INVALID_STATUS_TRANSITION`) → no: proceed to the state-machine check.

---

### Business Rule: Finite State Machine — Allowed Transitions

**Overview:**
Order status transitions are constrained to a fixed, explicit set of edges defined once in `order.status.ts`, fully decoupled from the service logic.

**Detailed description:**
The transition table (`order.status.ts:3-10`) is a `Readonly<Record<OrderStatus, ReadonlyArray<OrderStatus>>>` literal:
- `PENDING → [PAID, CANCELLED]`
- `PAID → [PROCESSING, CANCELLED]`
- `PROCESSING → [SHIPPED, CANCELLED]`
- `SHIPPED → [DELIVERED]`
- `DELIVERED → []` (terminal)
- `CANCELLED → []` (terminal)

`canTransition(from, to)` (`order.status.ts:12-14`) is a pure, side-effect-free predicate: `transitions[from].includes(to)`. `OrderService.changeStatus` calls it once, at `order.service.ts:147`, and throws `InvalidStatusTransitionError(from, to)` (`order.service.ts:148`) if it returns `false`. `InvalidStatusTransitionError` extends `ConflictError` (`http-errors.ts:45-52`) and also surfaces as HTTP 409 with code `INVALID_STATUS_TRANSITION` — the same code as the same-status guard above, reinforcing the ambiguity noted there.

This design cleanly encodes the order lifecycle as data rather than as scattered `if` statements, which makes the rule easy to audit and change in one place. It also means the rule is entirely independent of persistence or transaction concerns — `canTransition` takes and returns plain values with no I/O, which makes it trivially unit-testable in isolation (see Test Coverage Analysis for the fact that this opportunity is currently unused). The module also exports `allowedTransitions(from)` and `isTerminal(status)` as public helpers built on the same table, though neither is currently consumed by `changeStatus` itself — they exist as a public surface for other callers (e.g., a future API that reports "what statuses can this order move to next").

**Rule workflow:**
`from`, `to` known → `canTransition(from, to)` looks up `transitions[from]`, checks membership of `to` → `false` → throw `InvalidStatusTransitionError` (409, `INVALID_STATUS_TRANSITION`, `{ from, to }`) → `true` → proceed to stock-adjustment rules.

---

### Business Rule: Terminal States Have No Outgoing Transitions

**Overview:**
`DELIVERED` and `CANCELLED` are dead-end states: no further status change is ever legal once an order reaches either of them.

**Detailed description:**
This is encoded structurally rather than as a separate check: both `transitions[OrderStatus.DELIVERED]` and `transitions[OrderStatus.CANCELLED]` are empty arrays (`order.status.ts:8-9`), so any call to `canTransition(DELIVERED, anything)` or `canTransition(CANCELLED, anything)` returns `false` by construction, and `changeStatus` rejects it via the same `InvalidStatusTransitionError` path described above. The `isTerminal(status)` helper (`order.status.ts:20-22`) formalizes this as `transitions[status].length === 0`, but — as with `allowedTransitions` — it is not currently invoked anywhere in `changeStatus`; the terminality is enforced only indirectly through the empty-array lookup.

Because `SHIPPED` has a single legal edge (`→ DELIVERED`) and no cancellation edge, once an order is `SHIPPED` it can no longer be cancelled through this method — cancellation is only reachable from `PENDING`, `PAID`, or `PROCESSING`. This is a meaningful business constraint (once physically shipped, the system offers no in-app cancellation path) that is easy to miss by reading `changeStatus` alone, since it only becomes visible by reading the full transition table in `order.status.ts`.

**Rule workflow:**
Order in `DELIVERED` or `CANCELLED` → any `changeStatus` call → `canTransition` returns `false` (empty allowed-list) → `InvalidStatusTransitionError` (409) regardless of requested `to`.

---

### Business Rule: Stock Debit on PENDING → PAID

**Overview:**
Inventory is decremented exactly once, at the moment an order transitions from `PENDING` to `PAID`, and at no other transition.

**Detailed description:**
`shouldDebitStock(from, to)` (`order.status.ts:29-31`) compares the pair against a single named constant, `STOCK_DEBIT_TRANSITION = { from: PENDING, to: PAID }` (`order.status.ts:24-27`), making the "which transition debits stock" decision a single source of truth rather than an inline conditional. `changeStatus` calls it at `order.service.ts:151`; if true, it calls the private `debitStock(tx, order.items)` (`order.service.ts:152`, implementation at `order.service.ts:204-231`).

`debitStock` re-queries all involved products in one batch (`tx.product.findMany({ where: { id: { in: items.map(i => i.productId) } } })`, `order.service.ts:208-210`) rather than trusting any previously loaded product data — since the order's own `items` only carry `productId`/`quantity`/pricing snapshots, not live stock levels, this fresh read is necessary to get current `stockQuantity`. For every item, it validates `product.stockQuantity >= item.quantity` (line 214) before applying any mutation, and only after collecting *all* shortfalls across *all* items does it decide whether to fail (see the next rule) or proceed. If it proceeds, it issues one `tx.product.update({ data: { stockQuantity: { decrement: item.quantity } } })` per item (`order.service.ts:225-230`) — a relative (decrement) update rather than a compute-then-set, which is safe against read-modify-write races only insofar as the whole operation is wrapped in the same transaction (there is no explicit row lock; see Technical Debt).

Because this is the only transition that debits stock, no other lifecycle edge (`PAID → PROCESSING`, `PROCESSING → SHIPPED`, `SHIPPED → DELIVERED`) touches inventory at all — stock is treated as "reserved" the instant payment is confirmed, not at order creation and not at any later fulfillment step.

**Rule workflow:**
`shouldDebitStock(from, to)` true (only for `PENDING → PAID`) → `debitStock(tx, order.items)` → batch-fetch products → validate sufficient stock per item → all sufficient → per-item `decrement` update → continue to persistence steps.

---

### Business Rule: Insufficient Stock Validation

**Overview:**
A `PENDING → PAID` transition is blocked outright — with no partial debit — if any item in the order does not have enough available stock.

**Detailed description:**
Within `debitStock`, the code builds an `unavailable` array by iterating every order item and checking two failure conditions: the product record is missing entirely (`!product`, a defensive check even though referential integrity via the `Product` foreign key should make this unreachable in practice) or `product.stockQuantity < item.quantity` (`order.service.ts:211-221`). Each shortfall is recorded with `{ sku, requested, available }`, falling back to `item.productId` for `sku` and `0` for `available` if the product could not be found at all.

Only after examining **every** item does the method decide to fail: `if (unavailable.length > 0) throw new InsufficientStockError(unavailable)` (`order.service.ts:222-224`). This "collect-then-decide" structure means a client attempting to pay for a multi-item order with two out-of-stock items gets both shortfalls reported in one 422 response (`error.details.unavailable`, an array), rather than failing on the first one found and requiring a second round trip to discover the next problem. `InsufficientStockError` extends `UnprocessableEntityError` (`http-errors.ts:55-63`), producing HTTP 422 with code `INSUFFICIENT_STOCK`.

Critically, because the check-then-update sequence is entirely inside the same `debitStock` call and the same outer transaction, no stock decrements are applied for *any* item if *any* item is short — the loop that performs `tx.product.update` (lines 225-230) only runs after the `unavailable.length > 0` guard has already returned control via a thrown exception, so the two loops are strictly sequential and the second (mutating) loop is unreachable when the first (validating) loop finds a shortfall. This guarantees no partial/inconsistent stock debit can occur for a rejected transition.

**Rule workflow:**
`debitStock` invoked → fetch products → per item, compare `stockQuantity` vs `quantity` → any shortfall recorded → `unavailable.length > 0` → throw `InsufficientStockError` (422, `INSUFFICIENT_STOCK`, `{ unavailable: [{sku, requested, available}] }`) → transaction rolls back → order status is **not** changed, stock is **not** decremented, no history row is written.

---

### Business Rule: Stock Replenishment on Cancellation

**Overview:**
Cancelling an order that had already reserved stock (i.e., cancelling from `PAID` or `PROCESSING`) returns that stock to inventory; cancelling from `PENDING` does not, because `PENDING` orders never debited stock in the first place.

**Detailed description:**
`shouldReplenishStock(from, to)` (`order.status.ts:33-37`) returns true when `to === CANCELLED && (from === PAID || from === PROCESSING)`. This is the mirror image of the debit rule: it only fires for the two states that are *downstream* of the stock-debiting transition. A `PENDING → CANCELLED` transition is legal per the state machine (`order.status.ts:4`) but intentionally does **not** trigger `replenishStock`, because a `PENDING` order never had its stock debited to begin with — replenishing here would incorrectly inflate inventory.

When triggered, `replenishStock(tx, order.items)` (`order.service.ts:154-156`, implementation at `order.service.ts:233-242`) is simpler than `debitStock`: it has no validation step (there is no "too much stock" failure mode) and unconditionally issues one `tx.product.update({ data: { stockQuantity: { increment: item.quantity } } })` per item. It does not re-fetch product rows first, since no pre-condition needs checking — it directly asserts the increment.

This rule, together with the debit rule, defines the only two points in the entire order lifecycle where `Product.stockQuantity` is touched by `OrderService`. Both are relative (`increment`/`decrement`) database-level operations rather than application-computed absolute values, which relies on the transaction boundary (not on optimistic locking or row versioning) for correctness under concurrent access — a limitation discussed in Technical Debt & Risks.

**Rule workflow:**
`shouldReplenishStock(from, to)` true (only for `PAID → CANCELLED` or `PROCESSING → CANCELLED`) → `replenishStock(tx, order.items)` → per-item `increment` update, unconditionally → continue to persistence steps. For `PENDING → CANCELLED`, this function is never invoked, and stock is left untouched.

---

### Business Rule: Status Persistence Only After All Validations and Side-Effects Succeed

**Overview:**
The `Order.status` column is written exactly once per call, and only after every guard clause and every stock mutation has already succeeded without throwing.

**Detailed description:**
`tx.order.update({ where: { id }, data: { status: to } })` (`order.service.ts:158`) is the first *durable* effect of the method with respect to the order's own status field, and it is placed textually — and therefore logically, given synchronous `await` sequencing inside the async transaction callback — after the existence check, the same-status guard, the state-machine check, and both conditional stock-adjustment calls. Because every one of those prior steps can `throw`, and a thrown error inside a Prisma `$transaction` callback causes the entire transaction to roll back, this ordering guarantees that a status is never persisted for a transition that failed validation or failed a stock check.

There is no separate "pending"/"in-flight" status recorded; the write is a direct, single-column update with no optimistic-concurrency token (no `version` field, no `updatedAt` precondition in the `where` clause), meaning Prisma/MySQL's transaction isolation is the sole mechanism preventing a lost update if two `changeStatus` calls for the same order id were to run concurrently (see Technical Debt & Risks for the specific race condition this can enable).

**Rule workflow:**
All prior guards pass → `tx.order.update({ status: to })` → status column overwritten unconditionally with the validated `to` value → proceed to history append.

---

### Business Rule: Immutable Status History Audit Trail

**Overview:**
Every successful status change appends a new, append-only `OrderStatusHistory` row capturing the who/when/from/to/why of the transition; history rows are never edited or deleted by this method.

**Detailed description:**
`tx.orderStatusHistory.create({ data: { orderId: id, fromStatus: from, toStatus: to, changedById: userId, reason: input.reason ?? null } })` (`order.service.ts:159-167`) runs immediately after the status update, in the same transaction. `fromStatus` is nullable at the schema level (`prisma/schema.prisma:119`, `OrderStatus?`) specifically to accommodate the very first history row written at order creation (`order.service.ts:106-112`, where `fromStatus: null` represents "no prior status"); every subsequent row written by `changeStatus` always has a non-null `fromStatus` since `from` is read from an existing order's current status.

This design gives the system a complete, queryable timeline of every state the order has ever been in, who changed it (`changedById`, a foreign key to `User`), and an optional human-readable `reason` (capped at 500 characters by the Zod schema, `order.schemas.ts:20`). Combined with the `create` method's initial `PENDING` row, the `history` relation (ordered by `changedAt ascending` wherever it is fetched — `order.service.ts:173`, `order.repository.ts:56`) forms a complete, monotonically ordered audit log with no gaps, since every legal transition necessarily passes through this single code path (there is no other place in the codebase that writes to `Order.status` or `OrderStatusHistory`).

**Rule workflow:**
Status update succeeds → `tx.orderStatusHistory.create({ orderId, fromStatus: from, toStatus: to, changedById: userId, reason })` → new immutable row appended → history relation now includes this transition when the order is next read with `include: { history: true }`.

---

### Business Rule: Optional Reason Field

**Overview:**
Callers may, but are not required to, supply a free-text `reason` explaining why the status was changed.

**Detailed description:**
`updateOrderStatusSchema` (`order.schemas.ts:18-21`) defines `reason: z.string().max(500).optional()`. In `changeStatus`, this becomes `reason: input.reason ?? null` when writing the history row (`order.service.ts:165`), so an omitted reason is stored as SQL `NULL` rather than an empty string or being left off the insert. There is no business rule requiring a reason for any particular transition (e.g., cancellations do not mandate a reason, even though a reason is arguably most valuable there) — the field is uniformly optional regardless of `to`.

**Rule workflow:**
Request body may include `reason` (≤ 500 chars) → validated by Zod at the route boundary → passed through unchanged into `input.reason` → `input.reason ?? null` stored in `OrderStatusHistory.reason`.

---

### Business Rule: Transaction Boundary — All-or-Nothing Atomicity

**Overview:**
Every read and write inside `changeStatus` — the existence check, both guard clauses, the stock debit or replenish, the status update, the history insert, and the final rehydration read — executes inside one `prisma.$transaction(async (tx) => { ... })` callback (`order.service.ts:131-178`), so the operation is atomic: either every step succeeds and all writes commit together, or any thrown error rolls back every write that had already occurred earlier in the same call.

**Detailed description:**
This is the architectural property the entire method is built around, and it is what the transcript's outbox discussion depends on preserving. Because `NotFoundError`, `ConflictError`, `InvalidStatusTransitionError`, and `InsufficientStockError` are all thrown as ordinary JavaScript exceptions from within the callback, Prisma's `$transaction` automatically issues a `ROLLBACK` for any of them — there is no manual `try/catch` inside `changeStatus` itself; error handling is delegated entirely to the transaction wrapper and, further up the stack, to the controller's `catch (err) { next(err) }` and the centralized `errorMiddleware`.

This means a failed stock check on item 2 of a 3-item order guarantees item 1's stock decrement (already applied earlier in the `for` loop within the same `debitStock` call, if the loop had gotten that far) is also undone — though as established in the Insufficient Stock rule above, the two-pass (validate-all, then mutate-all) structure of `debitStock` means no mutation is ever attempted before validation completes, making this transactional guarantee a backstop rather than the primary correctness mechanism for that specific case. The transactional guarantee is, however, the *only* mechanism protecting against a partial failure between the status update (line 158) and the history insert (line 159) — if the history insert were to fail (e.g., a future non-null constraint violation, or a foreign-key violation on `changedById`), the already-applied `status` update is rolled back with it, so the order is never left "PAID with no PAID history row."

This is also the exact property flagged as at risk by the architectural report accompanying this analysis: any future addition that performs network I/O (a synchronous webhook `fetch`/`axios` call, for instance) directly inside this transaction would hold open the underlying database transaction — and therefore its row locks on `order`, the affected `product` rows, and `orderStatusHistory` — for the duration of that external call. This is precisely why the team's outbox decision (see Section 2a) inserts only a local database row here and defers the actual outbound HTTP call to a separate worker process reading the outbox table asynchronously.

**Rule workflow:**
Transaction opens → steps 5.1-5.8 (see Data Flow Analysis) execute sequentially → any step throws → all prior writes in this call are rolled back, nothing is persisted, the error propagates to the caller → all steps complete without throwing → `COMMIT`, all writes (status, stock, history) become durable together.

---

### Business Rule: Response Returns the Fully Rehydrated Order

**Overview:**
The method's return value is not the raw result of the `tx.order.update` call, but a fresh, fully-related read of the order performed at the end of the same transaction.

**Detailed description:**
After the history insert, `changeStatus` performs a second `tx.order.findUnique` (`order.service.ts:169-176`) with the same `include` shape used elsewhere in the module (`items` with nested `product` selection, `history` ordered by `changedAt ascending`, `customer` with a narrow field selection) — structurally identical to the `include` block used in `create` (`order.service.ts:115-119`) and in `OrderRepository.findByIdWithRelations` (`order.repository.ts:47-59`). The result is asserted non-null with the `!` operator (`order.service.ts:177`) — safe in practice because the row was confirmed to exist and was just updated within the same transaction, but not statically guaranteed by the type system.

This guarantees API consumers always receive a complete, consistent snapshot (including the just-appended history row and, if applicable, the just-adjusted stock reflected transitively through `items`/`product` if the client also queries products) rather than having to make a second `GET /orders/:id` call to see the effect of the status change. The cost is an extra round trip to the database inside the same transaction (a second `SELECT` beyond the first at line 132), which is a deliberate consistency-over-efficiency trade-off, but it is also the third place in this file where the same relational `include` shape is spelled out verbatim rather than being extracted into a shared helper (see Technical Debt & Risks).

**Rule workflow:**
History insert succeeds → `tx.order.findUnique` with full `include` (items+product, history, customer) → non-null result asserted → returned to `OrderController.changeStatus` → serialized as the HTTP 200 JSON body.

---

### Business Rule (Input Validation): `toStatus` Enum and `reason` Length Constraints

**Overview:**
Before `OrderService.changeStatus` ever runs, the HTTP body is constrained by a Zod schema so that `toStatus` can only ever be one of the six known `OrderStatus` enum values, and `reason`, if present, cannot exceed 500 characters.

**Detailed description:**
`updateOrderStatusSchema = z.object({ toStatus: z.nativeEnum(OrderStatus), reason: z.string().max(500).optional() })` (`order.schemas.ts:18-21`) is applied by the `validate` middleware at the route level (`order.routes.ts:19-23`), before the controller or service ever execute. A malformed or unknown `toStatus` value (e.g., a typo, or a status name that does not exist in the Prisma-generated `OrderStatus` enum) is rejected at this layer with HTTP 400 (`errorCode: VALIDATION_ERROR`), never reaching `OrderService.changeStatus` at all. This means `changeStatus`'s own `canTransition` check only ever has to reason about the six legitimate enum members — it is not defensively coded against arbitrary strings, because the type system and the Zod boundary already exclude that case upstream. The `orderIdParamSchema` (`order.schemas.ts:4`) similarly guarantees `id` is a syntactically valid UUID before `changeStatus` performs its `findUnique`.

**Rule workflow:**
Raw HTTP body → `validate({ body: updateOrderStatusSchema })` middleware → invalid `toStatus`/oversized `reason` → 400 `VALIDATION_ERROR`, `changeStatus` never invoked → valid → typed `UpdateOrderStatusInput` passed into `OrderService.changeStatus`.

---

### Business Rule (Gap): No Role-Based Restriction on Status Changes

**Overview:**
The `PATCH /api/v1/orders/:id/status` route requires only that the caller be *authenticated*, not that they hold any particular role — any `ADMIN` or `OPERATOR` user can transition any order to any legal next status, including cancellations that trigger stock replenishment.

**Detailed description:**
`order.routes.ts:19-23` applies `validate({ params, body })` and, at the router level, `authenticate` (`order.routes.ts:14`) — it never applies `requireRole(...)` (defined in `auth.middleware.ts:49-61` and used exactly once in the whole codebase, on `GET /users/:id`). This is not a bug introduced by `changeStatus` itself, but it is a business-relevant gap directly affecting this method's real-world blast radius: because stock replenishment and cancellation are business-sensitive operations (they affect inventory counts other parts of the system, and eventually the future webhook consumers, rely on), the absence of a role check here means the `ADMIN`/`OPERATOR` distinction defined in the data model (`prisma/schema.prisma:11-14`) carries no actual enforcement weight for this endpoint. This is documented as a cross-cutting finding in the accompanying architectural report and is repeated here because it is a business rule *by omission* directly scoped to `changeStatus`.

**Rule workflow:**
Any authenticated user (`ADMIN` or `OPERATOR`) → passes `authenticate` → no `requireRole` gate exists on this route → reaches `OrderController.changeStatus`/`OrderService.changeStatus` unconditionally.

---

## 4. Component Structure

```
src/modules/orders/
├── order.routes.ts        # Wires PATCH /:id/status -> validate({params, body}) -> controller.changeStatus
├── order.controller.ts    # changeStatus(): thin HTTP adapter, requires req.user, delegates to service, next(err) on failure
├── order.service.ts       # <-- ANALYSIS TARGET
│                          #   changeStatus() [126-179]      : the transactional method itself
│                          #   debitStock()   [204-231, private] : stock validation + decrement, called only from changeStatus
│                          #   replenishStock()[233-243, private] : stock increment, called only from changeStatus
│                          #   (list/getById/create/delete/aggregateItems/reserveOrderNumber: out of scope,
│                          #    shown here only because they share the class and its two constructor deps)
├── order.status.ts        # Pure state-machine module consumed by changeStatus:
│                          #   canTransition(), shouldDebitStock(), shouldReplenishStock()
│                          #   (allowedTransitions(), isTerminal(): exported but NOT called by changeStatus)
├── order.repository.ts    # OrderRepository: NOT used by changeStatus (only by list/getById/delete) — shown for contrast
└── order.schemas.ts       # updateOrderStatusSchema (toStatus, reason) + orderIdParamSchema: gate changeStatus's input

Supporting shared modules referenced by changeStatus's transactional flow:
src/shared/errors/
├── app-error.ts           # AppError base class (statusCode, errorCode, details)
├── http-errors.ts         # NotFoundError, ConflictError, InvalidStatusTransitionError, InsufficientStockError
└── index.ts               # Re-exports consumed by order.service.ts:9-16

prisma/schema.prisma        # Order, OrderItem, Product, OrderStatusHistory models + OrderStatus enum
                             # touched directly via the `tx` client inside changeStatus's transaction
```

---

## 5. Dependency Analysis

```
Internal Dependencies (call chain for changeStatus):

OrderController.changeStatus
  -> OrderService.changeStatus
       -> order.status.ts: canTransition(from, to)
       -> order.status.ts: shouldDebitStock(from, to)
       -> order.status.ts: shouldReplenishStock(from, to)
       -> OrderService.debitStock(tx, items)           [private, only caller is changeStatus]
            -> Prisma tx.product.findMany / tx.product.update
            -> shared/errors: InsufficientStockError
       -> OrderService.replenishStock(tx, items)        [private, only caller is changeStatus]
            -> Prisma tx.product.update
       -> Prisma tx.order.findUnique / tx.order.update / tx.order.findUnique (refresh)
       -> Prisma tx.orderStatusHistory.create
       -> shared/errors: NotFoundError, ConflictError, InvalidStatusTransitionError
  -> shared/errors: UnauthorizedError (guard in the controller, not the service)

Notably absent: OrderService.changeStatus does NOT call OrderRepository at any point
(unlike list/getById/delete, which do). It reads and writes the `order`, `product`, and
`orderStatusHistory` tables exclusively through the ambient `tx` client captured by the
prisma.$transaction closure.

External Dependencies:
- @prisma/client (5.22.0)   - ORM / query builder; supplies OrderStatus enum, Prisma.TransactionClient
                                type, and the runtime tx object used for every DB read/write in this method
- MySQL 8.0 (via DATABASE_URL, prisma/schema.prisma:5-9) - persistence engine underlying every
                                tx.* operation; transaction semantics (atomicity/isolation) are provided
                                by MySQL/InnoDB via Prisma's $transaction wrapper
- express (4.21.1)           - RequestHandler typing and req/res/next plumbing in OrderController
- zod (3.23.8)                - updateOrderStatusSchema / orderIdParamSchema validate the HTTP
                                inputs before changeStatus is ever invoked
```

---

## 6. Afferent and Efferent Coupling

Granularity: class methods and pure functions (this is a TypeScript/OOP codebase; "components" are mapped to the service's methods, the state-machine module's functions, and the specific error classes this method's flow depends on).

| Component | Afferent Coupling | Efferent Coupling | Critical |
|-----------|-------------------|--------------------|----------|
| `OrderService.changeStatus` | 1 (`OrderController.changeStatus`) | 10 (`canTransition`, `shouldDebitStock`, `shouldReplenishStock`, `debitStock`, `replenishStock`, Prisma `tx.order`, `tx.orderStatusHistory`, `NotFoundError`, `ConflictError`, `InvalidStatusTransitionError`) | High |
| `OrderService.debitStock` (private) | 1 (`changeStatus` only) | 2 (Prisma `tx.product`, `InsufficientStockError`) | High |
| `OrderService.replenishStock` (private) | 1 (`changeStatus` only) | 1 (Prisma `tx.product`) | Medium |
| `order.status.ts: canTransition` | 1 (`changeStatus` only) | 1 (internal `transitions` map) | Medium |
| `order.status.ts: shouldDebitStock` | 1 (`changeStatus` only) | 1 (internal `STOCK_DEBIT_TRANSITION` constant) | Low |
| `order.status.ts: shouldReplenishStock` | 1 (`changeStatus` only) | 0 (inline comparison only) | Low |
| `NotFoundError` | 9 (whole codebase; 3 of those inside `order.service.ts`, of which 1 is inside `changeStatus` at line 136) | 1 (`AppError`) | Low |
| `ConflictError` | 7 (whole codebase; 2 inside `order.service.ts`, of which 1 is inside `changeStatus` at line 141) | 1 (`AppError`) | Low |
| `InvalidStatusTransitionError` | 1 (used only in `changeStatus`, line 148) | 1 (extends `ConflictError`) | Medium — single caller, but that caller is a critical rule enforcement point |
| `InsufficientStockError` | 1 (used only in `debitStock`, line 223) | 1 (extends `UnprocessableEntityError` → `AppError`) | Medium — single caller, critical business rule |
| `OrderController.changeStatus` | 1 (route wiring, `order.routes.ts:19-23`) | 2 (`OrderService.changeStatus`, `UnauthorizedError`) | Low |
| `OrderRepository` | 3 (`list`, `getById`, `delete` — **not** `changeStatus`) | 0 | Low (irrelevant to this method, shown for contrast) |

---

## 7. Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/v1/orders/:id/status` | PATCH | Transitions an order to a new `OrderStatus` (validated against the state machine in `order.status.ts`), conditionally debits or replenishes product stock, appends an `OrderStatusHistory` record, and returns the fully rehydrated order. Requires `Authorization: Bearer <JWT>` (any authenticated role — no `requireRole` gate). Body: `{ toStatus: OrderStatus, reason?: string }`. Responses: `200` (updated order), `400` (`VALIDATION_ERROR` — bad `toStatus`/`reason`/`id`), `401` (missing/invalid JWT), `404` (`NOT_FOUND` — order does not exist), `409` (`INVALID_STATUS_TRANSITION` — same-status no-op or illegal edge), `422` (`INSUFFICIENT_STOCK` — stock shortfall on `PENDING → PAID`). |

---

## 8. Integration Points

| Integration | Type | Purpose | Protocol | Data Format | Error Handling |
|-------------|------|---------|----------|-------------|-----------------|
| MySQL (`Order`, `OrderItem`, `Product`, `OrderStatusHistory` tables) | Internal Database | Persist status transitions, stock adjustments, and audit history atomically | MySQL wire protocol via Prisma Client's query engine, wrapped in `prisma.$transaction` | Typed rows mapped to/from Prisma-generated TypeScript objects | Business-rule failures are pre-empted by explicit `AppError` subclasses thrown before any constraint violation could occur; residual Prisma exceptions (e.g., `P2025`, `P2002`) are caught generically by `errorMiddleware` (`src/middlewares/error.middleware.ts:37-54`), not by `changeStatus` itself — the method has no local `try/catch` |
| HTTP JSON API consumer (caller of `PATCH /:id/status`) | Internal REST API | Deliver the state-transition request and receive the updated order representation | HTTPS/REST (assumed at deployment; not TLS-enforced in-process) | JSON request/response, validated by Zod (`updateOrderStatusSchema`) | Centralized `errorMiddleware` maps every `AppError` subtype to its `statusCode`/`errorCode`/`details`; unhandled errors fall back to 500 `INTERNAL_SERVER_ERROR` |
| (Planned, not yet implemented) `webhook_outbox` table | Internal Database (future) | Record a pending outbound notification event in the same transaction as the status change, per the Transactional Outbox pattern | N/A (design-time only; see Section 2a) | Rendered JSON snapshot per `TRANSCRICAO.md` [09:52] | Not yet implemented; per the transcript, insert failures must roll back the whole `changeStatus` transaction (no status change without a corresponding outbox row) |

---

## 9. Design Patterns & Architecture

| Pattern | Implementation | Location | Purpose |
|---------|-----------------|----------|---------|
| State Machine / Transition Table | `transitions` readonly lookup map + `canTransition`/`shouldDebitStock`/`shouldReplenishStock` pure predicates | `src/modules/orders/order.status.ts:3-37` | Encodes the entire order lifecycle and its stock side-effect triggers as declarative data, decoupled from persistence/transaction concerns |
| Transaction Script (Unit of Work via `prisma.$transaction`) | The whole `changeStatus` body is one callback passed to `this.prisma.$transaction(...)` | `order.service.ts:131-178` | Guarantees the status update, stock adjustment, and history append are applied atomically — all-or-nothing |
| Guard Clause | Sequential early-throw checks (`if (!order) throw`, `if (from === to) throw`, `if (!canTransition(...)) throw`) | `order.service.ts:136, 140-146, 147-149` | Keeps the "happy path" un-nested; each precondition fails fast with a specific, typed error |
| Append-Only Audit Log | `tx.orderStatusHistory.create(...)`, never `.update()`/`.delete()` on this table anywhere in the codebase | `order.service.ts:159-167` | Provides an immutable, chronologically-ordered audit trail of every status transition |
| Read-After-Write Rehydration | Second `tx.order.findUnique(...)` with full `include` immediately before returning | `order.service.ts:169-176` | Guarantees the API response always reflects the complete, just-committed state rather than a partial write result |
| Direct Data-Access Bypass of the Repository layer | `changeStatus` uses the ambient `tx` client directly instead of `OrderRepository` | `order.service.ts:131-178` (contrast with `order.repository.ts`) | Enables a single multi-table transaction spanning `order`, `product`, and `orderStatusHistory` that a single-entity repository does not model; a deliberate, documented deviation from the `Service → Repository → PrismaClient` layering used by the other four modules in this codebase |

---

## 10. Technical Debt & Risks

| Risk Level | Component Area | Issue | Impact |
|------------|-----------------|-------|--------|
| High | `order.routes.ts` / `auth.middleware.ts` | `changeStatus`'s route applies only `authenticate`, never `requireRole` | Any authenticated user of either role (`ADMIN` or `OPERATOR`) can trigger any legal transition, including cancellations that replenish stock, with no role differentiation |
| High | `OrderService.changeStatus` (no row locking) | `tx.order.findUnique` (line 132) is a plain read, not a `SELECT ... FOR UPDATE`; there is no optimistic-concurrency column (`version`/`updatedAt` precondition) on the later `tx.order.update` (line 158) | Two concurrent `changeStatus` calls for the same order id could both read the same pre-transition `status`/stock and both attempt conflicting transitions or stock adjustments, relying entirely on MySQL/InnoDB's default isolation level (not explicitly configured or documented in this codebase) to prevent anomalies |
| Medium | `order.service.ts` (repository bypass) | `changeStatus` reads/writes `order`, `product`, and `orderStatusHistory` directly via `tx`, duplicating the "order with relations" `include` shape that also appears in `create` (lines 115-119) and in `OrderRepository.findByIdWithRelations` (`order.repository.ts:47-59`) | Three independent copies of the same relational shape; a future change to the desired response shape (e.g., adding a new relation) must be updated in three places to stay consistent, with no compiler-enforced link between them |
| Medium | `order.service.ts` (no extension point, pre-outbox) | As of this analysis, `changeStatus` has no hook for the planned webhook/outbox insert; the integration point identified in Section 2a is inferred from the surrounding transaction structure and the design-meeting transcript, not from any existing seam (interface, event emitter, etc.) in the code | Implementing the outbox feature requires directly editing this method between two specific lines rather than composing with it; any merge conflict or refactor of `changeStatus` before that feature lands must be coordinated with the FDD's planned insertion point |
| Medium | `order.service.ts:140-149` (error-code overlap) | The same-status guard (line 141) and the state-machine violation guard (line 148) both raise `errorCode: INVALID_STATUS_TRANSITION`, distinguishable only by message text or by comparing `details.from === details.to` | API consumers cannot branch on `error.code` alone to distinguish "no-op transition" from "illegal transition" |
| Low | `order.service.ts:216-218` (`debitStock`) | The `unavailable` fallback (`product?.sku ?? item.productId`, `product?.stockQuantity ?? 0`) defends against a missing `Product` row for an existing `OrderItem`, which should be unreachable given the FK relationship (`prisma/schema.prisma:109`, `product Product @relation(...)`) | Dead defensive code with no test exercising it; low risk, but a maintainer reading it may assume it is reachable in normal operation |
| Low | `order.service.ts:132-135` (eager `items` include) | The initial `tx.order.findUnique` always includes `items`, even for transitions that neither debit nor replenish stock (e.g., `PAID → PROCESSING`, `PROCESSING → SHIPPED`, `SHIPPED → DELIVERED`) | A small, consistent extra query cost paid on every call regardless of whether the items are needed downstream |
| Informational | `order.service.ts:131-178` (transaction scope, currently DB-only) | The transaction currently performs only database operations (no network I/O) — this is a strength today, but is exactly the property that must be preserved when the outbox insert (Section 2a) is added; any accidental introduction of a synchronous outbound HTTP call inside this transaction would reintroduce the risk the team explicitly rejected in `TRANSCRICAO.md` [09:04-09:06] | Not a current defect; flagged because it is the single most important invariant to protect when this method is next modified |

---

## 11. Test Coverage Analysis

Only one test file in the repository exercises `changeStatus`, and it is a full-stack integration test (real Express app via `buildApp()`, real MySQL via Prisma, Supertest as the HTTP driver — no mocks, no test doubles, per `tests/setup.ts` and `tests/helpers/factories.ts`). No dedicated unit tests exist for `order.status.ts`'s pure functions or for `OrderService`'s private `debitStock`/`replenishStock` methods, despite `canTransition`/`shouldDebitStock`/`shouldReplenishStock` being pure, dependency-free, and trivially unit-testable in isolation from any database.

| Component | Unit Tests | Integration Tests | Coverage (qualitative) | Test Quality |
|-----------|------------|--------------------|--------------------------|---------------|
| `OrderService.changeStatus` (happy paths) | 0 | 2 direct (`tests/orders.test.ts:59-87` PENDING→PAID debits stock; `tests/orders.test.ts:134-161` PAID→CANCELLED then verifies replenishment) + 2 indirect setup uses (`:163-195` list-by-status uses a PAID transition as fixture setup; `:197-218` delete-guard test transitions to PAID as setup) | Good coverage of the two stock-affecting transitions specifically, including asserting the resulting `stockQuantity` via a direct Prisma read after the HTTP call | Assertions check both the HTTP response shape (`status`, `history` ordering) and the underlying DB state (`stockQuantity`) — strong end-to-end verification for the paths it covers |
| `OrderService.changeStatus` (error paths) | 0 | 2 (`tests/orders.test.ts:89-107` 409 on `PENDING → SHIPPED`, an illegal edge; `tests/orders.test.ts:109-132` 422 on `PENDING → PAID` with insufficient stock, asserting `error.details.unavailable[0].sku` and that stock was left unchanged) | Covers one illegal-transition case and the insufficient-stock case; does **not** cover the 404 branch (order not found) or the 409 same-status branch (`from === to`, line 140-146) specifically for `changeStatus` — both are only reachable in principle, never exercised by any test | Good depth on the two covered error paths (asserts both status code and error code); two of the four documented failure branches in this method have no test at all |
| `debitStock` (private) | 0 | Indirectly via the two tests above (stock decrement / insufficient stock) | Reachable only through `changeStatus`'s HTTP surface; no isolated test constructs `debitStock` with a hand-crafted multi-item, partially-out-of-stock scenario to confirm the "collect all shortfalls across all items" behavior described in Section 3 | No test currently proves that a multi-item order with two different insufficient items reports both in `unavailable` (only single-item scenarios are exercised) |
| `replenishStock` (private) | 0 | 1 (`tests/orders.test.ts:134-161`, asserts stock returns to its pre-debit value after `PAID → CANCELLED`) | Covers only the `PAID → CANCELLED` edge; the `PROCESSING → CANCELLED` replenishment edge (also enabled by `shouldReplenishStock`) is never exercised by any test | Single scenario tested; the sibling legal edge for the same function is untested |
| `order.status.ts` (`canTransition`, `shouldDebitStock`, `shouldReplenishStock`, `allowedTransitions`, `isTerminal`) | 0 | 0 direct — only exercised transitively as a side effect of the HTTP-level tests above | No test imports `order.status.ts` directly; the module's behavior for the four transitions never exercised by an HTTP test (`PAID→PROCESSING`, `PROCESSING→SHIPPED`, `SHIPPED→DELIVERED`, `PENDING→CANCELLED`) is entirely unverified by the test suite, and `allowedTransitions`/`isTerminal` are not referenced by any test at all | Significant gap: this is the single most reusable, most easily unit-testable piece of business logic in the analyzed scope, and it currently has zero dedicated tests |
| History append (`OrderStatusHistory`) | 0 | Indirectly asserted via `history[].toStatus` sequences in `tests/orders.test.ts:80-83` and `:37-38` (for order creation) | Confirms `toStatus` values and ordering after one transition; does **not** assert `fromStatus`, `changedById`, or that a supplied `reason` (e.g., `'payment confirmed'` sent at line 76) is actually persisted and returned in the history row | The `reason` field is exercised as an input in two tests but its persisted value is never asserted in any response body check |

**Test file location:** `tests/orders.test.ts` (all `changeStatus`-relevant assertions; 219 lines total, 5 of 7 `describe` blocks touch `changeStatus` directly or as setup). Supporting fixtures: `tests/helpers/factories.ts` (`createTestProduct`, `createTestCustomer`, `bootstrapAuthenticatedUser`), test lifecycle: `tests/setup.ts` (truncates all relevant tables — `orderStatusHistory`, `orderItem`, `order`, `product`, `customer`, `user` — before every test, `beforeEach`, lines 8-15). No `vitest.config.ts` coverage instrumentation/thresholds are configured (`vitest.config.ts` has no `coverage` block), and no `/coverage` artifact exists in the repository as of this analysis — there is no quantitative (percentage) coverage figure available; the qualitative assessment above is derived from manually cross-referencing every branch in `order.service.ts:126-243` and `order.status.ts` against every assertion in `tests/orders.test.ts`.

---

*End of Component Deep Analysis Report.*
