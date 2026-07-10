# C4 Diagrams - Webhooks de Notificação de Pedidos

## Idioma detectado

O FDD (`docs/FDD.md`) está em **Português (pt-BR)**. Todos os diagramas foram gerados no mesmo
idioma, com acentuação correta, mantendo termos técnicos em inglês (Outbox, Worker, HMAC, DLQ,
Prisma, retry, backoff, timeout, replay, polling, etc.).

## Arquivos gerados

- `webhooks-c1.puml` — diagrama de Contexto de Sistema
- `webhooks-c2.puml` — diagrama de Container
- `webhooks-c3.puml` — diagrama de Componente
- `webhooks-c4.puml` — diagrama de Código (class diagram)
- `webhooks-c4.md` — este arquivo de análise

**Nenhum nível foi ignorado.** O FDD contém detalhe suficiente para os quatro níveis: contexto de
negócio (seção 1), arquitetura de containers (seções 5.2, 10, 11), componentes internos (seções
5.1–5.3, 10) e detalhe de código (seções 4, 6, 7, 10 — assinatura de função, campos de tabelas,
taxonomia de erros, parâmetros de algoritmo).

## Análise por nível

### C1 - Contexto de Sistema

- **Elementos explícitos**: OMS como sistema principal (seção 1, 10); Sistema do Cliente B2B como
  ator externo que configura webhooks (seção 6.1–6.5) e recebe notificações (seção 6.7);
  Administrador como pessoa que executa replay de DLQ (seção 5.3, 6.6, role `ADMIN`).
- **Inferências**: nenhuma relevante — o FDD já nomeia claramente os três atores/sistemas.
- **Exclusões confirmadas**: dashboard/painel visual e e-mail de aviso de falha (seção 3) não
  aparecem no diagrama, pois estão fora de escopo.
- **Natureza do componente**: o sistema de webhooks não é uma biblioteca embarcada; é uma extensão
  do OMS existente (chamada em `changeStatus`) mais um processo dedicado (worker) — por isso ambos
  aparecem agregados sob o mesmo `System_Boundary` no C1, sem expor detalhes internos.

### C2 - Container

- **Elementos explícitos**: API OMS (Node.js + TypeScript + Express, seção 11); Worker de Webhooks
  como processo separado com `PrismaClient` próprio (seção 5.2, 11); banco MySQL via Prisma com as
  quatro tabelas novas (seção 4); Sistema do Cliente B2B como container externo.
  - Tecnologias e versões usadas são exatamente as citadas no FDD (Node.js + TypeScript, Express,
    Prisma/MySQL); nenhuma versão numérica foi inventada porque o FDD não especifica versões
    exatas de runtime.
- **Inferências**: nenhuma — a seção 11 ("Dependências e compatibilidade") descreve exatamente o
  runtime, ausência de infraestrutura nova (sem Redis/broker) e o novo script `npm run worker`.
- **Exclusões confirmadas**: nenhuma infraestrutura nova (broker de mensagens) foi adicionada,
  conforme "sem infra nova" (seção 2) e "sem novas dependências de infraestrutura" (seção 11).
- **Natureza do componente**: Worker tratado como container out-of-process independente (processo
  separado, `PrismaClient` próprio, script `npm run worker` — seção 5.2, 11), não como biblioteca.

### C3 - Componente

- **Elementos explícitos**: `publishWebhookEvent` (seção 5.1, 10); API pública de CRUD de webhooks
  e histórico (seção 6.1–6.5); endpoint de replay de DLQ (seção 5.3, 6.6); componentes do worker —
  polling loop, assinatura HMAC, cliente de entrega HTTP, cálculo de retry/backoff e movimentação
  para DLQ (seção 5.2, 5.3, 8).
- **Inferências documentadas**:
  - Os componentes internos do worker (Event Poller, HMAC Signer, Delivery Client, Retry
    Scheduler, DLQ Mover) foram nomeados a partir da descrição textual do fluxo em 5.2/5.3, que
    descreve as responsabilidades mas não usa esses nomes de classe explicitamente. Justificativa:
    a FDD descreve claramente as etapas sequenciais (buscar → assinar → enviar → registrar/retry),
    permitindo inferir a separação de responsabilidades sem fabricar comportamento novo.
  - Componente "Erros WEBHOOK_*" agregado como um único componente para representar a família de
    subclasses de `AppError` (seção 7), evitando poluir o diagrama com 8 elementos individuais
    (esses aparecem detalhados no C4).
- **Exclusões confirmadas**: nenhum componente de rate limiting de saída ou ordering global foi
  incluído (seção 3, fora de escopo); a nota sobre "single-worker garante ordem por order_id" é
  citada apenas como limitação conhecida (seção 8), não como funcionalidade a implementar.

### C4 - Código

- **Elementos explícitos**:
  - Assinatura de função `publishWebhookEvent(tx, order, from, to)` (seção 5.1/10).
  - Estruturas de dados completas das quatro tabelas novas, com campos e tipos (seção 4).
  - Payload de request/response dos endpoints HTTP e do webhook outbound (seção 6.1–6.7).
  - Taxonomia completa dos 8 erros `WEBHOOK_*` como subclasses de `AppError` (seção 7).
  - Parâmetros de algoritmo: timeout de 10s, backoff `1m/5m/30m/2h/12h`, limite de 5 tentativas,
    limite de payload de 64KB, cabeçalhos HTTP do webhook assinado (seção 5.2, 5.3, 6.7, 8).
- **Inferências documentadas**:
  - `OrderStatusMachine` (`canTransition`, `allowedTransitions`, `isTerminal`) foi incluída como
    referência porque a seção 10.2 cita esses três métodos nominalmente como "fonte de verdade"
    para validar `events` e os campos `from_status`/`to_status`, mas o FDD não detalha suas
    assinaturas completas — isso está anotado explicitamente no diagrama como inferência.
  - Método `sign(payload)` do `WebhookWorker` foi inferido a partir da descrição "assina com
    HMAC-SHA256" (seção 5.2); a implementação usa `crypto` nativo do Node (seção 11), sem
    biblioteca externa — não foi inventado nenhum algoritmo além do citado.
- **Exclusões confirmadas**: nenhum código de arquivamento da outbox (~30 dias) ou de rate
  limiting foi incluído, pois estão explicitamente fora de escopo (seção 3).

## Descrição dos diagramas

### C1 - Contexto de Sistema
- **Audiência**: Stakeholders, Product Managers
- **Elementos-chave**: OMS (sistema principal), Sistema do Cliente B2B (externo), Administrador
  (pessoa)
- **Valor de negócio**: garante que clientes B2B sejam notificados em tempo hábil (~2s) sobre
  mudanças de status de pedido, sem comprometer a transação crítica de pedidos e sem exigir nova
  infraestrutura.

### C2 - Container
- **Audiência**: Arquitetos, Tech Leads
- **Containers principais**: API OMS (Node.js/TypeScript/Express), Worker de Webhooks (Node.js/TS,
  processo dedicado), MySQL (Prisma) com as tabelas novas
- **Contexto de deployment**: dois processos independentes compartilhando a mesma instância MySQL
  e `DATABASE_URL`, cada um com seu próprio `PrismaClient`; nenhuma infraestrutura de mensageria
  nova foi introduzida.

### C3 - Componente
- **Audiência**: Tech Leads, desenvolvedores sênior
- **Componentes principais**: `publishWebhookEvent` (dentro da transação de `changeStatus`), API
  pública de CRUD/replay, e no worker: poller, assinador HMAC, cliente de entrega, agendador de
  retry e movimentador de DLQ
- **Pontos de integração**: chamada intrusiva única em `OrderService.changeStatus`; leitura/escrita
  compartilhada no MySQL entre API e Worker; entrega HTTP assinada ao Sistema do Cliente B2B.

### C4 - Código
- **Audiência**: Desenvolvedores
- **Interfaces principais**: `WebhookController`, `DeadLetterReplayController`,
  `publishWebhookEvent`
- **Estruturas principais**: `WebhookConfig`, `WebhookOutbox`, `WebhookDeadLetter`,
  `WebhookDelivery`
- **Algoritmos-chave**: assinatura HMAC-SHA256, backoff exponencial com 5 tentativas, limite de
  payload de 64KB, timeout de 10s por tentativa de entrega
- **Notas de implementação**: atomicidade obrigatória entre `changeStatus` e o insert na outbox;
  uso de `from`/`to` por parâmetro (nunca releitura de `order.status` em memória, armadilha citada
  explicitamente na seção 5.1)

## Resultados da validação

### Checklist
- [x] Todos os elementos rastreados ao FDD ou documentados como inferência
- [x] Nenhum item fora de escopo presente nos diagramas
- [x] Tecnologias correspondem exatamente ao especificado no FDD (sem versões inventadas)
- [x] Progressão de detalhe apropriada (C1 → C2 → C3 → C4)
- [x] Worker tratado como container independente (fora de processo), não como biblioteca embarcada
- [x] Diagramas usam sintaxe moderna do PlantUML (`!include <C4/...>`)
- [x] `SHOW_LEGEND()` presente em C1, C2 e C3 (omitido corretamente em C4, que usa class diagram)
- [x] Notas concisas, em bullet points, sem referências de seção do FDD no próprio diagrama
- [x] Idioma consistente com o FDD, com acentuação correta em todos os quatro diagramas
- [x] Termos técnicos mantidos em inglês (Outbox, Worker, HMAC, DLQ, retry, backoff, timeout,
      polling, replay)

### Verificação de consistência
- Os nomes de containers/componentes (API OMS, Worker de Webhooks, MySQL, Sistema do Cliente B2B)
  são usados de forma idêntica do C1 ao C3, garantindo rastreabilidade visual entre níveis.
- As mesmas quatro tabelas (`webhook_config`, `webhook_outbox`, `webhook_dead_letter`,
  `webhook_delivery`) aparecem em C2 (nota do container de banco), C3 (relações com componentes) e
  C4 (estruturas de dados detalhadas), sem divergência de nomes ou campos.
- Os parâmetros de resiliência (timeout 10s, backoff 1m/5m/30m/2h/12h, 5 tentativas) são citados de
  forma consistente em C2, C3 e C4.
- Nenhuma revisão adicional foi necessária além do ajuste de acentuação em uma nota do C1
  ("até ~2s") realizado durante a etapa de revisão interna de qualidade.
