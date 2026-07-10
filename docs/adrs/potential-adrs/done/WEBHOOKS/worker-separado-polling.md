# Potential ADR — Worker em processo separado com polling de 2 segundos

**Módulo:** WEBHOOKS
**Prioridade:** must-document
**Decisão fechada na reunião:** sim

## Contexto
Definida a outbox, restou como processá-la. Duas questões: (1) como o worker lê os eventos
pendentes e (2) onde ele roda.

Sobre a leitura: MySQL não tem listener nativo tipo NOTIFY/LISTEN do Postgres. Trigger de
banco só executa SQL, não notifica processo externo. Improvisar (escrever arquivo, bater em
endpoint) fica esquisito. Polling simples atende o requisito de "abaixo de 10 segundos". [09:09 Diego]

Sobre onde roda: o worker tem que ser um processo separado, não a mesma instância da API.
Se a API reinicia, não pode levar o worker junto. [09:11 Diego]

## Decisão
Worker dedicado em **polling a cada 2 segundos**, buscando os eventos pendentes mais antigos
(ordem por `created_at`), processando e marcando como entregue. Roda como **processo separado**,
entry-point `src/worker.ts` + script `npm run worker`, com a lógica em
`src/modules/webhooks/webhook.worker.ts` (ou `webhook.processor.ts`). Usa o mesmo banco/DATABASE_URL,
mas um `PrismaClient` próprio (PrismaClient é por processo). [09:09-09:11, 09:28-09:30]

## Alternativas consideradas
- **Trigger de banco para reatividade** — descartado: MySQL não notifica processo externo. [09:09]
- **Worker dentro da instância da API** — descartado: reinício da API mataria o worker. [09:11]

## Consequências
- Positiva: latência de pior caso ~2s, dentro do SLA de <10s dos clientes. [09:10]
- Positiva: isolamento de falhas entre API e processamento de webhooks.
- Negativa/limitação: com single-worker, ordenação é garantida só por `order_id` (por `created_at`);
  não há ordering global. Escalar para múltiplos workers exigiria particionar por `order_id` ou
  lock pessimista — problema do futuro. [09:12-09:13]

## Fontes / rastreabilidade
- TRANSCRICAO: [09:09] Diego, [09:10] Larissa, [09:11] Diego/Larissa/Bruno, [09:12-09:13] Diego, [09:28-09:30] Bruno/Diego
- CODIGO: `src/server.ts` (padrão de entry-point existente a ser espelhado em `src/worker.ts`)
- CODIGO: `src/config` (Prisma client provider; worker abre instância própria com a mesma DATABASE_URL)
