# Tracker de Rastreabilidade

Referência cruzada de cada item registrado nos documentos (PRD, RFC, FDD, ADRs) à sua origem na
transcrição da reunião (`docs/adrs/context/TRANSCRICAO.md`) ou no código-fonte da aplicação.
Garante que nada foi inventado sem origem identificável.

**Legenda de Fonte:** `TRANSCRICAO` (timestamp + falante) · `CODIGO` (caminho de arquivo) ·
`HIPOTESE` (default explícito, sem origem na fonte).

## Contexto e visão geral

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| CTX-01 | docs/PRD.md | Restrição | Três clientes B2B pediram formalmente notificação de mudança de status | TRANSCRICAO | [09:00] Marcos |
| CTX-02 | docs/PRD.md | Requisito Não Funcional | "Tempo real" definido como abaixo de 10 segundos | TRANSCRICAO | [09:02] Marcos |
| CTX-03 | docs/RFC.md | Restrição | Escopo é outbound apenas (nós enviamos, cliente recebe) | TRANSCRICAO | [09:02] Marcos |
| CTX-04 | docs/PRD.md | Restrição | customer_id vem do body/rota, não do JWT do operador | TRANSCRICAO | [09:32] Larissa |
| CTX-05 | docs/RFC.md | Decisão | Worker roda como processo separado, não na instância da API | TRANSCRICAO | [09:11] Diego |
| CTX-06 | docs/FDD.md | Restrição | Mesmo banco/DATABASE_URL, PrismaClient próprio por processo | TRANSCRICAO | [09:30] Bruno |
| CTX-07 | docs/FDD.md | Decisão | Função pura publishWebhookEvent(tx, ...) recebe o tx client | TRANSCRICAO | [09:41] Diego |
| CTX-08 | docs/PRD.md | Restrição | Prazo de 3 sprints incluindo revisão de segurança | TRANSCRICAO | [09:46] Larissa |

## Decisões (ADRs)

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| ADR-001 | docs/adrs/ADR-001-outbox-no-mysql.md | Decisão | Padrão Outbox no MySQL, insert na transação do changeStatus | TRANSCRICAO | [09:06] Diego |
| ADR-002 | docs/adrs/ADR-002-worker-processo-separado-polling.md | Decisão | Worker em processo separado, polling de 2 segundos | TRANSCRICAO | [09:09] Diego |
| ADR-003 | docs/adrs/ADR-003-retry-backoff-exponencial-dlq.md | Decisão | Retry backoff 1m/5m/30m/2h/12h, 5 tentativas, depois DLQ | TRANSCRICAO | [09:17] Diego |
| ADR-004 | docs/adrs/ADR-004-hmac-sha256-secret-por-endpoint.md | Decisão | HMAC-SHA256, secret única por endpoint, rotação grace 24h | TRANSCRICAO | [09:20] Sofia |
| ADR-005 | docs/adrs/ADR-005-entrega-at-least-once-x-event-id.md | Decisão | Entrega at-least-once com X-Event-Id para dedup no cliente | TRANSCRICAO | [09:25] Diego |
| ADR-006 | docs/adrs/ADR-006-reuso-de-padroes-existentes.md | Decisão | Reuso máximo dos padrões existentes do projeto | TRANSCRICAO | [09:30] Larissa |
| ADR-001-COD | docs/adrs/ADR-001-outbox-no-mysql.md | Referência de código | changeStatus é o ponto de inserção da outbox na transação | CODIGO | src/modules/orders/order.service.ts |
| ADR-006-COD | docs/adrs/ADR-006-reuso-de-padroes-existentes.md | Referência de código | Reusa AppError, Pino, error middleware, requireRole | CODIGO | src/shared/errors/app-error.ts |

## PRD — Requisitos funcionais

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| PRD-FR-01 | docs/PRD.md | Requisito Funcional | Cadastrar webhook (POST), secret gerada e devolvida na criação | TRANSCRICAO | [09:31] Marcos |
| PRD-FR-02 | docs/PRD.md | Requisito Funcional | Editar webhook (PATCH) | TRANSCRICAO | [09:33] Bruno |
| PRD-FR-03 | docs/PRD.md | Requisito Funcional | Remover webhook (DELETE) | TRANSCRICAO | [09:33] Bruno |
| PRD-FR-04 | docs/PRD.md | Requisito Funcional | Listar webhooks de um customer (GET) | TRANSCRICAO | [09:33] Bruno |
| PRD-FR-05 | docs/PRD.md | Requisito Funcional | Emitir evento na outbox dentro da transação (publishWebhookEvent) | TRANSCRICAO | [09:41] Bruno |
| PRD-FR-06 | docs/PRD.md | Requisito Funcional | Entrega pelo worker com assinatura HMAC | TRANSCRICAO | [09:20] Sofia |
| PRD-FR-07 | docs/PRD.md | Requisito Funcional | Retry com backoff e movimentação para DLQ | TRANSCRICAO | [09:15] Diego |
| PRD-FR-08 | docs/PRD.md | Requisito Funcional | Replay manual da DLQ por admin (role ADMIN) | TRANSCRICAO | [09:35] Diego |
| PRD-FR-09 | docs/PRD.md | Requisito Funcional | Rotação de secret com grace period de 24h | TRANSCRICAO | [09:21] Sofia |
| PRD-FR-10 | docs/PRD.md | Requisito Funcional | Histórico de entregas (últimas ~100) | TRANSCRICAO | [09:34] Marcos |

## PRD — Objetivos e métricas

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| PRD-OBJ-01 | docs/PRD.md | Objetivo | Notificar em tempo quase real, meta < 10s | TRANSCRICAO | [09:02] Marcos |
| PRD-OBJ-02 | docs/PRD.md | Métrica | Pior caso ~2s dado polling de 2s | TRANSCRICAO | [09:10] Larissa |
| PRD-OBJ-03 | docs/PRD.md | Objetivo | Cobrir indisponibilidade ~12-24h com 5 tentativas | TRANSCRICAO | [09:16] Diego |
| PRD-OBJ-04 | docs/PRD.md | Objetivo | Entregar em 3 sprints | TRANSCRICAO | [09:46] Larissa |

## PRD — Requisitos não funcionais

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| PRD-NFR-01 | docs/PRD.md | Requisito Não Funcional | TLS obrigatório, URL do webhook precisa ser https | TRANSCRICAO | [09:23] Sofia |
| PRD-NFR-02 | docs/PRD.md | Requisito Não Funcional | Limite de payload de 64KB, erro se ultrapassar | TRANSCRICAO | [09:24] Diego |
| PRD-NFR-03 | docs/PRD.md | Requisito Não Funcional | Timeout de 10s por tentativa de entrega | TRANSCRICAO | [09:42] Diego |
| PRD-NFR-04 | docs/PRD.md | Requisito Não Funcional | Secret única por endpoint (não global) | TRANSCRICAO | [09:21] Sofia |
| PRD-NFR-05 | docs/PRD.md | Requisito Não Funcional | Auditoria: replay loga quem executou | TRANSCRICAO | [09:36] Sofia |
| PRD-NFR-06 | docs/PRD.md | Requisito Não Funcional | Disponibilidade 99.9% (default, não definido na reunião) | HIPOTESE | Default marcado como hipótese no PRD |

## PRD — Fora de escopo

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| PRD-OOS-01 | docs/PRD.md | Restrição | E-mail de aviso de falha ao cliente adiado (fase futura) | TRANSCRICAO | [09:37] Larissa |
| PRD-OOS-02 | docs/PRD.md | Restrição | Dashboard/painel visual fora de escopo | TRANSCRICAO | [09:40] Larissa |
| PRD-OOS-03 | docs/PRD.md | Restrição | Rate limiting de saída: observar e decidir depois | TRANSCRICAO | [09:39] Larissa |
| PRD-OOS-04 | docs/PRD.md | Restrição | Sem garantia de ordering global entre pedidos | TRANSCRICAO | [09:13] Larissa |
| PRD-OOS-05 | docs/PRD.md | Restrição | Arquivamento da outbox (~30 dias) fora de escopo | TRANSCRICAO | [09:08] Diego |
| PRD-OOS-06 | docs/PRD.md | Restrição | Endurecer roles do CRUD adiado | TRANSCRICAO | [09:37] Sofia |

## RFC — Alternativas consideradas

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| RFC-ALT-01 | docs/RFC.md | Trade-off | Disparo síncrono descartado (acopla latência à transação) | TRANSCRICAO | [09:04] Bruno |
| RFC-ALT-02 | docs/RFC.md | Trade-off | Redis Streams descartado (overengineering p/ time pequeno) | TRANSCRICAO | [09:07] Diego |
| RFC-ALT-03 | docs/RFC.md | Trade-off | Trigger de banco descartado (MySQL sem NOTIFY/LISTEN) | TRANSCRICAO | [09:09] Diego |
| RFC-ALT-04 | docs/RFC.md | Trade-off | Exactly-once descartado (coordenação complexa) | TRANSCRICAO | [09:25] Diego |
| RFC-ALT-05 | docs/RFC.md | Trade-off | 3 tentativas descartado a favor de 5 | TRANSCRICAO | [09:16] Bruno |

## RFC — Questões em aberto

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| RFC-Q-01 | docs/RFC.md | Questão em aberto | Rate limiting de saída (observar e decidir depois) | TRANSCRICAO | [09:39] Diego |
| RFC-Q-02 | docs/RFC.md | Questão em aberto | Estratégia de escala p/ múltiplos workers | TRANSCRICAO | [09:13] Diego |

## FDD — Contratos e detalhes técnicos

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| FDD-CONTRATO-01 | docs/FDD.md | Requisito Funcional | POST /webhooks com url, events, customer_id | TRANSCRICAO | [09:31] Marcos |
| FDD-CONTRATO-02 | docs/FDD.md | Requisito Funcional | GET /webhooks/:id/deliveries (histórico) | TRANSCRICAO | [09:34] Marcos |
| FDD-CONTRATO-03 | docs/FDD.md | Requisito Funcional | POST /admin/webhooks/dead-letter/:id/replay | TRANSCRICAO | [09:35] Diego |
| FDD-CONTRATO-04 | docs/FDD.md | Decisão | Filtro de eventos aplicado na inserção da outbox | TRANSCRICAO | [09:34] Bruno |
| FDD-PAYLOAD-01 | docs/FDD.md | Decisão | Formato do payload (event_id, from/to_status, total_cents, sem items) | TRANSCRICAO | [09:43] Diego |
| FDD-HEADERS-01 | docs/FDD.md | Decisão | Headers X-Event-Id, X-Signature, X-Timestamp, Content-Type | TRANSCRICAO | [09:44] Diego |
| FDD-HEADERS-02 | docs/FDD.md | Decisão | Header X-Webhook-Id | TRANSCRICAO | [09:44] Sofia |
| FDD-SNAP-01 | docs/FDD.md | Decisão | Snapshot do payload renderizado na inserção | TRANSCRICAO | [09:52] Larissa |
| FDD-UUID-01 | docs/FDD.md | Decisão | IDs em UUID, padrão do projeto | TRANSCRICAO | [09:51] Larissa |
| FDD-ERR-01 | docs/FDD.md | Decisão | Códigos de erro com prefixo WEBHOOK_ | TRANSCRICAO | [09:29] Bruno |

## FDD — Integração com o sistema existente (código)

| ID | Documento | Tipo | Conteúdo (resumo) | Fonte | Localização |
| --- | --- | --- | --- | --- | --- |
| FDD-INT-01 | docs/FDD.md | Referência de código | changeStatus estendido com publishWebhookEvent na transação | CODIGO | src/modules/orders/order.service.ts |
| FDD-INT-02 | docs/FDD.md | Referência de código | Máquina de estados (6 status, 8 transições) valida events e from/to | CODIGO | src/modules/orders/order.status.ts |
| FDD-INT-03 | docs/FDD.md | Referência de código | Família WEBHOOK_* como subclasses de AppError | CODIGO | src/shared/errors/app-error.ts |
| FDD-INT-04 | docs/FDD.md | Referência de código | Error middleware trata novos erros por instanceof, sem alteração | CODIGO | src/middlewares/error.middleware.ts |
| FDD-INT-05 | docs/FDD.md | Referência de código | requireRole('ADMIN') reusado no replay de DLQ | CODIGO | src/middlewares/auth.middleware.ts |
| FDD-INT-06 | docs/FDD.md | Referência de código | Logger Pino reutilizado pela API e pelo worker | CODIGO | src/shared/logger/index.ts |
| FDD-INT-07 | docs/FDD.md | Referência de código | src/server.ts serve de modelo para o novo src/worker.ts | CODIGO | src/server.ts |
| FDD-INT-08 | docs/FDD.md | Referência de código | Novos modelos (webhook_config/outbox/dead_letter/delivery) | CODIGO | prisma/schema.prisma |

---

## Resumo de cobertura

| Fonte | Linhas |
| --- | --- |
| TRANSCRICAO (com timestamp) | 56 |
| CODIGO (caminho de arquivo) | 10 |
| HIPOTESE | 1 |
| **Total** | **67** |

- Itens `TRANSCRICAO` com timestamp válido `[hh:mm] Nome`: 56 de 67 = ~84% (meta ≥ 70%).
- Itens `CODIGO` com caminho de arquivo real: 10 (meta ≥ 5).
- Todos os arquivos citados na coluna Localização (fonte `CODIGO`) existem no repositório.
  `src/worker.ts`, `src/modules/webhooks/*` e as tabelas `webhook_*` aparecem nos documentos
  como artefatos **a serem criados** pela feature, não como código existente.
