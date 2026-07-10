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

_A ser preenchido ao longo do desafio (workflow, prompts customizados, iterações e como navegar a entrega)._
