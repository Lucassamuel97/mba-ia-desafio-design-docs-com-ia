# ADR-006: Reuso dos Padrões Existentes do Projeto no Módulo de Webhooks

**Status:** Aceito
**Data:** Desconhecida (nenhuma data de calendário foi registrada na transcrição da reunião, apenas "quinta-feira, 09:00")
**Related ADRs:** [ADR-003](./ADR-003-retry-backoff-exponencial-dlq.md) — Retry com Backoff Exponencial e Dead Letter Queue em Tabela Separada (endpoint de replay de DLQ reusa `requireRole('ADMIN')`)

## Contexto e Problema

O sistema de pedidos (OMS) já possui um conjunto consistente de padrões arquiteturais na sua codebase: estrutura modular por domínio (`controller/service/repository/routes/schemas`), hierarquia de erros baseada em `AppError`, logger Pino centralizado, middleware de erro genérico e validação de entrada com Zod. Ao projetar o novo módulo de webhooks — que notifica clientes B2B sobre mudanças de status de pedido —, a equipe discutiu se deveria introduzir estruturas ou bibliotecas próprias para esse módulo ou se deveria seguir integralmente o que já existe no restante do projeto. [09:27-09:30]

A motivação central foi reduzir o custo cognitivo de quem for manter o código e preservar a coerência do OMS, evitando que o módulo de webhooks se torne uma ilha arquitetural distinta dos demais módulos em `src/modules/*`.

## Fatores de Decisão

- Reduzir o custo cognitivo da equipe mantendo o novo módulo coerente com o restante do OMS. [09:27-09:30]
- A estrutura modular (`controller/service/repository/routes/schemas`) já é o padrão usado em todos os demais módulos em `src/modules/*`. [09:27 Bruno]
- Erros do módulo devem seguir a hierarquia `AppError` com códigos de prefixo próprio (família `WEBHOOK_*`), análogo ao padrão já usado por outros módulos (ex.: `INSUFFICIENT_STOCK`, `INVALID_STATUS_TRANSITION`). [09:28-09:29 Bruno/Larissa]
- O middleware de erro centralizado já reconhece qualquer erro via `instanceof AppError` e trata Zod e Prisma, absorvendo o novo módulo sem qualquer alteração. [09:29 Bruno]
- O logger Pino (`src/shared/logger`) já está disponível para o projeto inteiro, sem necessidade de introduzir um logger novo. [09:29 Bruno]
- A autorização do endpoint administrativo de replay de DLQ pode reaproveitar o mecanismo `requireRole` já existente. [09:36 Sofia/Larissa]

## Opções Consideradas

1. Reaproveitar ao máximo os padrões já existentes do projeto no módulo de webhooks (escolhida)
2. Introduzir estruturas e/ou bibliotecas próprias específicas para o módulo de webhooks

## Resultado da Decisão

Opção escolhida: reaproveitar ao máximo os padrões existentes do projeto no módulo `src/modules/webhooks`, incluindo a estrutura modular, a hierarquia de erros `AppError` com prefixo `WEBHOOK_*`, o logger Pino, o middleware de erro centralizado, a validação de entrada seguindo o padrão de schemas Zod já utilizado no projeto [09:30], e o reuso de `requireRole` para autorização do endpoint administrativo de replay de DLQ.

A decisão foi fechada em reunião técnica, com base na avaliação de que os padrões já existentes cobrem integralmente as necessidades do módulo de webhooks, sem exigir novas bibliotecas ou abstrações.

Rastreabilidade da decisão (transcrição da reunião): [09:27] Bruno, [09:28] Bruno/Diego, [09:29] Bruno/Larissa, [09:30] Bruno/Larissa, [09:36] Sofia/Larissa.

## Prós e Contras das Opções

### Reaproveitar os padrões existentes do projeto (escolhida)

Prós:
- Curva de aprendizado baixa; o módulo de webhooks se parece com todos os outros módulos do OMS.
- O middleware de erro centralizado e o logger Pino absorvem o novo módulo sem qualquer alteração de código compartilhado.
- Menor custo de manutenção a longo prazo, por preservar consistência estrutural entre módulos.

Contras:
- Não existe hoje um registro central dos códigos de erro do projeto, exigindo atenção manual para evitar colisão ao criar a família `WEBHOOK_*` (evidência de análise de código).

### Introduzir estruturas/bibliotecas próprias para o módulo

Prós:
- Poderia, em tese, ser desenhada especificamente para as necessidades do módulo de webhooks.

Contras:
- Quebraria a consistência do projeto e aumentaria o custo de manutenção, já que os padrões existentes cobrem o caso — descartada por esse motivo. [09:30]

## Consequências

A adoção do reuso de padrões mantém a curva de aprendizado baixa para quem for dar manutenção no módulo, já que o módulo de webhooks se parece estruturalmente com todos os demais módulos do OMS. O middleware de erro centralizado e o logger Pino absorvem o novo módulo sem qualquer alteração em código compartilhado.

Como risco identificado na análise de código, não existe hoje um registro central dos códigos de erro do projeto — isso exige atenção manual para evitar colisão entre a nova família `WEBHOOK_*` e códigos de erro de outros módulos existentes ou futuros. **Ponto em aberto:** não há processo ou ferramenta definido para registrar/validar novos prefixos de código de erro antes de introduzi-los, o que exige atenção manual contra colisões.

Adicionalmente, o mecanismo `requireRole`, hoje utilizado em um único endpoint do sistema, não possui cobertura de testes (evidência de análise de código) — o novo endpoint administrativo de replay de DLQ passa a depender do mesmo mecanismo sem essa garantia adicional. **Ponto em aberto:** não há decisão ou prazo definido para adicionar cobertura de testes ao `requireRole` antes de ele suportar um segundo endpoint crítico (o replay de DLQ).

## Referências

- `src/shared/errors`
- `src/shared/logger`
- `src/middlewares/auth.middleware.ts`
- `src/modules/orders`
