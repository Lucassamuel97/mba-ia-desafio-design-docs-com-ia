# Potential ADR — Entrega at-least-once com X-Event-Id para idempotência no cliente

**Módulo:** WEBHOOKS
**Prioridade:** must-document
**Decisão fechada na reunião:** sim

## Contexto
Com retry, o mesmo evento pode ser entregue mais de uma vez (ex.: o cliente recebeu e
respondeu lento, o worker considerou falha e retentou). Foi preciso definir a garantia de
entrega e como o cliente diferencia duplicatas. [09:24-09:25]

## Decisão
Adotar garantia **at-least-once**. Cada evento carrega um **`event_id` (UUID)** gerado quando
entra na outbox, enviado no header **`X-Event-Id`**. O cliente **dedupica pelo `event_id`** do
lado dele. É o padrão de mercado (Stripe, GitHub fazem assim). [09:25 Diego]

## Alternativas consideradas
- **Exactly-once** — descartado: exigiria coordenação dos dois lados, muito mais complexo.
  At-least-once com `event_id` resolve 99% dos casos. [09:25 Diego]

## Consequências
- Positiva: simplicidade; sem coordenação distribuída.
- Positiva: `event_id` estável por evento permite ao cliente idempotência confiável.
- Negativa: joga a responsabilidade de deduplicação para o cliente — a ser documentado com
  destaque no portal do desenvolvedor. [09:25-09:26 Sofia/Marcos]

## Fontes / rastreabilidade
- TRANSCRICAO: [09:24] Diego, [09:25] Diego/Bruno/Sofia, [09:26] Marcos/Larissa
- CODIGO: `prisma/schema.prisma` (`webhook_outbox.event_id` em UUID, gerado na inserção)
- Relacionado: headers de envio `X-Event-Id`, `X-Signature`, `X-Timestamp`, `X-Webhook-Id` [09:44]
