# Desafio: Da Reunião ao Documento — Design Docs Gerados por IA

Este repositório é a entrega do desafio **"Da Reunião ao Documento: Design Docs Gerados por IA"**.
O enunciado original está preservado em [`DESAFIO.md`](./DESAFIO.md).

> ℹ️ **Nota:** este README documenta o *processo de produção* da entrega (requisito 6 do desafio)
> e será expandido conforme os documentos forem sendo produzidos. Por enquanto ele registra o
> setup do ferramental de IA utilizado.

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
  transcrição, geração e revisão dos documentos.
- **Plugins do Claude Code** (marketplace `lucassamuel-plugins`):
  - `project-analizer` — mapeamento arquitetural e deep-dive dos componentes tocados pela feature.
  - `adrs-management` — geração formal dos ADRs a partir de *potential ADRs* ancorados na fonte.
  - `diagrams-generator` — (Fase FDD) diagramas C4 e Mermaid.

### Workflow adotado

Ordem de produção seguindo a sugestão do desafio (decisões primeiro, PRD por último):

| Fase | Entregável | Como foi feito |
| --- | --- | --- |
| 0 | Base factual + análise de código | Extração manual das 6 decisões/requisitos da transcrição (com timestamps) + `/generate-architectural-report` e deep-dives dos componentes-chave (`changeStatus`, `AppError`, `requireRole`, máquina de estados). Relatórios em [`docs/agents/`](./docs/agents/). |
| 1 | 6 ADRs | *Seeds* ancorados na transcrição+código → `/adr-generate` (6 agentes em paralelo) → renumeração e cross-links. Em [`docs/adrs/`](./docs/adrs/). |
| 2 | RFC | Escrito a partir dos ADRs + base factual. [`docs/RFC.md`](./docs/RFC.md). |
| 3 | FDD + diagramas | Escrito a partir dos ADRs + deep-dives de código (contratos, matriz `WEBHOOK_*`, integração com 8 arquivos reais). [`docs/FDD.md`](./docs/FDD.md). Diagramas gerados pelo `diagrams-generator`: 7 Mermaid + 4 níveis C4 em [`docs/diagrams/`](./docs/diagrams/). |
| 4 | PRD | Consolidado a partir de RFC/FDD/ADRs, seguindo um esqueleto de PRD fornecido (prompt de entrevista). 10 requisitos funcionais, 4 objetivos com meta. [`docs/PRD.md`](./docs/PRD.md). |
| 5 | Tracker | _(pendente)_ |
| 6 | README de processo | _(este documento)_ |

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

### Prompts customizados

_(a consolidar na Fase 6 — ver os prompts de geração de ADR e de análise usados nas Fases 0-1)_

### Como navegar a entrega

_(ordem de leitura sugerida — a consolidar na Fase 6)_
