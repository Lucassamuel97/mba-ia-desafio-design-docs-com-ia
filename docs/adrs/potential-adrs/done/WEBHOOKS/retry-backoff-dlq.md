# Potential ADR — Retry com backoff exponencial e DLQ em tabela separada

**Módulo:** WEBHOOKS
**Prioridade:** must-document
**Decisão fechada na reunião:** sim

## Contexto
Clientes ficam offline. Foi preciso definir a política de reentrega e o destino de eventos
que esgotam as tentativas.

Sobre número de tentativas: 3 foi considerado agressivo demais — um cliente com
indisponibilidade matinal seria "morto" em ~30 minutos, e já houve cliente com 2h de
manutenção planejada. Retry indefinido também foi descartado: deixa evento pendurado para
sempre se o cliente sumiu. [09:15-09:16 Diego/Bruno]

## Decisão
**Backoff exponencial com 5 tentativas**, progressão **1m / 5m / 30m / 2h / 12h** (quase 15h
entre a primeira falha e a última tentativa). Esgotadas as 5 tentativas, o evento é movido
para uma **Dead Letter Queue em tabela separada** (`webhook_dead_letter`) com payload, motivo
da falha e timestamp. Reprocessamento manual via endpoint admin
`POST /admin/webhooks/dead-letter/:id/replay`, que recoloca o evento como pendente na outbox. [09:15-09:18]

## Alternativas consideradas
- **3 tentativas** — descartado: mata cedo demais clientes com indisponibilidade de horas. [09:16]
- **Retry indefinido com backoff** — descartado: evento fica pendurado para sempre. [09:15-09:16]
- **Marcar "failed" na própria outbox** (sem tabela separada) — descartado: DLQ em tabela
  separada mantém a outbox principal limpa e serve de evidência para debug/reprocessamento. [09:18]

## Consequências
- Positiva: cobre janelas de indisponibilidade de até ~12-24h sem intervenção. [09:16]
- Positiva: DLQ separada facilita auditoria e replay.
- Negativa: replay é manual e restrito a ADMIN (ver ADR de autorização/reuso).
- Negativa: timeout de 10s por tentativa; cliente lento é tratado como falha e vai para retry. [09:42]

## Fontes / rastreabilidade
- TRANSCRICAO: [09:15] Diego, [09:16] Bruno/Diego, [09:17] Diego/Marcos, [09:18] Diego/Bruno, [09:42] Diego
- CODIGO: `prisma/schema.prisma` (tabelas `webhook_outbox` e `webhook_dead_letter`)
- CODIGO: `src/middlewares/auth.middleware.ts` (`requireRole('ADMIN')` no endpoint de replay)
