# Desafio: Da Reunião ao Documento — Design Docs Gerados por IA

Este repositório é a entrega do desafio **"Da Reunião ao Documento: Design Docs Gerados por IA"**.
O enunciado original está preservado em [`DESAFIO.md`](./DESAFIO.md).

> ℹ️ **Nota:** este README documenta o *processo de produção* da entrega (requisito 6 do desafio).
> A seção [Ferramental de IA](#ferramental-de-ia--plugins-do-claude-code) registra o setup dos
> plugins; a seção [Processo de produção](#processo-de-produção) descreve a jornada de ponta a ponta.

---

## Ferramental de IA — Plugins do Claude Code

A produção dos design docs usa um marketplace próprio de plugins do Claude Code
([`Lucassamuel97/claude-plugins`](https://github.com/Lucassamuel97/claude-plugins)), embutido
neste repositório via **git subtree** em `.claude/plugins/claude-plugins`.

Plugins disponíveis:

| Plugin | Papel no desafio |
| --- | --- |
| `adrs-management` | Mapear o código, identificar e gerar os ADRs, e ligá-los entre si |
| `diagrams-generator` | Gerar diagramas C4 e Mermaid a partir do FDD |
| `project-analizer` | Análise arquitetural, deep-dive de componentes e auditoria de dependências |
| `development-guidelines` | Gerar guidelines de desenvolvimento por linguagem |

### Setup inicial (ao clonar este repositório)

Os arquivos dos plugins já vêm no clone (subtree), mas o **registro do marketplace** fica na
config pessoal do Claude Code (`~/.claude/`), fora do repo. Então, uma vez por máquina:

```
/plugin marketplace add .claude/plugins/claude-plugins
```

O `.claude/settings.json` versionado já habilita os 4 plugins — não é preciso reinstalar um a um.
Se necessário, aplique com:

```
/reload-plugins
```

### Atualizar os plugins

Quando o repositório `claude-plugins` for atualizado, puxe as mudanças com os atalhos do `Makefile`:

```bash
make pull-plugin                                 # puxa os arquivos novos (git subtree pull)
```

Depois, dentro do Claude Code:

```
/plugin marketplace update lucassamuel-plugins   # relê o marketplace
/reload-plugins                                  # aplica
```

Atalhos disponíveis no `Makefile`:

| Comando | O que faz |
| --- | --- |
| `make pull-plugin` | Puxa atualizações do repo `claude-plugins` para cá |
| `make push-plugin` | Envia mudanças feitas aqui de volta para o repo do plugin |
| `make help` | Lista os comandos |

---

## Processo de produção

> Seção viva — atualizada a cada fase concluída.

### Ferramentas de IA utilizadas

- **Claude Code (Opus 4.8)** — orquestração de todo o processo: leitura de código, análise da
  transcrição, geração e revisão crítica dos documentos, e commits.
- **Plugins do Claude Code** (marketplace `lucassamuel-plugins`):
  - `project-analizer` — `/generate-architectural-report` e deep-dive dos componentes tocados
    pela feature (Fase 0).
  - `adrs-management` — `/adr-generate` para formalizar os ADRs a partir de *potential ADRs*
    ancorados na fonte (Fase 1).
  - `diagrams-generator` — `/mermaid-generate` e `/c4-generate` sobre o FDD (Fase 3).
  - `development-guidelines` — instalado, não utilizado nesta entrega (fora do escopo documental).

### Workflow adotado

Ordem de produção seguindo a sugestão do desafio (decisões primeiro, PRD por último):

| Fase | Entregável | Como foi feito |
| --- | --- | --- |
| 0 | Base factual + análise de código | Extração manual das 6 decisões/requisitos da transcrição (com timestamps) + `/generate-architectural-report` e deep-dives dos componentes-chave (`changeStatus`, `AppError`, `requireRole`, máquina de estados). Relatórios em [`docs/agents/`](./docs/agents/). |
| 1 | 6 ADRs | *Seeds* ancorados na transcrição+código → `/adr-generate` (6 agentes em paralelo) → renumeração e cross-links. Em [`docs/adrs/`](./docs/adrs/). |
| 2 | RFC | Escrito a partir dos ADRs + base factual. [`docs/RFC.md`](./docs/RFC.md). |
| 3 | FDD + diagramas | Escrito a partir dos ADRs + deep-dives de código (contratos, matriz `WEBHOOK_*`, integração com 8 arquivos reais). [`docs/FDD.md`](./docs/FDD.md). Diagramas gerados pelo `diagrams-generator`: 7 Mermaid + 4 níveis C4 em [`docs/diagrams/`](./docs/diagrams/). |
| 4 | PRD | Consolidado a partir de RFC/FDD/ADRs, seguindo um esqueleto de PRD fornecido (prompt de entrevista). 10 requisitos funcionais, 4 objetivos com meta. [`docs/PRD.md`](./docs/PRD.md). |
| 5 | Tracker | Varredura dos documentos prontos: 67 itens rastreados (84% TRANSCRICAO com timestamp, 10 linhas CODIGO). [`docs/TRACKER.md`](./docs/TRACKER.md). |
| 6 | README de processo + revisão | Consolidação deste documento e checklist dos critérios de aceite item a item. |

**Princípio anti-alucinação:** nenhum item entra num documento sem origem rastreável à
transcrição (timestamp) ou ao código (caminho de arquivo). Uma base factual central
(`docs/adrs/context/base-factual.md`) serve de fonte da verdade compartilhada entre as fases.

### Iterações e ajustes

- **Fase 0 — escopo dos deep-dives.** O analisador arquitetural listou 41 componentes; rodar o
  deep-dive em todos seria custoso e irrelevante. Reduzi para os 4 que a feature realmente toca.
- **Fase 0 — contradição na transcrição.** `customer_id` foi dito "vem do JWT" [09:31] e logo
  corrigido para "vem do body/path" [09:32-09:33]. Prevaleceu a correção; registrado como nota.
- **Fase 1 — mismatch do plugin.** O fluxo padrão do `adrs-management` minera decisões do
  *código existente*, mas nossas decisões vêm da *reunião* sobre uma feature ainda não codada.
  Ajuste: escrevi os *potential ADRs* manualmente (ancorados na fonte) e usei o plugin só para
  formalizar em MADR.
- **Fase 1 — limpeza de `[NEEDS INPUT]`.** Os agentes deixaram marcadores de lacuna. Removi os
  redundantes (data de calendário) e converti os legítimos em "Ponto em aberto", sem inventar
  respostas — reaproveitados como "Questões em aberto" do RFC.
- **Fase 3 — armadilha de correção no FDD.** O deep-dive de `changeStatus` revelou que, no ponto
  de inserção da outbox, `order.status` ainda está com o valor antigo em memória. Documentei isso
  como nota crítica no FDD para o dev usar os parâmetros `from`/`to`, não reler o objeto.
- **Fase 4 — método do PRD.** Recebi um prompt de "entrevista" para PRD. Como toda a informação já
  estava coletada e rastreável, não fazia sentido entrevistar o usuário (arriscaria inventar). Usei
  o *esqueleto de saída* do prompt e populei a partir das fontes já validadas, marcando a única
  lacuna (disponibilidade) como hipótese.
- **Fase 5 — contagem do Tracker.** Minha estimativa inicial de linhas por fonte estava errada;
  validei por script (`grep`) e corrigi o resumo de cobertura para os números reais (56/10/1).

### Prompts customizados

**1. Geração de ADR ancorada na fonte (Fase 1).** Cada agente `adr-generator` recebeu um
*potential ADR* já escrito por mim (com timestamps e caminhos de código) mais esta instrução, que
foi o que garantiu ADRs rastreáveis e sem alucinação:

```
Generate formal ADR from docs/adrs/potential-adrs/must-document/WEBHOOKS/<seed>.md
with --language=pt-BR and --context-dir=docs/adrs/context

CRITICAL: Preserve every TRANSCRICAO timestamp citation (e.g. [09:06] Diego) and every
CODIGO file path exactly as they appear in the source seed. Do not invent requirements,
decisions, or constraints not present in the seed or the context dir. Output to
docs/adrs/generated/WEBHOOKS/ using placeholder XXX for numbering.
```

**2. Deep-dive dirigido de componente (Fase 0).** Em vez de pedir "analise o código", dirigi cada
agente ao ponto exato que a feature precisa, o que rendeu a localização precisa do hook da outbox:

```
Analyze ONLY the changeStatus method and its transactional flow in
src/modules/orders/order.service.ts. Do not modify any project files (read-only).
Document exactly where an outbox insert would need to hook into the existing
prisma.$transaction, and what arguments (tx client, order, fromStatus, toStatus) are
available at that point. Extract all business rules (state transitions, stock debit/
replenish, history append, transaction boundaries) with file/line-level citations.
```

**3. Filtro anti-alucinação para o PRD (Fase 4).** O esqueleto do PRD foi fornecido; a instrução
que apliquei sobre ele foi popular apenas com dados de origem rastreável e marcar defaults como
hipótese:

```
Preencha o esqueleto de PRD apenas com itens que tenham origem rastreável na transcrição
(timestamp + falante) ou no código (caminho de arquivo). Onde a reunião não decidiu um valor
(ex.: uptime), use um default e marque explicitamente como "hipótese". Não use travessões "—".
```

### Como navegar a entrega

Ordem de leitura sugerida (do "porquê" ao "como"):

1. [`DESAFIO.md`](./DESAFIO.md) — o enunciado original, para contexto.
2. [`docs/PRD.md`](./docs/PRD.md) — visão de produto: problema, público, escopo, requisitos.
3. [`docs/RFC.md`](./docs/RFC.md) — proposta técnica de alto nível, alternativas e questões em aberto.
4. [`docs/adrs/`](./docs/adrs/) — as 6 decisões arquiteturais isoladas (comece pelo
   [`README`](./docs/adrs/README.md) do diretório).
5. [`docs/FDD.md`](./docs/FDD.md) — o detalhe de implementação: contratos, erros, integração com
   o código, mais os [diagramas](./docs/diagrams/).
6. [`docs/TRACKER.md`](./docs/TRACKER.md) — a rastreabilidade de cada item à sua origem.

Material de apoio do processo: [`docs/agents/`](./docs/agents/) (relatórios de análise de código)
e `docs/adrs/context/` (base factual e transcrição usadas como fonte da verdade).

**Estrutura da entrega:**

```
.
├── README.md                    (este documento — o processo)
├── DESAFIO.md                   (enunciado original)
├── TRANSCRICAO.md               (transcrição da reunião)
├── Makefile                     (atalhos de atualização dos plugins)
├── docs/
│   ├── PRD.md  ·  PRD.json       (PRD em Markdown e export JSON)
│   ├── RFC.md
│   ├── FDD.md
│   ├── TRACKER.md
│   ├── adrs/                     (ADR-001..006 + mapping + context + potential-adrs)
│   ├── diagrams/                (7 Mermaid + 4 níveis C4)
│   └── agents/                  (relatórios de análise arquitetural/componentes)
└── .claude/plugins/             (marketplace de plugins via git subtree)
```
