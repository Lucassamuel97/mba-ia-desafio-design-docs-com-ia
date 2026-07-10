### PRD: OMS Sistema de Webhooks de Notificação de Pedidos

Versão: 1.0
Data: Não especificada na fonte (reunião técnica de "quinta-feira, 09:00")
Responsável: Marcos (Product Manager)

---

### Resumo

Feature que notifica clientes B2B, em tempo quase real (abaixo de 10 segundos), sempre que o status de um pedido muda no OMS. Hoje os clientes descobrem mudanças fazendo polling manual em `GET /orders`, o que é lento e caro para eles. A solução envia webhooks outbound assinados (HMAC-SHA256) usando o padrão Outbox no MySQL já existente, com um worker separado, retry com backoff e Dead Letter Queue. A feature é aditiva ao OMS atual e reaproveita seus padrões (módulos, `AppError`, logger Pino, `requireRole`).

---

### Contexto e problema

Público-alvo
- Clientes B2B integradores (Atlas Comercial, MaxDistribuição, Nova Cargo)
- Time de engenharia de Pedidos e Plataforma que opera o OMS
- Administradores de operação (reprocessamento de falhas)

Cenários de uso chave
- Cliente cadastra um webhook e passa a receber automaticamente as mudanças de status dos pedidos dele
- Cliente filtra quais status quer ouvir (por exemplo apenas SHIPPED e DELIVERED)
- Cliente consulta o histórico de entregas para auditar sucesso ou falha
- Administrador reprocessa manualmente um evento que caiu na Dead Letter Queue

Onde essa feature será implantada
- Sistema existente. É o OMS em produção, aplicação Node.js e TypeScript com Express e Prisma sobre MySQL. A feature entra como um novo módulo em `src/modules/webhooks` mais um novo processo worker (`src/worker.ts`), sem introduzir nova infraestrutura.

Problemas priorizados
- Clientes precisam fazer polling manual repetido em `GET /orders` para saber se algo mudou, o que deixa a integração lenta e cara. Impacto alto, pois a Atlas sinalizou risco de migrar para um concorrente se a entrega não sair até o fim do trimestre. Prioridade alta. [09:00-09:02 Marcos]
- Não existe nenhum mecanismo de notificação externa, evento, fila ou webhook no OMS hoje. Impacto alto, pois sem isso não há como atender o pedido formal dos clientes. Prioridade alta. [09:03-09:06]
- Disparar a notificação de forma síncrona dentro da mudança de status acoplaria a latência do cliente externo à transação crítica de pedidos. Impacto médio, pois travaria mudança de status para outros pedidos. Prioridade média. [09:04 Bruno]

---

### Objetivos e métricas

| Objetivo | Métrica | Meta |
| --- | --- | --- |
| Notificar o cliente em tempo quase real | Tempo entre a mudança de status e a entrega do webhook | Abaixo de 10 segundos, com pior caso aproximado de 2 segundos [09:02, 09:10] |
| Eliminar o polling manual dos clientes | Necessidade de o cliente consultar `GET /orders` para detectar mudança | Zero, a mudança é empurrada por webhook [09:00-09:02] |
| Tolerar indisponibilidade temporária do cliente sem perder eventos | Janela de tempo coberta pelas tentativas de reentrega | Até aproximadamente 12 a 24 horas, com 5 tentativas [09:16-09:17] |
| Entregar a feature no prazo comercial | Sprints de desenvolvimento incluindo revisão de segurança | 3 sprints [09:46] |

---

### Escopo

Incluso
- CRUD de configuração de webhook (cadastrar, editar, remover, listar)
- Filtro de eventos por status, aplicado na inserção na outbox
- Tabela outbox no MySQL preenchida na mesma transação da mudança de status
- Worker separado em polling de 2 segundos para entrega
- Assinatura HMAC-SHA256 com secret única por endpoint e rotação com grace period de 24 horas
- Retry com backoff exponencial e Dead Letter Queue em tabela separada
- Endpoint admin para replay manual da Dead Letter Queue
- Garantia at-least-once com header `X-Event-Id` para deduplicação no cliente
- Histórico de entregas consultável pelo cliente

Fora de escopo
- E-mail de aviso ao cliente quando o webhook dele falha, adiado para fase futura [09:37]
- Dashboard ou painel visual, é projeto separado do time de frontend [09:40]
- Rate limiting de saída, fica como observar e decidir depois [09:39]
- Garantia de ordenação global entre pedidos diferentes, apenas por `order_id` [09:13]
- Arquivamento das linhas entregues da outbox, aproximadamente 30 dias [09:08]
- Endurecimento de papéis do CRUD de configuração, adiado [09:37]

---

### Requisitos funcionais

#### FR-001 Cadastrar webhook
O cliente cadastra um endpoint de webhook informando url, lista de status desejados e customer_id.

**Fluxo principal**
- Cliente autenticado envia `POST /webhooks` com url https, lista de eventos e customer_id no corpo
- Sistema valida os dados, gera uma secret única e persiste a configuração
- Sistema devolve a configuração criada incluindo a secret, retornada apenas na criação

**Fluxos alternativos e exceções**
- customer_id vem do corpo ou da rota, nunca do JWT do operador [09:32-09:33]
- Se já existir configuração idêntica para o customer, o cadastro é rejeitado

**Erros previstos**
- `WEBHOOK_INVALID_URL` quando a url não é https [09:23]
- `WEBHOOK_INVALID_EVENT` quando um status informado não existe na máquina de estados
- `WEBHOOK_ALREADY_EXISTS` quando já há webhook igual para o customer

**Prioridade:** alta

---

#### FR-002 Editar webhook
O cliente altera url, lista de eventos ou estado ativo de um webhook existente.

**Fluxo principal**
- Cliente autenticado envia `PATCH /webhooks/:id` com os campos a alterar
- Sistema valida e persiste a alteração

**Fluxos alternativos e exceções**
- Alteração parcial, apenas os campos enviados são modificados

**Erros previstos**
- `WEBHOOK_NOT_FOUND` quando o webhook não existe

**Prioridade:** media

---

#### FR-003 Remover webhook
O cliente remove um webhook que não quer mais.

**Fluxo principal**
- Cliente autenticado envia `DELETE /webhooks/:id`
- Sistema remove a configuração

**Fluxos alternativos e exceções**
- Webhook removido para de receber novos eventos, entregas em andamento seguem seu ciclo

**Erros previstos**
- `WEBHOOK_NOT_FOUND` quando o webhook não existe

**Prioridade:** media

---

#### FR-004 Listar webhooks do customer
O cliente consulta os webhooks cadastrados de um customer.

**Fluxo principal**
- Cliente autenticado envia `GET /webhooks?customerId=...`
- Sistema devolve a lista de webhooks do customer, sem a secret

**Fluxos alternativos e exceções**
- A secret nunca é retornada em operações de leitura

**Erros previstos**
- Requisição sem autenticação é rejeitada

**Prioridade:** media

---

#### FR-005 Emitir evento na outbox dentro da transação
Quando o status de um pedido muda, o sistema registra o evento na outbox de forma atômica.

**Fluxo principal**
- `changeStatus` valida a transição e persiste a mudança de status
- Na mesma transação, `publishWebhookEvent(tx, order, from, to)` insere o evento na outbox com payload renderizado e event_id novo
- Se a transação commita, o evento existe. Se sofre rollback, o evento some junto [09:06, 09:40]

**Fluxos alternativos e exceções**
- Se nenhum webhook ativo do customer ouve aquele status, nada é inserido [09:34]
- As pontas da transição vêm dos parâmetros from e to, nunca de reler o status do pedido em memória

**Erros previstos**
- Falha ao inserir na outbox provoca rollback da mudança de status

**Prioridade:** alta

---

#### FR-006 Entregar o webhook pelo worker com assinatura
Um worker separado entrega os eventos pendentes com assinatura HMAC.

**Fluxo principal**
- Worker em processo separado faz polling a cada 2 segundos pelos eventos pendentes mais antigos
- Monta os headers, assina o corpo com HMAC-SHA256 e envia via HTTP POST com timeout de 10 segundos
- Resposta 2xx marca o evento como entregue e registra na tabela de entregas

**Fluxos alternativos e exceções**
- Resposta diferente de 2xx ou timeout aciona o fluxo de retry
- Ordenação garantida por `order_id` enquanto houver worker único [09:13]

**Erros previstos**
- Timeout de 10 segundos é tratado como falha [09:42]

**Prioridade:** alta

---

#### FR-007 Reentregar com backoff e mover para a DLQ
Falhas de entrega são reentregues com backoff e, esgotadas, vão para a Dead Letter Queue.

**Fluxo principal**
- Cada falha incrementa a tentativa e agenda a próxima pelo backoff 1m, 5m, 30m, 2h e 12h
- Após 5 tentativas sem sucesso, o evento é movido para a tabela de Dead Letter Queue com o motivo da falha [09:15-09:18]

**Fluxos alternativos e exceções**
- Cliente que volta a responder dentro da janela recebe o evento normalmente

**Erros previstos**
- Evento que esgota as tentativas fica registrado como falha permanente na DLQ

**Prioridade:** alta

---

#### FR-008 Reprocessar a DLQ pelo admin
Um administrador reprocessa manualmente um evento da Dead Letter Queue.

**Fluxo principal**
- Administrador envia `POST /admin/webhooks/dead-letter/:id/replay`
- Sistema recoloca o evento como pendente na outbox e registra quem executou

**Fluxos alternativos e exceções**
- Apenas usuários com papel ADMIN podem executar, reaproveitando `requireRole` [09:36]

**Erros previstos**
- `WEBHOOK_FORBIDDEN` quando o usuário não é ADMIN
- `WEBHOOK_DEAD_LETTER_NOT_FOUND` quando o item não existe

**Prioridade:** media

---

#### FR-009 Rotacionar a secret com grace period
O cliente troca a secret usada na assinatura sem interromper a integração.

**Fluxo principal**
- Cliente pede a rotação e o sistema gera uma nova secret
- A secret anterior continua válida por 24 horas em paralelo, depois deixa de funcionar [09:21-09:22]

**Fluxos alternativos e exceções**
- Durante o grace period, assinaturas com a secret antiga ou a nova são aceitas

**Erros previstos**
- `WEBHOOK_NOT_FOUND` quando o webhook não existe

**Prioridade:** media

---

#### FR-010 Consultar histórico de entregas
O cliente audita as últimas entregas de um webhook.

**Fluxo principal**
- Cliente envia `GET /webhooks/:id/deliveries`
- Sistema devolve as últimas entregas com sucesso ou falha, status code, tempo de resposta e tentativa [09:34]

**Fluxos alternativos e exceções**
- Lista limitada às entregas mais recentes, aproximadamente as últimas 100

**Erros previstos**
- `WEBHOOK_NOT_FOUND` quando o webhook não existe

**Prioridade:** media

---

### Requisitos não funcionais

Performance
- Latência entre a mudança de status e a entrega do webhook abaixo de 10 segundos, com pior caso aproximado de 2 segundos dado o polling de 2 segundos [09:02, 09:10]
- Timeout de 10 segundos por tentativa de entrega [09:42]

Disponibilidade
- Hipótese: 99.9 por cento de uptime mensal do processamento de webhooks, alinhado ao padrão de sistemas voltados ao cliente externo. Não foi definido número na reunião

Segurança e autorização
- Assinatura HMAC-SHA256 do corpo, com secret única por endpoint e rotação com grace period de 24 horas [09:20-09:22]
- TLS obrigatório, url do webhook precisa ser https [09:23]
- Replay da DLQ exige papel ADMIN e registra quem executou, para auditoria [09:36]

Observabilidade
- Logs estruturados com o logger Pino existente, registrando event_id, webhook_id, status code, tentativa e tempo de resposta [09:29]
- Métricas de eventos por status da outbox, taxa de sucesso de entrega, latência de entrega e profundidade da DLQ
- Tracing do ciclo de vida do evento, correlacionado pelo event_id, do insert na outbox até a entrega

Confiabilidade e integridade de dados
- Inserção do evento na outbox é transacional com a mudança de status, sem evento órfão [09:40]
- Garantia at-least-once, com deduplicação pelo cliente via `X-Event-Id` [09:24-09:26]
- Limite de tamanho de payload de 64KB, com erro caso ultrapasse [09:24]

Compatibilidade e portabilidade
- API REST JSON versionada em `/api/v1`, seguindo o padrão do OMS
- Sem novas dependências de infraestrutura, usa o MySQL existente [09:07]

Compliance
- Trilha de auditoria do replay da DLQ disponível, com identificação de quem executou [09:36]

Acessibilidade no frontend consumidor
- Não se aplica nesta fase, a entrega é puramente por API. Dashboard ou painel visual está fora de escopo [09:40]

---

### Arquitetura e abordagem

Abordagem
- Sistema existente estendido com um novo módulo `src/modules/webhooks` e um processo worker separado. Comunicação assíncrona via padrão Outbox no MySQL, sem fila ou mensageria externa [09:06-09:07]

Componentes
- API do OMS em Node.js e TypeScript com Express, recebe o CRUD de configuração e o endpoint admin de replay
- Worker de webhooks em processo separado (`src/worker.ts`), com PrismaClient próprio, faz polling e entrega
- MySQL como fonte de verdade, com as tabelas de configuração, outbox, dead letter e entregas
- Sistema do cliente B2B como destino externo dos webhooks

Integrações
- `changeStatus` do módulo de pedidos chama `publishWebhookEvent(tx, ...)` na transação, único ponto de contato intrusivo com o código atual [09:41]
- Entrega HTTP POST outbound assinada para a url configurada pelo cliente

### Decisões e trade-offs

#### Decisão: Padrão Outbox no MySQL em vez de disparo síncrono ou fila externa
- **Justificativa:** garante atomicidade entre a mudança de status e o registro do evento, sem subir infraestrutura nova, adequado a um time pequeno [09:06-09:07]
- **Trade-off:** exige um worker de polling e introduz latência mínima de alguns segundos. Ver [ADR-001](./adrs/ADR-001-outbox-no-mysql.md)

#### Decisão: Worker em processo separado com polling de 2 segundos
- **Justificativa:** isola o ciclo de vida do worker da API e atende o requisito de menos de 10 segundos, já que o MySQL não tem notificação nativa [09:09-09:11]
- **Trade-off:** ordenação garantida apenas por `order_id` enquanto houver worker único. Ver [ADR-002](./adrs/ADR-002-worker-processo-separado-polling.md)

#### Decisão: Retry com backoff exponencial de 5 tentativas e DLQ separada
- **Justificativa:** cobre janelas de indisponibilidade de horas sem deixar eventos pendurados para sempre, e mantém a outbox principal limpa [09:15-09:18]
- **Trade-off:** um cliente fora do ar por mais de aproximadamente 15 horas perde a entrega automática. Ver [ADR-003](./adrs/ADR-003-retry-backoff-exponencial-dlq.md)

#### Decisão: Entrega at-least-once com X-Event-Id em vez de exactly-once
- **Justificativa:** exactly-once exigiria coordenação dos dois lados, muito mais complexa. At-least-once com identificador resolve a maioria dos casos [09:25]
- **Trade-off:** transfere a deduplicação para o cliente, que precisa tratar eventos repetidos. Ver [ADR-005](./adrs/ADR-005-entrega-at-least-once-x-event-id.md)

---

### Dependências

#### technical: Extensão do método changeStatus
`OrderService.changeStatus` precisa passar a chamar `publishWebhookEvent(tx, order, from, to)` dentro da transação existente. É o único ponto de código atual que precisa ser alterado [09:40-09:41]

#### technical: Novo processo worker e script de execução
É preciso criar o entry-point `src/worker.ts` e um script `npm run worker`, com PrismaClient próprio apontando para a mesma DATABASE_URL [09:11, 09:30]

#### organizational: Revisão de segurança antes do deploy
Sofia precisa reservar pelo menos dois dias úteis para revisar o código de segurança, em especial HMAC e geração de secret, antes de subir [09:46]

#### organizational: Documentação para os clientes no portal do desenvolvedor
O produto precisa documentar de forma destacada a deduplicação pelo X-Event-Id e como integrar via API [09:26, 09:40]

---

### Riscos e mitigação

#### Cliente lento ou indisponível faz eventos falharem e acumularem
- **Probabilidade:** alta
- **Impacto:** eventos não entregues e crescimento da fila de reentrega
- **Mitigação:**
  - Retry com backoff exponencial de 5 tentativas cobrindo aproximadamente 12 a 24 horas
  - Dead Letter Queue em tabela separada para não poluir a outbox
  - Timeout de 10 segundos por tentativa para não segurar o worker
- **Plano de contingência:** replay manual pelo endpoint admin após o cliente se restabelecer [09:18]

#### Endpoint admin de replay e o requireRole não têm cobertura de testes hoje
- **Probabilidade:** media
- **Impacto:** falha de autorização poderia expor uma operação sensível de reprocessamento
- **Mitigação:**
  - Adicionar testes do endpoint admin cobrindo ADMIN, papel sem permissão e não autenticado
  - Revisão de segurança dedicada antes do deploy
- **Plano de contingência:** desabilitar temporariamente o endpoint de replay até a cobertura estar pronta

#### Chamada de publishWebhookEvent pode derrubar a transação de mudança de status
- **Probabilidade:** baixa
- **Impacto:** falha ao inserir na outbox aborta a mudança de status do pedido
- **Mitigação:**
  - Manter a função enxuta, apenas um insert indexado
- **Plano de contingência:** monitorar erros da transação e tratar a atomicidade como comportamento esperado, já que sem evento não deve haver mudança de status [09:40]

#### Crescimento indefinido da tabela outbox
- **Probabilidade:** media
- **Impacto:** degradação de performance de leitura da outbox ao longo do tempo
- **Mitigação:**
  - Índices em status e created_at para o worker ler apenas pendentes em lote pequeno
  - Monitorar a profundidade da tabela
- **Plano de contingência:** implementar o arquivamento de entregues, aproximadamente 30 dias, em fase seguinte [09:08]

---

### Critérios de aceitação
Checklist objetivo que define se a feature está pronta.

- Toda mudança de status insere exatamente um evento na outbox por webhook inscrito, na mesma transação, e um rollback não deixa evento órfão
- Nenhum evento é inserido quando nenhum webhook do customer ouve aquele status
- O worker entrega em menos de 10 segundos no caso comum e aplica timeout de 10 segundos por tentativa
- Falhas seguem o backoff 1m, 5m, 30m, 2h e 12h e, após 5 tentativas, o evento está na Dead Letter Queue
- Toda entrega leva os headers X-Event-Id, X-Signature, X-Timestamp e X-Webhook-Id, com assinatura HMAC-SHA256 válida
- O replay da Dead Letter Queue exige papel ADMIN e registra quem executou
- Uma url http é recusada com WEBHOOK_INVALID_URL e um payload acima de 64KB é recusado
- A rotação de secret mantém a secret anterior válida por 24 horas

---

### Testes e validação

Tipos de teste obrigatórios
- Testes unitários para as regras críticas, como o cálculo do backoff, a geração e verificação do HMAC e o filtro de eventos por status
- Testes de integração para o fluxo principal, da mudança de status até a entrega, incluindo o comportamento transacional da outbox
- Testes de integração para retry, movimentação para a Dead Letter Queue e replay
- Testes de segurança para a autorização do endpoint admin, cobrindo ADMIN, papel sem permissão e não autenticado

Estratégia de validação
- TDD para a lógica crítica de outbox, retry e assinatura, QA manual guiado por roteiro para os fluxos de CRUD e replay, e revisão de segurança dedicada da Sofia antes do deploy [09:46]
