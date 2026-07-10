# ADR-002: Worker Dedicado em Processo Separado com Polling de 2 Segundos

**Status:** Aceito
**Data:** Desconhecida (data exata da reunião não especificada na transcrição/ata)
**Related ADRs:** [ADR-001](./ADR-001-outbox-no-mysql.md) — Padrão Outbox no MySQL para Eventos de Webhook (decisão que origina a necessidade deste worker de leitura da fila)

## Contexto e Declaração do Problema

Após a decisão de adotar o padrão Outbox no MySQL para registrar eventos de mudança de status
de pedidos (inserção na mesma transação do `changeStatus`), restava definir como o worker
consumidor processaria os eventos pendentes: (1) qual o mecanismo de leitura da fila e (2) onde
esse worker deveria ser executado. Essa necessidade decorre de um pedido formal de três
clientes B2B (Atlas Comercial, MaxDistribuição e Nova Cargo), que hoje precisam consultar
repetidamente o sistema para saber se o status de seus pedidos mudou.

MySQL não oferece um mecanismo de notificação nativo equivalente ao NOTIFY/LISTEN do
PostgreSQL. Um trigger de banco de dados só executa SQL e não é capaz de notificar um processo
externo; contornar essa limitação escrevendo em arquivo ou chamando um endpoint HTTP a partir
do trigger foi considerado uma solução inadequada. Os clientes B2B que motivaram a feature
(Atlas Comercial, MaxDistribuição, Nova Cargo) definiram como aceitável qualquer latência
abaixo de 10 segundos para considerar a notificação "tempo real". [09:09 Diego]

Também era necessário decidir onde o worker executaria. Rodar o worker na mesma
instância/processo da API traria acoplamento operacional indesejado: um reinício da API
(deploy, crash, autoscaling) derrubaria o worker junto, interrompendo o processamento da fila
de eventos pendentes. [09:11 Diego]

## Motivadores da Decisão

- Requisito não funcional de latência: notificações devem ser entregues em menos de 10
segundos, limite definido pelos clientes B2B como critério de "tempo real".
- MySQL não possui mecanismo de notificação nativo (sem equivalente a NOTIFY/LISTEN), o que
descarta soluções reativas via trigger de banco de dados.
- Necessidade de isolar o ciclo de vida do worker do ciclo de vida da API, para que reinícios
da API não interrompam o processamento de webhooks pendentes.
- Simplicidade operacional: equipe pequena, sem apetite para introduzir nova infraestrutura de
mensageria apenas para obter reatividade.
- Necessidade de ordenação previsível dos eventos por pedido, ainda que sem garantia de
ordenação global entre pedidos diferentes.
- Reaproveitar a mesma base de dados e configuração de conexão (`DATABASE_URL`) já usada pela
API, mantendo apenas uma instância de client Prisma separada por processo.

## Opções Consideradas

- Worker dedicado em processo separado, com polling a cada 2 segundos (escolhida)
- Trigger de banco de dados para reatividade orientada a eventos
- Worker executando dentro da mesma instância/processo da API

## Resultado da Decisão

Opção escolhida: worker dedicado, executando como processo separado (entry-point próprio,
iniciado via script dedicado), fazendo polling a cada 2 segundos pelos eventos pendentes mais
antigos (ordenados por `created_at`), processando-os e marcando-os como entregues. O worker usa
o mesmo banco de dados (mesma `DATABASE_URL`) mas mantém uma instância própria do client
Prisma, já que esse client é vinculado ao processo que o instancia. [09:09-09:11, 09:28-09:30]

O intervalo de polling de 2 segundos foi considerado suficiente porque garante uma latência de
pior caso de aproximadamente 2 segundos, dentro do requisito de menos de 10 segundos definido
pelos clientes B2B. A decisão foi registrada formalmente pela equipe como aceita, com a
ressalva explícita de que 2 segundos representa a latência assumida no pior caso. [09:10] Larissa

## Prós e Contras das Opções

**Worker dedicado, processo separado, polling 2s (escolhida)**

- Prós: latência de pior caso ~2s, dentro do SLA de <10s exigido pelos clientes. [09:10]
- Prós: isolamento de falhas entre API e processamento de webhooks — reinício da API não afeta
o worker. [09:11]
- Prós: usa apenas a infraestrutura MySQL já existente, sem novas dependências de infraestrutura.
- Contras: com um único worker, a ordenação de eventos só é garantida por pedido (via
`created_at`), sem garantia de ordenação global. [09:12-09:13]

**Trigger de banco de dados para reatividade**

- Prós: notificação potencialmente mais próxima do instante de inserção do evento na outbox.
- Contras: MySQL não notifica processos externos a partir de um trigger — ele só executa SQL.
[09:09]
- Contras: exigiria mecanismos improvisados (escrita em arquivo, chamada a endpoint)
considerados inadequados pela equipe. [09:09 Diego]
- Contras: descartada pela equipe. [09:09]

**Worker na mesma instância/processo da API**

- Prós: simplicidade de deployment — um único processo/instância a gerenciar.
- Contras: reinício da API mataria o worker junto, interrompendo o processamento de eventos
pendentes. [09:11]
- Contras: acopla o ciclo de vida operacional de dois componentes com responsabilidades distintas.
- Contras: descartada pela equipe. [09:11]

## Consequências

Positivamente, o isolamento entre API e worker reduz o risco de falhas em cascata e mantém a
latência de entrega dentro do limite aceito pelos clientes B2B. A reutilização do mesmo banco
de dados, com uma instância de Prisma própria por processo, evita a necessidade de nova
infraestrutura de mensageria. [09:09-09:11, 09:28-09:30]

Como limitação conhecida, a ordenação de eventos entregue aos clientes é garantida apenas por
pedido (via `created_at`) enquanto houver um único worker; não há garantia de ordenação global
entre pedidos diferentes. Caso a equipe decida escalar para múltiplos workers no futuro, será
necessário particionar o processamento por pedido ou introduzir lock pessimista para preservar
essa garantia — hoje tratado explicitamente como problema a ser resolvido futuramente, fora do
escopo desta decisão. [09:12-09:13] Diego

**Pontos em aberto (não discutidos na reunião):** (1) o mecanismo de orquestração/restart que
manterá o processo do worker em execução em produção (ex.: supervisor de processo, orquestrador
de containers); (2) o volume ou limiar de eventos que indicará quando a migração para múltiplos
workers — e o particionamento por pedido ou lock pessimista associado — se tornará necessária.

## Referências

- `src/server.ts` — padrão de entry-point existente na aplicação, espelhado para criar o
entry-point do worker.
- `src/worker.ts` — novo entry-point dedicado ao processo do worker.
- `src/modules/webhooks/webhook.worker.ts` (alternativa: `webhook.processor.ts`) — lógica de
processamento do worker.
- `src/config` — provedor do client Prisma; o worker abre instância própria usando a mesma
`DATABASE_URL`.
