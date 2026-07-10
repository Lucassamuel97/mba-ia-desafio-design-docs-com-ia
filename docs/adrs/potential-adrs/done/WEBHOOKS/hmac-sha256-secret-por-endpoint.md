# Potential ADR — Autenticação HMAC-SHA256 com secret única por endpoint e rotação

**Módulo:** WEBHOOKS
**Prioridade:** must-document
**Decisão fechada na reunião:** sim

## Contexto
Os webhooks expõem dados de pedidos para endpoints fora da nossa infra. O cliente precisa
validar que a requisição veio realmente de nós e que ninguém adulterou o payload no meio. [09:19 Sofia]

## Decisão
Assinar o corpo do request com **HMAC-SHA256** usando uma secret compartilhada, enviando a
assinatura no header `X-Signature`. Padrão de mercado, com biblioteca disponível em qualquer
cliente sério. [09:20 Sofia]

Cada endpoint de webhook do cliente tem uma **secret única** (não uma secret global da
plataforma) — se vaza uma, não vaza tudo. [09:21 Sofia]

A secret é **rotacionável** via endpoint da API: ao rotacionar, a secret antiga continua
válida por **24h em paralelo** (grace period) para o cliente migrar seus sistemas; depois disso
a antiga morre. [09:21-09:22 Sofia]

## Alternativas consideradas
- **Secret global da plataforma** — descartado: um vazamento comprometeria todos os clientes. [09:21]
- **Sem rotação / rotação sem grace period** — descartado: já houve cliente que vazou secret em
  log de aplicação; rotação com janela de 24h dá tempo de migrar sem downtime. [09:22 Diego/Sofia]

## Consequências
- Positiva: integridade e autenticidade do payload verificáveis pelo cliente.
- Positiva: blast radius de um vazamento limitado a um endpoint.
- Negativa: a tabela de configuração precisa guardar `url + secret (+ secret antiga/validade) + customer_id + estado ativo`. [09:21]
- Nota: TLS obrigatório (URL https, recusa http via schema Zod) e limite de payload de 64KB são
  requisitos não funcionais relacionados, não ADRs separados. [09:23-09:24]

## Fontes / rastreabilidade
- TRANSCRICAO: [09:19] Sofia, [09:20] Sofia, [09:21] Sofia/Bruno, [09:22] Diego/Sofia, [09:23-09:24] Sofia/Diego
- CODIGO: `prisma/schema.prisma` (tabela de configuração de webhook com secret por endpoint)
- CODIGO: `src/modules/webhooks/webhook.schemas.ts` (validação Zod: https obrigatório, limite de tamanho)
