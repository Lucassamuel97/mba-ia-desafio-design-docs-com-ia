# Architectural Decision Records (ADRs)

ADRs da feature **Sistema de Webhooks de Notificação de Pedidos**. Cada ADR segue o formato
MADR (Status, Contexto, Fatores, Opções Consideradas, Decisão, Prós/Contras, Consequências) e
é rastreável à reunião técnica (`context/TRANSCRICAO.md`) e ao código existente.

## Índice

| ADR | Decisão | Referencia código |
| --- | --- | --- |
| [ADR-001](./ADR-001-outbox-no-mysql.md) | Padrão Outbox no MySQL (insert na transação do `changeStatus`) | ✅ |
| [ADR-002](./ADR-002-worker-processo-separado-polling.md) | Worker em processo separado, polling de 2s | ✅ |
| [ADR-003](./ADR-003-retry-backoff-exponencial-dlq.md) | Retry backoff exponencial (5x) + DLQ em tabela separada | ✅ |
| [ADR-004](./ADR-004-hmac-sha256-secret-por-endpoint.md) | HMAC-SHA256, secret por endpoint, rotação com grace 24h | ✅ |
| [ADR-005](./ADR-005-entrega-at-least-once-x-event-id.md) | Entrega at-least-once com `X-Event-Id` (dedup no cliente) | ✅ |
| [ADR-006](./ADR-006-reuso-de-padroes-existentes.md) | Reuso dos padrões do projeto (AppError, Pino, módulos, `requireRole`) | ✅ |

Os 6 ADRs cobrem as 6 decisões principais da reunião.

## Processo de geração

Os ADRs foram gerados com o plugin **adrs-management** (`/adr-generate`), a partir de arquivos
de *potential ADRs* (em `potential-adrs/done/WEBHOOKS/`) previamente ancorados na transcrição e
no código. O mapeamento de módulos está em [`mapping.md`](./mapping.md). Os relatórios de
análise de código que embasaram as referências estão em [`../agents/`](../agents/).
