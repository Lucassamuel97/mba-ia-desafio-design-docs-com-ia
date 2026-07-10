# Claude Marketplace

Uma coleção de plugins para o Claude Code voltados à **arquitetura de software** e à **documentação de design**. Os plugins automatizam tarefas como registrar decisões arquiteturais, gerar diagramas, analisar a arquitetura de projetos e produzir guias de desenvolvimento por linguagem.

## Plugins Disponíveis

Este marketplace oferece quatro plugins para documentação e análise arquitetural:

| Plugin | Descrição | Comandos |
|--------|-----------|----------|
| **[ADRs Management](./plugins/adrs-management/USAGE.md)** | Análise, geração e vinculação de Architecture Decision Records (ADRs) | `/adrs-management:adr-map`, `:adr-identify`, `:adr-generate`, `:adr-link` |
| **[Diagrams Generator](./plugins/diagrams-generator/USAGE.md)** | Geração de diagramas C4 (PlantUML) e Mermaid a partir de Feature Design Documents (FDDs) | `/diagrams-generator:c4-generate`, `:mermaid-generate` |
| **[Project Analyzer](./plugins/project-analizer/USAGE.md)** | Análise arquitetural completa, análise profunda de componentes e auditoria de dependências | `/project-analizer:generate-architectural-report`, `:run-dependency-audit` |
| **[Development Guidelines](./plugins/development-guidelines/USAGE.md)** | Geração de guias de desenvolvimento abrangentes e específicos por linguagem | `/development-guidelines:guidelines-generate` |

## Instalação

> Todos os comandos abaixo são executados **dentro do Claude Code no terminal** (rode `claude`). Em outros ambientes (extensões/IDE) o comando `/plugin` pode não estar disponível.

### Passo 1 — Adicionar o Marketplace

```bash
/plugin marketplace add Lucassamuel97/claude-plugins
```

Esse comando registra o repositório do GitHub como uma fonte de plugins. Você verá: `Successfully added marketplace: lucassamuel-plugins`.

> O identificador do marketplace (`lucassamuel-plugins`) é o campo `name` definido em [.claude-plugin/marketplace.json](.claude-plugin/marketplace.json) — **não** é o nome do repositório.

### Passo 2 — Instalar os Plugins

Instale apenas os que for usar (ou todos):

```bash
/plugin install adrs-management@lucassamuel-plugins
/plugin install diagrams-generator@lucassamuel-plugins
/plugin install project-analizer@lucassamuel-plugins
/plugin install development-guidelines@lucassamuel-plugins
```

### Passo 3 — Recarregar os Plugins (obrigatório)

Após instalar, os comandos **não ficam ativos imediatamente**. Recarregue:

```bash
/reload-plugins
```

> Se os comandos ainda não aparecerem após o `/reload-plugins`, feche e reabra o Claude Code (saia e rode `claude` novamente).

### Passo 4 — Usar os Comandos

Os comandos dos plugins são **namespaced pelo nome do plugin**, no formato `/<plugin>:<comando>`:

```bash
/diagrams-generator:mermaid-generate docs/features/FDD_Rate_Limiter.md
/adrs-management:adr-map
/project-analizer:generate-architectural-report
/development-guidelines:guidelines-generate Python
```

> **Dica**: digite `/` e comece a escrever o nome do comando (ex.: `/mer` ou `/diagrams`) para o autocomplete mostrar o nome/namespace exato com que cada comando foi registrado.

Para navegar pelos plugins instalados e seus comandos a qualquer momento:

```bash
/plugin
```

## Início Rápido

> Os comandos usam o prefixo do plugin (`/<plugin>:<comando>`). Se preferir, digite `/` e use o autocomplete para localizá-los.

### ADRs Management

Documente decisões arquiteturais de forma sistemática, seguindo um fluxo de 3 fases (mapear → identificar → gerar) com vinculação ao final:

```bash
/adrs-management:adr-map                 # Fase 1: mapeia a base de código em módulos lógicos
/adrs-management:adr-identify AUTH DATA  # Fase 2: identifica ADRs em potencial nos módulos
/adrs-management:adr-generate BILLING    # Fase 3: gera ADRs formais no formato MADR
/adrs-management:adr-link                # Vincula os ADRs com relacionamentos bidirecionais
```

Os ADRs podem ser gerados em vários idiomas (en, pt-BR, es, fr, de). O plugin aplica filtragem rigorosa — apenas cerca de 5% das descobertas viram ADRs — e usa o histórico do git para enriquecer o contexto temporal.

### Diagrams Generator

Crie documentação visual a partir de Feature Design Documents (FDDs):

```bash
/diagrams-generator:c4-generate docs/features/FDD_Rate_Limiter.md       # Diagramas C4 (C1–C4) em PlantUML
/diagrams-generator:mermaid-generate docs/features/FDD_Rate_Limiter.md  # Diagramas Mermaid (sequência, fluxo, classe, ER)
```

O idioma dos diagramas é detectado automaticamente a partir do FDD, mantendo os termos técnicos em inglês (Service, Gateway, Redis etc.). Nenhum diagrama é inventado quando o FDD não tem informação suficiente.

> Este repositório já inclui um FDD de exemplo em [docs/features/FDD_Rate_Limiter.md](docs/features/FDD_Rate_Limiter.md) (um SDK de rate limiting em Go) para você testar os comandos imediatamente.

### Project Analyzer

Analise a arquitetura e as dependências do projeto (somente leitura — não modifica o código):

```bash
/project-analizer:generate-architectural-report   # Relatório arquitetural completo + análise de componentes
/project-analizer:run-dependency-audit            # Auditoria de dependências (versões, CVEs, licenças)
```

Inclui três agentes especializados: análise arquitetural, análise profunda de componentes e auditoria de dependências. Componentes são analisados em paralelo para resultados mais rápidos.

### Development Guidelines

Gere guias de desenvolvimento abrangentes para qualquer linguagem de programação:

```bash
/development-guidelines:guidelines-generate Python
/development-guidelines:guidelines-generate TypeScript --orm=prisma --web=express --testing=jest
/development-guidelines:guidelines-generate Go --orm=sqlc --web=chi --db=pgx
```

O guia é focado na **linguagem** (não em frameworks específicos): as bibliotecas informadas via parâmetros são listadas em uma seção "Project Stack" apenas como referência, enquanto os exemplos de código usam a biblioteca padrão da linguagem.

## Fluxo Combinado

Os plugins se complementam. Um fluxo de trabalho típico:

```bash
# 1. Entenda a arquitetura do projeto
/project-analizer:generate-architectural-report

# 2. Documente as decisões arquiteturais relevantes
/adrs-management:adr-map
/adrs-management:adr-identify AUTH DATA API
/adrs-management:adr-generate --include-consider AUTH DATA API
/adrs-management:adr-link

# 3. Gere diagramas para os componentes-chave
/diagrams-generator:c4-generate docs/features/FDD_Rate_Limiter.md
```

## Documentação

Para instruções detalhadas de uso, consulte a documentação de cada plugin:

- [Guia de Uso — ADRs Management](./plugins/adrs-management/USAGE.md)
- [Guia de Uso — Diagrams Generator](./plugins/diagrams-generator/USAGE.md)
- [Guia de Uso — Project Analyzer](./plugins/project-analizer/USAGE.md)
- [Guia de Uso — Development Guidelines](./plugins/development-guidelines/USAGE.md)