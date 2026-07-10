# FDD — Sistema de Webhooks de Notificação de Pedidos

| Campo | Valor |
| --- | --- |
| **Status** | Proposto |
| **Feature** | Webhooks outbound de notificação de mudança de status de pedido |
| **Documentos relacionados** | [PRD](./PRD.md), [RFC](./RFC.md), [ADRs](./adrs/) |

---

## 1. Contexto e motivação técnica

O OMS altera o status de pedidos em `OrderService.changeStatus`
(`src/modules/orders/order.service.ts:126-179`), dentro de uma transação Prisma que atualiza o
pedido, grava histórico e ajusta estoque. Não há hoje nenhum mecanismo de notificação externa.
Clientes B2B precisam ser avisados em < 10s quando o status muda, sem que a chamada externa
comprometa a transação crítica de pedidos. [09:04 Bruno]

A solução adotada é o **padrão Outbox** (ver [ADR-001](./adrs/ADR-001-outbox-no-mysql.md)): o
evento é persistido na mesma transação da mudança de status e entregue de forma assíncrona por um
worker dedicado.

## 2. Objetivos técnicos

- Emitir um evento por mudança de status **atômico** com a transação de `changeStatus`.
- Entregar via HTTP POST assinado (HMAC-SHA256) com latência de pior caso ~2s.
- Garantir entrega **at-least-once** com deduplicação pelo cliente (`X-Event-Id`).
- Resiliência a clientes indisponíveis: retry com backoff + DLQ.
- Reusar 100% dos padrões do projeto (módulos, `AppError`, Pino, `requireRole`), sem infra nova.

## 3. Escopo e exclusões

**No escopo:** CRUD de configuração de webhook, filtro por status, tabela outbox, worker de
entrega, retry/backoff, DLQ + replay admin, HMAC + rotação de secret, histórico de entregas.

**Fora de escopo:** e-mail de aviso de falha ao cliente [09:37], dashboard/painel visual [09:40],
rate limiting de saída [09:39], ordering global entre pedidos [09:13], arquivamento da outbox
(~30 dias) [09:08], endurecimento de roles do CRUD [09:37].

## 4. Modelo de dados (novas tabelas)

Todas com PK `id` em UUID, seguindo o padrão do projeto [09:51]. Detalhe de colunas fica a cargo
da implementação; visão geral:

- **`webhook_config`** — `url` (https), `secret`, `secret_previous`, `secret_previous_expires_at`,
  `customer_id`, `events` (lista de status), `active`, timestamps.
- **`webhook_outbox`** — `event_id` (UUID), `event_type`, `payload` (snapshot JSON), `status`
  (`PENDING|PROCESSING|DELIVERED|FAILED`), `attempts`, `next_attempt_at`, `created_at`. Índices em
  `status` e `created_at`. [09:08]
- **`webhook_dead_letter`** — `payload`, `failure_reason`, `webhook_config_id`, `created_at`. [09:18]
- **`webhook_delivery`** — histórico: `webhook_config_id`, `event_id`, `success`, `status_code`,
  `response_body`, `duration_ms`, `created_at`. [09:34]

## 5. Fluxos detalhados

### 5.1 Criação do evento na outbox (dentro da transação)

1. `changeStatus` valida a transição via `canTransition` (`src/modules/orders/order.status.ts`).
2. Após `tx.orderStatusHistory.create` (`order.service.ts:159-167`) e **antes** do
   `refreshed` (`order.service.ts:169`), chama `publishWebhookEvent(tx, order, from, to)`. [09:41]
3. `publishWebhookEvent` consulta os `webhook_config` **ativos** do `customer_id` do pedido cujo
   `events` inclui `to`. Se nenhum, **não insere** (economiza linha). [09:34]
4. Para cada config correspondente, insere uma linha em `webhook_outbox` com `event_id` novo
   (UUID) e o `payload` já renderizado (snapshot). [09:52]
5. Se o insert falhar, a transação inteira sofre rollback — status não muda sem evento. [09:40]

> **Nota de implementação (armadilha):** neste ponto `order.status` ainda é o valor **antigo**
> (o `update` da linha 158 não altera o objeto `order` em memória). As pontas da transição devem
> vir dos parâmetros `from`/`to`, nunca de reler `order.status`.

### 5.2 Processamento pelo worker

1. Worker (`src/worker.ts`) em processo separado, `PrismaClient` próprio, loop a cada 2s. [ADR-002]
2. Busca eventos `PENDING` com `next_attempt_at <= now`, ordenados por `created_at`, em batch pequeno.
3. Marca `PROCESSING`, monta headers, assina com HMAC-SHA256, faz POST (timeout 10s). [09:42]
4. Resposta 2xx → `DELIVERED` + registra em `webhook_delivery`. Caso contrário → fluxo de retry.

### 5.3 Retry e DLQ

1. Falha (status ≥ 400, timeout, erro de rede) incrementa `attempts` e agenda `next_attempt_at`
   pelo backoff **1m / 5m / 30m / 2h / 12h**. [ADR-003]
2. Ao atingir **5 tentativas** sem sucesso, move o evento para `webhook_dead_letter` (com
   `failure_reason`) e marca a outbox como `FAILED`.
3. Replay: `POST /admin/webhooks/dead-letter/:id/replay` (role `ADMIN`) recria o evento como
   `PENDING` na outbox e loga quem executou. [09:36]

## 6. Contratos públicos (endpoints HTTP)

Base: `/api/v1`. Todos os endpoints de configuração exigem `authenticate`; o replay exige
`requireRole('ADMIN')`. Envelope de resposta segue o padrão do projeto (`src/shared/http/response.ts`).

### 6.1 `POST /webhooks` — cadastrar webhook

Request:
```json
{
  "customerId": "c1a2...",
  "url": "https://cliente.exemplo.com/webhooks/pedidos",
  "events": ["SHIPPED", "DELIVERED"]
}
```
Response `201 Created` (a `secret` só é devolvida na criação [09:31]):
```json
{
  "id": "wh_9f8e...",
  "customerId": "c1a2...",
  "url": "https://cliente.exemplo.com/webhooks/pedidos",
  "events": ["SHIPPED", "DELIVERED"],
  "secret": "whsec_3a7b9c1d...",
  "active": true,
  "createdAt": "2026-07-10T12:00:00.000Z"
}
```
Status: `201`, `400` (`WEBHOOK_INVALID_URL`, `WEBHOOK_INVALID_EVENT`), `401`, `409` (`WEBHOOK_ALREADY_EXISTS`).

### 6.2 `PATCH /webhooks/:id` — editar webhook

Request (campos parciais):
```json
{ "events": ["PAID", "SHIPPED", "DELIVERED"], "active": false }
```
Response `200 OK`:
```json
{ "id": "wh_9f8e...", "events": ["PAID","SHIPPED","DELIVERED"], "active": false, "updatedAt": "2026-07-10T12:05:00.000Z" }
```
Status: `200`, `400`, `401`, `404` (`WEBHOOK_NOT_FOUND`).

### 6.3 `GET /webhooks?customerId=...` — listar webhooks do customer

Response `200 OK` (secret nunca é retornada em leitura):
```json
{
  "data": [
    { "id": "wh_9f8e...", "url": "https://cliente.exemplo.com/webhooks/pedidos", "events": ["SHIPPED","DELIVERED"], "active": true }
  ],
  "meta": { "total": 1 }
}
```
Status: `200`, `401`.

### 6.4 `GET /webhooks/:id/deliveries` — histórico de entregas

Response `200 OK` (últimas ~100 entregas [09:34]):
```json
{
  "data": [
    {
      "eventId": "evt_5b1c...",
      "success": false,
      "statusCode": 503,
      "durationMs": 1042,
      "attempt": 2,
      "createdAt": "2026-07-10T12:03:11.000Z"
    }
  ],
  "meta": { "total": 1 }
}
```
Status: `200`, `401`, `404` (`WEBHOOK_NOT_FOUND`).

### 6.5 `POST /webhooks/:id/rotate-secret` — rotacionar secret

Response `200 OK` (secret antiga válida por 24h [09:21]):
```json
{ "id": "wh_9f8e...", "secret": "whsec_new_88f2...", "previousSecretExpiresAt": "2026-07-11T12:10:00.000Z" }
```
Status: `200`, `401`, `404`.

### 6.6 `POST /admin/webhooks/dead-letter/:id/replay` — reprocessar DLQ (ADMIN)

Response `202 Accepted`:
```json
{ "deadLetterId": "dl_2c9a...", "requeuedEventId": "evt_5b1c...", "status": "PENDING" }
```
Status: `202`, `401`, `403` (`WEBHOOK_FORBIDDEN`), `404` (`WEBHOOK_DEAD_LETTER_NOT_FOUND`).

### 6.7 Requisição enviada ao cliente (webhook outbound)

`POST {config.url}` com headers [09:44]:
```
Content-Type: application/json
X-Event-Id: evt_5b1c...
X-Webhook-Id: wh_9f8e...
X-Signature: sha256=6f3b...        (HMAC-SHA256 do corpo com a secret do endpoint)
X-Timestamp: 2026-07-10T12:00:02.000Z
```
Body (payload enxuto, sem `items` [09:43]):
```json
{
  "event_id": "evt_5b1c...",
  "event_type": "order.status_changed",
  "timestamp": "2026-07-10T12:00:02.000Z",
  "order_id": "o_7d2e...",
  "order_number": "ORD-2026-000123",
  "from_status": "PROCESSING",
  "to_status": "SHIPPED",
  "customer_id": "c1a2...",
  "total_cents": 149900
}
```
Sucesso esperado do cliente: `2xx`. Qualquer outra resposta ou timeout (10s) conta como falha.

## 7. Matriz de erros previstos (`WEBHOOK_*`)

Todos estendem `AppError` (`src/shared/errors/app-error.ts`); o error middleware
(`src/middlewares/error.middleware.ts`) os reconhece por `instanceof`. [ADR-006]

| Código | HTTP | Quando ocorre |
| --- | --- | --- |
| `WEBHOOK_NOT_FOUND` | 404 | Webhook inexistente em edição/consulta |
| `WEBHOOK_INVALID_URL` | 400 | URL não é https (validação Zod) [09:23] |
| `WEBHOOK_INVALID_EVENT` | 400 | Status informado em `events` não pertence à máquina de estados |
| `WEBHOOK_ALREADY_EXISTS` | 409 | Já existe webhook idêntico (url) para o customer |
| `WEBHOOK_SECRET_REQUIRED` | 400 | Operação exige secret ausente |
| `WEBHOOK_PAYLOAD_TOO_LARGE` | 422 | Payload renderizado excede 64KB [09:24] |
| `WEBHOOK_DEAD_LETTER_NOT_FOUND` | 404 | Replay de DLQ inexistente |
| `WEBHOOK_FORBIDDEN` | 403 | Replay sem role `ADMIN` |

## 8. Estratégias de resiliência

- **Timeout:** 10s por tentativa de entrega; excedeu → falha e retry. [09:42]
- **Retry/backoff:** exponencial `1m/5m/30m/2h/12h`, 5 tentativas. [ADR-003]
- **DLQ:** eventos esgotados vão para `webhook_dead_letter`, com replay manual admin. [ADR-003]
- **Atomicidade:** outbox na mesma transação de `changeStatus` — sem evento perdido. [ADR-001]
- **Fallback de ordenação:** single-worker garante ordem por `order_id` (limitação conhecida). [09:13]
- **Idempotência:** `event_id` estável por evento; cliente deduplica. [ADR-005]

## 9. Observabilidade

- **Logs:** logger Pino existente (`src/shared/logger/index.ts`), sem logger novo [09:29]. Cada
  tentativa de entrega loga `event_id`, `webhook_id`, `status_code`, `attempt`, `duration_ms`.
  Replay admin loga o usuário que executou (auditoria [09:36]).
- **Métricas:** contadores de eventos por status da outbox (`PENDING/DELIVERED/FAILED`), taxa de
  sucesso de entrega, latência de entrega, profundidade da DLQ, distribuição de tentativas.
- **Tracing:** propagar um correlation id (`event_id`) do insert na outbox até a entrega, para
  rastrear o ciclo de vida completo de um evento entre a API e o worker.

## 10. Integração com o sistema existente

Esta seção nomeia os pontos reais do código-base e como o módulo de webhooks se integra a cada um.

1. **`src/modules/orders/order.service.ts`** — `changeStatus` (linhas 126-179) é estendido para
   chamar `publishWebhookEvent(tx, order, from, to)` entre a criação do histórico (linha 167) e o
   `refreshed` (linha 169), **dentro** da transação Prisma existente. É a única alteração
   intrusiva no código atual. [09:41]
2. **`src/modules/orders/order.status.ts`** — a máquina de estados (6 status, 8 transições;
   `canTransition`, `allowedTransitions`, `isTerminal`) é a fonte de verdade para validar o campo
   `events` do webhook e para os valores `from_status`/`to_status` do payload.
3. **`src/shared/errors/app-error.ts`** — a família de erros `WEBHOOK_*` é criada como subclasses
   de `AppError`, reaproveitando o contrato `{ statusCode, errorCode, details }` já existente.
4. **`src/middlewares/error.middleware.ts`** — o error middleware centralizado trata os novos
   erros sem alteração, pois reconhece qualquer `AppError` por `instanceof`. [09:29]
5. **`src/middlewares/auth.middleware.ts`** — `authenticate` protege o CRUD; `requireRole('ADMIN')`
   é reusado no endpoint de replay de DLQ, no mesmo padrão de `GET /users/:id`. [09:36]
6. **`src/shared/logger/index.ts`** — logger Pino reutilizado pela API e pelo worker. [09:29]
7. **`src/server.ts`** — serve de modelo para o novo entry-point `src/worker.ts`; o worker usa a
   mesma `DATABASE_URL` com `PrismaClient` próprio por processo. [09:11, 09:30]
8. **`prisma/schema.prisma`** — recebe os novos modelos (`webhook_config`, `webhook_outbox`,
   `webhook_dead_letter`, `webhook_delivery`) e uma migração correspondente.

## 11. Dependências e compatibilidade

- **Runtime:** Node.js + TypeScript, Express, Prisma/MySQL já existentes — sem novas dependências
  de infraestrutura (sem Redis/broker). [09:07]
- **HMAC:** `crypto` nativo do Node (sem lib externa).
- **Processo:** novo script `npm run worker` apontando para `src/worker.ts`.
- **Banco:** mesma instância/`DATABASE_URL`; o worker abre `PrismaClient` próprio. [09:30]
- **Compatibilidade:** mudança aditiva; o único ponto de contato com código existente é a chamada
  em `changeStatus`, protegida pela transação.

## 12. Critérios de aceite técnicos

- ☐ Mudança de status insere exatamente um evento na outbox por webhook inscrito, na mesma
  transação; rollback da transação não deixa evento órfão.
- ☐ Nenhum evento é inserido se nenhum webhook do customer ouve aquele status.
- ☐ Worker entrega em ≤ ~2s (pior caso) sob carga normal; timeout de 10s aplicado por tentativa.
- ☐ Retry segue `1m/5m/30m/2h/12h`; após 5 falhas o evento está na DLQ.
- ☐ Toda entrega tem `X-Signature` válido (HMAC-SHA256) e `X-Event-Id` único.
- ☐ Replay de DLQ exige `ADMIN` e registra auditoria.
- ☐ Erros usam códigos `WEBHOOK_*` e passam pelo error middleware sem alteração deste.
- ☐ URL http é rejeitada com `WEBHOOK_INVALID_URL`; payload > 64KB com `WEBHOOK_PAYLOAD_TOO_LARGE`.

## 13. Riscos e mitigação

| Risco | Mitigação |
| --- | --- |
| Chamada de `publishWebhookEvent` lançar exceção e derrubar `changeStatus` | Manter a função enxuta (apenas insert indexado); a atomicidade é o objetivo — falha aqui deve mesmo abortar a mudança. [09:40] |
| `requireRole`/replay admin sem cobertura de teste hoje | Adicionar testes do endpoint admin antes do deploy; revisão de segurança dedicada. [09:36, 09:46] |
| Crescimento de `webhook_outbox` | Arquivamento de entregues (~30 dias) — fora do escopo, mas monitorar profundidade da tabela. [09:08] |
| Colisão de códigos `WEBHOOK_*` (sem registro central) | Convenção de prefixo + revisão em code review. [ADR-006] |
| Cliente lento tratado como falha | Timeout de 10s documentado; 5 tentativas absorvem lentidão transitória. [09:42] |
