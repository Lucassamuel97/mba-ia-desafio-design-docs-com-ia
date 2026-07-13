# Codebase Mapping — mba-ia-desafio-design-docs-com-ia

> Mapeamento voltado à identificação de ADRs da feature **Sistema de Webhooks de Notificação
> de Pedidos**. As decisões vêm da reunião técnica (`docs/adrs/context/TRANSCRICAO.md`) e são
> ancoradas no código existente (relatórios em `docs/agents/`).

## Stack
Node.js + TypeScript (strict), Express 4, Prisma 5 / MySQL 8. Monólito modular
(`routes → controller → service → repository`), composição em `src/app.ts`, entrypoint
`src/server.ts`.

## Módulos existentes (contexto)
| ID | Escopo | Papel para a feature |
| --- | --- | --- |
| ORDERS | `src/modules/orders` | Ponto de integração: `changeStatus` (transação), máquina de estados (6 status / 7 transições) |
| SHARED-ERRORS | `src/shared/errors` | Padrão `AppError` a estender com códigos `WEBHOOK_*` |
| SHARED-LOGGER | `src/shared/logger` | Logger Pino a reusar |
| MIDDLEWARES | `src/middlewares` | `requireRole('ADMIN')` a reusar no replay de DLQ |
| DATA | `prisma/schema.prisma` | Novas tabelas `webhook_config`, `webhook_outbox`, `webhook_dead_letter`, `webhook_delivery` |

## Módulo novo
| ID | Escopo | Descrição |
| --- | --- | --- |
| WEBHOOKS | `src/modules/webhooks` + `src/worker.ts` | CRUD de configuração, outbox, worker de entrega, retry/DLQ, HMAC. Segue o padrão dos demais módulos. |

## ADRs potenciais identificados (WEBHOOKS)
As 6 decisões fechadas na reunião, em `docs/adrs/potential-adrs/must-document/WEBHOOKS/`:
1. `outbox-no-mysql.md`
2. `worker-separado-polling.md`
3. `retry-backoff-dlq.md`
4. `hmac-sha256-secret-por-endpoint.md`
5. `at-least-once-x-event-id.md`
6. `reuso-padroes-do-projeto.md` (referencia código existente)
