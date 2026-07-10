# ADR-005: Entrega At-Least-Once com X-Event-Id para Deduplicação no Cliente

**Status:** Aceito
**Data:** Não especificada na fonte (transcrição registra apenas "quinta-feira, 09:00"; decisão na janela [09:24-09:26] da reunião)
**Related ADRs:** [ADR-003](./ADR-003-retry-backoff-exponencial-dlq.md) (Retry com Backoff Exponencial e Dead Letter Queue em Tabela Separada — mecanismo de reentrega que origina as duplicatas tratadas aqui), [ADR-004](./ADR-004-hmac-sha256-secret-por-endpoint.md) (Autenticação de Webhooks com HMAC-SHA256 e Secret Única por Endpoint — decisão irmã sobre o mesmo contrato de headers de entrega)

## Contexto e Problema

O sistema de webhooks de notificação de pedidos usa retry com backoff para lidar com clientes indisponíveis ou lentos. Esse mecanismo cria a possibilidade de o mesmo evento ser entregue mais de uma vez — por exemplo, quando o cliente recebe e responde lentamente, o worker considera a tentativa como falha e reenvia o evento. Era necessário definir qual garantia de entrega o sistema ofereceria e como o cliente conseguiria diferenciar uma entrega duplicada de um evento novo. [09:24-09:25]

A alternativa de garantir exactly-once foi discutida e descartada por exigir coordenação entre os dois lados (backend e cliente), o que aumentaria significativamente a complexidade da integração para um ganho marginal, já que at-least-once com identificador de evento resolve a maior parte dos casos práticos. [09:25 Diego]

A decisão também levou em conta que transferir a responsabilidade de deduplicação para o cliente exige comunicação clara, o que gerou um compromisso de documentação destacada no portal do desenvolvedor. [09:25-09:26 Sofia/Marcos]

## Fatores da Decisão

- Necessidade de garantir que o cliente consiga identificar entregas duplicadas geradas pelo mecanismo de retry.
- Custo de coordenação distribuída exigido por uma garantia exactly-once entre backend e cliente. [09:25 Diego]
- Adoção de um padrão já validado no mercado por provedores de webhook como Stripe e GitHub. [09:25 Diego]
- Preferência por simplicidade operacional, evitando estado de coordenação compartilhado entre os dois lados.
- Necessidade de comunicação explícita ao cliente sobre a responsabilidade de deduplicar eventos pelo lado dele. [09:25-09:26 Sofia/Marcos]
- Existência de um identificador único (UUID) gerado no momento da inserção do evento na outbox, disponível para uso como chave de deduplicação. [09:25 Diego]

## Opções Consideradas

1. At-least-once com identificador de evento (`X-Event-Id`) para deduplicação no cliente
2. Exactly-once com coordenação entre backend e cliente

## Decisão

Opção escolhida: **at-least-once com `X-Event-Id`**, porque resolve 99% dos casos práticos com muito menos complexidade do que exactly-once, que exigiria coordenação entre os dois lados. [09:25 Diego]

Cada evento recebe um `event_id` (UUID) gerado no momento em que entra na outbox, enviado ao cliente no header `X-Event-Id`. A deduplicação de eventos repetidos passa a ser responsabilidade do cliente, que deve usar esse identificador estável para reconhecer reentregas. [09:25 Diego]

O time reconheceu explicitamente que essa escolha transfere trabalho para o lado do cliente, mas considerou esse custo aceitável frente à simplicidade obtida, dado que provedores de referência do mercado adotam a mesma estratégia. [09:25 Diego]

## Prós e Contras das Opções

### At-least-once com `X-Event-Id` (escolhida)

Prós:
- Simplicidade operacional, sem necessidade de coordenação distribuída entre backend e cliente.
- `event_id` estável por evento permite ao cliente implementar deduplicação confiável do próprio lado.
- Segue padrão de mercado já adotado por provedores como Stripe e GitHub. [09:25 Diego]

Contras:
- Transfere a responsabilidade de deduplicação para o cliente, exigindo documentação clara. [09:25 Sofia]
- Depende de cada cliente implementar corretamente a lógica de deduplicação do lado dele.

### Exactly-once (descartada)

Prós:
- Eliminaria a necessidade de o cliente implementar lógica própria de deduplicação.

Contras:
- Exigiria coordenação distribuída entre backend e cliente, aumentando muito a complexidade da integração. [09:25 Diego]
- Descartada por não se justificar frente ao ganho marginal sobre at-least-once, que já cobre a maior parte dos casos. [09:25 Diego]

## Consequências

A garantia at-least-once elimina a necessidade de qualquer coordenação distribuída entre backend e cliente para controle de entrega, e o `event_id` gerado na inserção na outbox permanece estável para o mesmo evento mesmo em caso de reentrega, permitindo deduplicação confiável do lado do cliente.

Em contrapartida, a responsabilidade de deduplicar eventos passa a ser do cliente. Essa transferência de responsabilidade foi sinalizada como ponto de atenção pela engenharia de segurança e tratada com o compromisso de documentação destacada no portal do desenvolvedor, a cargo do produto. [09:25-09:26 Sofia/Marcos]

O `X-Event-Id` também compõe o conjunto de headers enviados em cada entrega, junto com `X-Signature`, `X-Timestamp` e `X-Webhook-Id`, formando o contrato de integração exposto aos clientes B2B. [09:44] Como o `event_id` é gerado no momento da inserção do evento na outbox, a consistência da garantia at-least-once depende diretamente da atomicidade dessa inserção em relação à mudança de status do pedido.

## Referências

- `prisma/schema.prisma` (`webhook_outbox.event_id` em UUID, gerado na inserção)
- `src/modules/orders/order.service.ts:126` (método `changeStatus`, ponto de integração onde o evento é inserido na outbox na mesma transação, origem do `event_id`)
