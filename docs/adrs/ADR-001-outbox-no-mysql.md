# ADR-001: Padrão Outbox no MySQL para Eventos de Webhook

**Status:** Aceita
**Data:** Desconhecida (decisão fechada em reunião técnica; nenhuma data de calendário foi registrada na transcrição, apenas "quinta-feira, 09:00")
**Related ADRs:** [ADR-002](./ADR-002-worker-processo-separado-polling.md) (worker que consome a outbox), [ADR-003](./ADR-003-retry-backoff-exponencial-dlq.md) (retry/DLQ sobre eventos da outbox), [ADR-005](./ADR-005-entrega-at-least-once-x-event-id.md) (event_id gerado na inserção)

## Contexto e Problema

A feature de webhooks precisa notificar clientes B2B quando o status de um pedido muda. A dúvida inicial era disparar a chamada HTTP de forma síncrona dentro do `changeStatus` ou registrar o evento e processá-lo fora da transação. O disparo síncrono foi descartado porque a transação de mudança de status já é pesada — atualiza o pedido e registros relacionados de histórico e estoque em múltiplas tabelas. Uma chamada HTTP no meio acoplaria a latência de um cliente externo ao tempo de lock do banco, e um cliente offline forçaria a pergunta impossível de "dar rollback na mudança de status". [09:04 Bruno]

Decidiu-se pelo padrão **Outbox**: na mesma transação SQL que muda o status, insere-se uma linha em `webhook_outbox`. Se a transação commita, o evento está garantido; se dá rollback, o evento some junto — sem inconsistência possível. [09:06 Diego] Um fator adicional discutido foi que o MySQL não possui um mecanismo nativo de notificação equivalente ao NOTIFY/LISTEN do Postgres — um trigger de banco até existe, mas só executa SQL, não notifica um processo externo — o que reforça a necessidade de um processo de polling separado para ler a outbox, tema tratado em ADR própria sobre o worker.

O gatilho de negócio para esta decisão foi um pedido formal de três clientes B2B (Atlas Comercial, MaxDistribuição, Nova Cargo) para serem notificados em tempo real (abaixo de 10 segundos) quando o status de um pedido muda, em vez de fazer polling manual em `GET /orders`. Essa exigência de latência baixa, somada à necessidade de garantir que nenhum evento se perca, foi o que colocou o padrão Outbox — em vez do disparo síncrono — como candidato natural desde o início da discussão.

## Fatores da Decisão

- Necessidade de atomicidade total entre a mudança de status do pedido e o registro do evento de notificação, sem possibilidade de inconsistência entre os dois estados. [09:06 Diego]
- Exigência de não acoplar a latência e a disponibilidade de um endpoint de cliente externo ao tempo de resposta e ao lock da transação de `changeStatus`. [09:04 Bruno]
- Restrição de equipe pequena, evitando subir infraestrutura nova (ex.: Redis Cluster) quando o MySQL já existente pode resolver o problema. [09:07 Diego]
- Ausência de mecanismo nativo de notificação no MySQL (sem NOTIFY/LISTEN), o que direciona a leitura da outbox para um processo de polling.
- Requisito não funcional de latência abaixo de 10 segundos para o cliente perceber a mudança como "tempo real".

## Opções Consideradas

1. **Outbox persistido no MySQL já existente** (escolhida)
2. **Disparo síncrono no `order.service`** — descartada [09:04, 09:06]
3. **Redis Streams / fila externa** — descartada [09:07 Diego]

## Decisão

Opção escolhida: **Outbox persistido no MySQL**, porque garante atomicidade total entre a mudança de status e o registro do evento dentro da mesma transação, sem exigir infraestrutura adicional além do banco já existente. O evento é inserido na tabela de outbox reaproveitando o mesmo cliente transacional já em uso na mudança de status do pedido, garantindo que ambas as operações commitem ou sofrem rollback juntas. [09:41 Bruno/Diego]

## Prós e Contras das Opções

### Outbox no MySQL (escolhida)

- Atomicidade total entre mudança de status e registro do evento; zero infraestrutura nova. [09:06 Diego]
- Tabela indexada por status e data de criação; worker lê pendentes em lote pequeno. [09:08]
- Exige um worker de polling separado para processar a outbox, tratado em ADR própria sobre o worker.
- Acúmulo de linhas exige arquivamento futuro (linhas entregues após ~30 dias), fora do escopo desta decisão. [09:08]

### Disparo síncrono no `order.service` (descartada)

- Simplicidade de implementação, sem necessidade de worker separado ou tabela adicional.
- Acopla a latência e a disponibilidade do endpoint do cliente externo ao tempo de lock da transação de `changeStatus`. [09:04 Bruno]
- Não permite rollback seguro da mudança de status quando a chamada HTTP falha ou o cliente está offline. [09:04, 09:06]

### Redis Streams / fila externa (descartada)

- Desacoplaria totalmente o processamento de eventos do banco transacional, com infraestrutura dedicada a mensageria.
- Exigiria subir mais infraestrutura (Redis Cluster), considerada overengineering para o tamanho atual do time. [09:07 Diego]
- Outbox no MySQL já existente resolve o mesmo problema sem custo de operação adicional. [09:07 Diego]

## Consequências

A adoção do Outbox garante consistência forte entre o estado do pedido e o evento de notificação, eliminando a classe de bugs em que o status muda mas o cliente não é avisado (ou vice-versa). Em contrapartida, a solução desloca a complexidade operacional para um processo de leitura assíncrono (worker), que passa a ser uma peça de infraestrutura própria a ser monitorada, com decisões de intervalo de polling, retry e ordenação tratadas em ADRs separadas sobre o worker e sobre o mecanismo de retry/DLQ.

A tabela `webhook_outbox` tende a crescer continuamente enquanto eventos entregues não forem arquivados. A necessidade de arquivamento (janela de ~30 dias) foi identificada na reunião, mas ficou explicitamente fora do escopo desta decisão. [09:08]

Esta decisão estabelece a base transacional sobre a qual dependem outras decisões do módulo de webhooks: o mecanismo de leitura da outbox por um worker em processo separado, a política de retry e Dead Letter Queue para eventos não entregues, e a geração do identificador único do evento (`event_id`) no momento da inserção na outbox, usado posteriormente para deduplicação no lado do cliente. Essas decisões são tratadas em ADRs próprias do módulo WEBHOOKS.

**Ponto em aberto:** responsável e prazo para a política de arquivamento da tabela `webhook_outbox` ainda não foram definidos (não discutido na reunião).

## Referências

- `src/modules/orders/order.service.ts` (método `changeStatus`, linhas 126-179; hook de insert entre a linha 167 e 169, com `tx`/`order`/`from`/`to` em escopo)
- `prisma/schema.prisma` (nova tabela `webhook_outbox`, IDs em UUID conforme padrão do projeto [09:51])
- TRANSCRICAO: [09:04] Bruno, [09:06] Diego, [09:07] Diego, [09:08] Diego, [09:41] Bruno/Diego
- `docs/adrs/context/base-factual.md:16` (D1 — Padrão Outbox no MySQL, insert na mesma transação do `changeStatus`)
