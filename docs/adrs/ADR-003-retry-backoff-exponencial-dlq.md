# ADR-003: Retry com Backoff Exponencial e Dead Letter Queue em Tabela Separada

**Status:** Aceita
**Data:** Não especificada na fonte (reunião registrada apenas como "quinta-feira", sem data de calendário)
**Related ADRs:** [ADR-001](./ADR-001-outbox-no-mysql.md) (outbox de onde os eventos são lidos), [ADR-005](./ADR-005-entrega-at-least-once-x-event-id.md) (retry origina as duplicatas deduplicadas por event_id), [ADR-006](./ADR-006-reuso-de-padroes-existentes.md) (replay de DLQ reusa `requireRole('ADMIN')`)

## Contexto e Problema

Clientes B2B (Atlas Comercial, MaxDistribuição, Nova Cargo) passam a receber notificações de mudança de status de pedido via webhook outbound, disparado por um worker separado que lê eventos pendentes de uma tabela de outbox por polling. Como esses clientes podem ficar temporariamente indisponíveis — desde uma indisponibilidade matinal até uma manutenção planejada de até 2 horas, já observada em produção — foi preciso definir uma política de reentrega para as chamadas HTTP desse worker e um destino para os eventos que esgotam as tentativas de envio. [09:15-09:16 Diego/Bruno]

A equipe descartou dois extremos logo no início da discussão: um número de tentativas muito baixo "mata" clientes com indisponibilidade de algumas horas, enquanto retry indefinido deixa eventos pendurados para sempre caso o cliente tenha saído de operação definitivamente. Também foi discutido se a falha permanente deveria simplesmente ser marcada na própria tabela de outbox ou se merecia um destino próprio. [09:15-09:18 Diego/Bruno]

Esses clientes fizeram um pedido formal de notificação em tempo real (abaixo de 10 segundos) e um deles sinalizou risco de migrar para um concorrente caso a entrega não seja confiável, o que reforça a importância de uma política de reentrega que cubra janelas de indisponibilidade sem perder eventos. [09:00-09:02 Marcos]

## Fatores da Decisão

- Clientes têm janelas de indisponibilidade que variam de minutos a algumas horas (manutenção planejada já observada com 2h de duração). [09:16 Diego]
- Um evento não pode ficar pendurado indefinidamente caso o cliente tenha saído de operação. [09:15-09:16 Diego]
- É necessário manter evidência auditável (payload, motivo da falha, timestamp) para depuração e reprocessamento de falhas permanentes. [09:18 Diego]
- A fila principal de entrega (outbox) deve permanecer limpa, sem registros de falhas definitivas misturados aos eventos pendentes. [09:18 Diego]
- Reprocessamento de falhas permanentes deve ser uma ação controlada e não automática. [09:18 Diego/Bruno]
- A entrega é garantida como at-least-once, com deduplicação do lado do cliente pelo identificador único do evento; portanto uma tentativa reenviada por retry não compromete a consistência do cliente. [09:24-09:26 Diego]

## Opções Consideradas

1. **Backoff exponencial com 5 tentativas (1m / 5m / 30m / 2h / 12h) e Dead Letter Queue em tabela separada** (escolhida)
2. **Número de tentativas nos extremos: 3 tentativas fixas (mais agressivo) ou retry indefinido (sem limite)**
3. **Marcar falha permanente como "failed" na própria tabela de outbox, sem tabela de DLQ separada**

## Decisão

Escolhida a opção 1: **backoff exponencial com 5 tentativas**, na progressão **1m / 5m / 30m / 2h / 12h** (quase 15h entre a primeira falha e a última tentativa). Esgotadas as 5 tentativas, o evento é movido para uma **Dead Letter Queue em tabela separada** (`webhook_dead_letter`), armazenando payload, motivo da falha e timestamp. O reprocessamento é manual, via endpoint administrativo `POST /admin/webhooks/dead-letter/:id/replay`, que recoloca o evento como pendente na outbox. [09:15-09:18]

Cinco tentativas com essa progressão foram consideradas suficientes para cobrir janelas de indisponibilidade de até 12-24h sem intervenção manual, sem deixar o evento pendurado indefinidamente. A progressão foi validada em conjunto pela equipe como um equilíbrio aceitável: nem tão curta a ponto de descartar clientes com manutenções planejadas de horas, nem tão longa a ponto de gerar acúmulo indefinido de eventos não entregues. [09:16-09:17 Diego/Marcos/Bruno]

## Prós e Contras das Opções

### Backoff exponencial com 5 tentativas e DLQ em tabela separada (escolhida)

- Prós: cobre janelas de indisponibilidade de até ~12-24h sem intervenção manual. [09:16]
- Prós: tabela de DLQ separada mantém a outbox principal limpa e serve como evidência para debug e reprocessamento. [09:18]
- Contras: reprocessamento é manual e restrito a papel ADMIN. [09:18, ver seção de Consequências]
- Contras: timeout de 10s por tentativa faz com que um cliente lento seja tratado como falha e entre no ciclo de retry. [09:42]

### Número fixo de tentativas nos extremos (3 tentativas ou retry indefinido)

- Prós (3 tentativas): ciclo de retry mais curto, libera recursos mais rápido. [09:16]
- Prós (indefinido): nenhum evento é descartado enquanto o cliente não confirmar recebimento. [09:15]
- Contras (3 tentativas): mata cedo demais clientes com indisponibilidade de horas — todas as tentativas se esgotariam em ~30 minutos. [09:16]
- Contras (indefinido): evento fica pendurado para sempre se o cliente tiver saído de operação definitivamente. [09:15-09:16]

### Marcar "failed" na própria outbox (sem tabela separada)

- Prós: menor complexidade de modelagem, sem tabela adicional. [09:18, inferido do contraste com a opção escolhida]
- Contras: mistura eventos falhados definitivamente com eventos pendentes na mesma tabela, dificultando a leitura da outbox principal. [09:18 Diego]
- Contras: perde a função de evidência dedicada para debug e reprocessamento que uma tabela separada oferece. [09:18 Diego]

## Consequências

A política escolhida cobre a grande maioria dos cenários reais de indisponibilidade de clientes observados até o momento (incluindo manutenções planejadas de até 2h) sem exigir intervenção manual, e a Dead Letter Queue em tabela separada garante que falhas permanentes não se percam e fiquem disponíveis para auditoria e reprocessamento. Como o worker de entrega opera em polling único (a cada 2 segundos), os eventos em retry competem pelo mesmo ciclo de processamento que os eventos novos, ainda que cada evento só seja reconsiderado após o intervalo de backoff correspondente. [09:16, 09:18, 09:09-09:11]

Por outro lado, o reprocessamento de eventos na DLQ é manual e restrito a usuários com papel ADMIN (ver [ADR-006](./ADR-006-reuso-de-padroes-existentes.md), que trata do reuso de `requireRole('ADMIN')` para o endpoint de replay). Além disso, o timeout de 10 segundos por tentativa de entrega significa que qualquer cliente lento (ainda que operacional) é tratado como falha e reentra no ciclo de retry, consumindo uma das 5 tentativas disponíveis. [09:42]

Dois pontos não foram discutidos na reunião e ficam **em aberto**: (1) o critério exato de falha — quais códigos de resposta HTTP contam como falha vs. sucesso — que dispara o retry; e (2) a política de retenção/expurgo dos registros na tabela `webhook_dead_letter` ao longo do tempo.

## Referências

- `prisma/schema.prisma` (tabelas `webhook_outbox` e `webhook_dead_letter`)
- `src/middlewares/auth.middleware.ts` (`requireRole('ADMIN')` no endpoint de replay)
