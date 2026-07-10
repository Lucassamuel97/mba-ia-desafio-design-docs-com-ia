# Base factual — extração da TRANSCRICAO.md (anti-alucinação)

## Participantes (revisores do RFC)
- Larissa — Tech Lead (conduz)
- Marcos — Product Manager
- Bruno — Engenheiro Pleno (time de Pedidos)
- Diego — Engenheiro Sênior (time de Plataforma)
- Sofia — Engenheira de Segurança

Clientes B2B que pediram: Atlas Comercial, MaxDistribuição, Nova Cargo [09:00 Marcos]
Prazo: 3 sprints, Atlas quer fim de novembro [09:45-09:47]

## As 6 decisões principais (para ADRs)
| # | Decisão | Origem |
|---|---|---|
| D1 | Padrão Outbox no MySQL, insert na mesma transação do changeStatus | [09:06 Diego], decidido [09:08 Larissa] |
| D2 | Worker em processo separado, polling 2s | [09:09-09:11 Diego/Larissa] |
| D3 | Retry backoff exponencial 1m/5m/30m/2h/12h, 5 tentativas, depois DLQ em tabela separada | [09:15-09:18] |
| D4 | HMAC-SHA256 sobre payload, secret única por endpoint, rotação com grace period 24h | [09:20-09:22 Sofia] |
| D5 | At-least-once com X-Event-Id (UUID) para dedup no cliente | [09:24-09:26 Diego] |
| D6 | Reuso máximo dos padrões: AppError, Pino, error middleware, módulos, Zod, códigos WEBHOOK_ | [09:28-09:30] |

## Requisitos funcionais (≥8 exigidos)
- RF1 Cadastrar webhook (POST): url, lista de status desejados, secret gerada/devolvida na criação; customer_id no body/path (NÃO do JWT) [09:31-09:33]
- RF2 Editar webhook (PATCH) [09:33]
- RF3 Remover webhook (DELETE) [09:33]
- RF4 Listar webhooks de um customer (GET) [09:33]
- RF5 Filtro de eventos por endpoint (lista de status), aplicado na INSERÇÃO da outbox [09:33-09:34]
- RF6 Histórico de entregas GET /webhooks/:id/deliveries (últimos 100: sucesso/falha, payload, response, tempo) [09:34]
- RF7 Replay manual de DLQ POST /admin/webhooks/dead-letter/:id/replay, role ADMIN, loga quem fez [09:35-09:36]
- RF8 Rotação de secret: cliente pede nova secret via API, antiga válida 24h [09:21-09:22]
- RF9 Assinatura HMAC no envio (header X-Signature) [09:20]
- RF10 publishWebhookEvent(tx, order, fromStatus, toStatus) chamado dentro da transação do changeStatus [09:40-09:41]

## Requisitos não funcionais
- RNF1 Latência < 10s ("tempo real"); polling 2s atende (pior caso ~2s) [09:02, 09:09-09:10]
- RNF2 TLS obrigatório: URL https, recusa http via schema Zod [09:23]
- RNF3 Limite de payload 64KB, erro se ultrapassar [09:23-09:24]
- RNF4 Timeout HTTP do worker: 10s [09:42]
- RNF5 Ordering só por order_id enquanto single-worker; sem garantia global [09:12-09:13]
- RNF6 Secret única por endpoint (não global) [09:21]
- RNF7 Auditoria: replay loga quem executou [09:36]
- Headers de envio: X-Event-Id, X-Signature, X-Timestamp, X-Webhook-Id, Content-Type: application/json [09:44]
- Payload: JSON com event_id, event_type "order.status_changed", timestamp ISO 8601, order_id, order_number, from_status, to_status, customer_id, total_cents. NÃO envia items [09:43]

## Integração com código existente (para FDD)
- changeStatus (order.service) estendido: insert na webhook_outbox na MESMA transação; se falhar, rollback [09:40-09:41]
- Função pura publishWebhookEvent(tx, ...) recebe o tx client; não injeta repository inteiro [09:41-09:42]
- Módulo src/modules/webhooks com controller/service/repository/routes/schemas [09:27]
- Entry separada src/worker.ts + "npm run worker"; lógica em webhook.worker.ts/webhook.processor.ts [09:11, 09:28]
- PrismaClient separado (por processo), mesma DATABASE_URL [09:29-09:30]
- Reuso do requireRole para ADMIN no replay [09:36]
- IDs em UUID (padrão do projeto) [09:51]
- Snapshot do payload renderizado na inserção (não re-renderiza no envio) [09:52]

## Descartados / Fora de escopo (para PRD "fora de escopo" e RFC "alternativas")
- Disparo SÍNCRONO no order.service — descartado (trava mudança de status) [09:04, 09:06]
- Redis Streams / Redis Cluster — descartado (overengineering p/ time pequeno) [09:07]
- Trigger de banco para reatividade — descartado (MySQL sem NOTIFY/LISTEN) [09:09]
- Retry com 3 tentativas — descartado a favor de 5 [09:16]
- Retry indefinido — descartado (evento pendurado pra sempre) [09:15-09:16]
- Exactly-once — descartado a favor de at-least-once [09:25]
- Email de aviso ao cliente em falha — FUTURO (próxima fase) [09:37-09:38]
- Dashboard/painel visual — fora de escopo (time de frontend) [09:40]
- Ordering global / múltiplos workers — futuro [09:13]
- Endurecer roles do CRUD — futuro [09:37]
- Arquivamento de linhas entregues após 30d — fora do escopo desta feature [09:08]

## Questões em aberto (para RFC "questões em aberto")
- Rate limiting de saída (50 mudanças/min bombardeiam cliente) — "observar e decidir depois" [09:38-09:39]
- Estratégia de escala p/ múltiplos workers (particionar por order_id ou lock pessimista) [09:13]

## Decisões técnicas secundárias (FDD ou ADRs extras)
- Payload snapshot renderizado na inserção [09:52]
- Formato/headers do payload [09:43-09:44]
- Timeout 10s, limite 64KB, TLS [09:23-09:24, 09:42]
- Filtro de status na inserção da outbox [09:34]
