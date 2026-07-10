# ADR-004: Autenticação de Webhooks com HMAC-SHA256 e Secret Única por Endpoint com Rotação

**Status:** Aceita
**Data:** Desconhecida (decisão fechada em reunião técnica; nenhuma data de calendário foi registrada na transcrição, apenas "quinta-feira, 09:00")
**Related ADRs:** [ADR-005](./ADR-005-entrega-at-least-once-x-event-id.md) — decisão irmã sobre o mesmo contrato de headers de entrega (`X-Signature`, `X-Event-Id`)

## Contexto e Problema

Os webhooks do sistema expõem dados de pedidos para endpoints de clientes fora da nossa infraestrutura. É necessário garantir que o cliente consiga validar que a requisição realmente veio da nossa plataforma e que ninguém adulterou o payload no caminho. [09:19 Sofia]

Além da autenticidade e integridade do payload, a solução precisa lidar com o ciclo de vida da credencial usada na assinatura: como ela é isolada por cliente e como pode ser trocada sem interromper a integração já em produção do cliente.

A decisão foi fechada na reunião técnica, com os requisitos não funcionais de TLS obrigatório e limite de payload de 64KB tratados como validações de schema, e não como decisões arquiteturais separadas. [09:23-09:24 Sofia/Diego]

## Fatores de Decisão

- Necessidade de o cliente validar autenticidade e integridade do payload recebido, já que o webhook trafega fora da nossa infraestrutura. [09:19 Sofia]
- Preferência por padrão de mercado amplamente suportado, evitando implementação criptográfica proprietária. [09:20 Sofia]
- Limitação do raio de impacto (blast radius) em caso de vazamento de credencial. [09:21 Sofia]
- Histórico real de incidente: cliente já vazou secret em log de aplicação, exigindo mecanismo de rotação sem downtime. [09:22 Diego/Sofia]

## Opções Consideradas

- HMAC-SHA256 com secret única por endpoint e rotação com grace period de 24h (escolhida)
- Secret global da plataforma, compartilhada entre todos os clientes
- Secret única por endpoint, mas sem rotação ou sem grace period na rotação

## Decisão Tomada

Decisão: assinar o corpo da requisição com **HMAC-SHA256**, usando uma secret **única por endpoint** de webhook (não uma secret global da plataforma), com a assinatura enviada no header `X-Signature`. [09:20-09:21 Sofia]

A secret é rotacionável via endpoint da API; ao rotacionar, a secret antiga permanece válida por **24h em paralelo** com a nova (grace period), dando tempo ao cliente para migrar seus sistemas antes que a secret antiga deixe de funcionar. [09:21-09:22 Sofia]

HMAC-SHA256 foi escolhido por ser padrão de mercado, com biblioteca disponível em praticamente qualquer stack cliente, evitando que o time precise manter ou justificar um mecanismo de assinatura proprietário. [09:20 Sofia]

## Prós e Contras das Opções

### HMAC-SHA256 com secret única por endpoint e rotação (escolhida)

- Prós: integridade e autenticidade do payload verificáveis pelo cliente. [09:19-09:20 Sofia]
- Prós: vazamento de uma secret compromete apenas um endpoint, não a base de clientes inteira. [09:21 Sofia]
- Prós: rotação com grace period de 24h permite migração sem downtime do cliente. [09:21-09:22 Sofia]
- Contras: exige guardar por registro `url + secret (+ secret antiga/validade) + customer_id + estado ativo`, aumentando a superfície da tabela de configuração. [09:21 Sofia/Bruno]

### Secret global da plataforma

- Prós: modelo de dados mais simples, sem necessidade de secret por registro.
- Contras: um único vazamento compromete a autenticidade dos webhooks de todos os clientes. [09:21 Sofia]

### Secret única por endpoint sem rotação (ou sem grace period)

- Prós: implementação mais simples, sem necessidade de manter secret antiga em paralelo.
- Contras: já houve caso real de cliente vazando secret em log de aplicação; sem grace period, a troca de secret geraria downtime na integração do cliente. [09:22 Diego/Sofia]

## Consequências

A adoção de secret por endpoint com rotação limita o raio de impacto de um vazamento a um único cliente/endpoint, alinhado ao incidente já observado de secret vazada em log de aplicação. Em contrapartida, a tabela de configuração de webhook precisa armazenar tanto a secret ativa quanto a secret anterior durante o período de convivência, junto com sua validade. [09:21 Sofia]

TLS obrigatório (URLs https, com recusa de http via schema Zod) e o limite de payload de 64KB são requisitos não funcionais relacionados a essa mesma superfície de segurança, mas foram tratados como validações de schema e não como decisões arquiteturais independentes. [09:23-09:24 Sofia/Diego]

**Ponto em aberto:** a forma de armazenamento da secret em repouso (texto plano vs. criptografada/hash no banco) não foi discutida na reunião.

**Ponto em aberto:** não há definição de limite de frequência para rotação de secret pelo cliente (ex.: quantas rotações por período são permitidas).

## Referências

- `prisma/schema.prisma` — tabela de configuração de webhook com secret por endpoint
- `src/modules/webhooks/webhook.schemas.ts` — validação Zod: https obrigatório, limite de tamanho
