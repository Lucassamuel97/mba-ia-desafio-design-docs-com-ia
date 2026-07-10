# Potential ADR — Reuso dos padrões existentes do projeto no módulo de webhooks

**Módulo:** WEBHOOKS
**Prioridade:** must-document
**Decisão fechada na reunião:** sim
**Referencia código existente:** SIM (ADR obrigatório com referência a código)

## Contexto
O OMS já tem padrões claros e consistentes na codebase. Em vez de introduzir estruturas
novas, o webhook deve seguir o que já existe, para reduzir custo cognitivo e manter a
coerência. [09:27-09:30]

## Decisão
Reaproveitar ao máximo os padrões do projeto no novo módulo `src/modules/webhooks`:

- **Estrutura modular**: `controller / service / repository / routes / schemas`, igual aos
  demais módulos em `src/modules/*`. [09:27 Bruno]
- **Classes de erro**: seguir a hierarquia `AppError` (`src/shared/errors`), com códigos no
  padrão de prefixo — família `WEBHOOK_*` (ex.: `WEBHOOK_NOT_FOUND`, `WEBHOOK_INVALID_URL`,
  `WEBHOOK_SECRET_REQUIRED`), análogo a `INSUFFICIENT_STOCK` / `INVALID_STATUS_TRANSITION`. [09:28-09:29 Bruno/Larissa]
- **Error middleware centralizado**: não muda nada — reconhece qualquer erro por
  `instanceof AppError` e já trata Zod e Prisma. [09:29 Bruno]
- **Logger Pino** (`src/shared/logger`): reusar, sem introduzir logger novo. [09:29 Bruno]
- **Validação Zod**: seguir o padrão de schemas existente. [09:30]
- **Autorização**: reusar `requireRole` (`src/middlewares/auth.middleware.ts`) no endpoint de
  replay de DLQ (role `ADMIN`). [09:36 Sofia/Larissa]

## Alternativas consideradas
- **Introduzir estruturas/bibliotecas próprias do módulo** — descartado: quebraria a
  consistência e aumentaria o custo de manutenção; os padrões existentes cobrem o caso. [09:30]

## Consequências
- Positiva: curva de aprendizado baixa; o módulo se parece com todos os outros.
- Positiva: o error middleware e o logger absorvem o novo módulo sem alteração.
- Negativa/risco: não há registro central de códigos de erro — atenção a colisão ao criar a
  família `WEBHOOK_*` (evidência da análise de código).
- Nota: `requireRole` hoje é usado em um único endpoint (`GET /users/:id`) e não tem cobertura
  de teste — o novo endpoint admin depende do mesmo mecanismo.

## Fontes / rastreabilidade
- TRANSCRICAO: [09:27] Bruno, [09:28] Bruno/Diego, [09:29] Bruno/Larissa, [09:30] Bruno/Larissa, [09:36] Sofia/Larissa
- CODIGO: `src/shared/errors` (hierarquia `AppError`), `src/shared/logger` (Pino),
  `src/middlewares/auth.middleware.ts` (`requireRole`), `src/modules/orders` (padrão de módulo a espelhar)
