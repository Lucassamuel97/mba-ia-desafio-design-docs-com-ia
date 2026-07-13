Da Reunião ao Documento: Design Docs Gerados por IA
Descrição
Neste desafio você vai transformar a transcrição de uma reunião técnica em um pacote completo de design docs, usando IA como ferramenta principal de produção.

Cenário: uma empresa que opera um Order Management System (OMS) em produção vai construir uma nova feature, um Sistema de Webhooks de Notificação de Pedidos. A decisão técnica já foi tomada em uma reunião entre tech lead, PM, engenheiros e segurança, mas nada foi registrado além da transcrição da call (TRANSCRICAO.md).

Sua tarefa: produzir, a partir da transcrição e do código existente, a documentação técnica da feature, em nível acionável o suficiente para o time de engenharia iniciar a implementação.

Sobre o uso de IA
A IA é sua ferramenta principal de produção neste desafio. Você vai usá-la para ler o código, analisar a transcrição, estruturar os documentos e gerar o conteúdo final. O que se espera de você é o papel de maestro: definir o que precisa ser feito, formular bons prompts, revisar criticamente o que a IA entrega, corrigir e refinar até o resultado ficar consistente.

Estrutura do desafio
O desafio tem duas partes, ambas obrigatórias:

Parte 1 (Pacote de design docs): produzir PRD, RFC, FDD, ADRs, Tracker e o README do processo a partir da transcrição e do código.
Parte 2 (Documentação viva em HTML): transformar o pacote em documentação que se mantém sincronizada com o código via IA. É a etapa final e mais técnica, e se constrói sobre a Parte 1.
Conclua a Parte 1 antes de começar a Parte 2. Os requisitos e critérios de aceite numerados a seguir são da Parte 1; a Parte 2 tem seção e critérios próprios, mais adiante.

Objetivo
Entregar, em um repositório público no GitHub (fork do repositório base), o seguinte pacote de documentação:

PRD (Product Requirement Document) da feature
RFC (Request for Comments) com a proposta técnica da solução, submetida à equipe para revisão
FDD (Feature Design Document) da feature
Entre 5 e 8 ADRs (Architecture Decision Records) das decisões discutidas
Tracker de rastreabilidade ligando cada item à origem na transcrição ou no código
README atualizado documentando o processo de produção
Documentação renderizada em HTML, com mecanismo de auto-atualização ancorado no código (Parte 2)
Toda informação registrada nos documentos deve ser rastreável à transcrição ou ao código fonte da aplicação. Não é permitido inventar requisitos, decisões ou restrições sem origem identificável.

O pacote de documentos e o papel de cada um
Os documentos não se repetem: cada um opera em uma altura diferente. Antes de produzir, entenda a fronteira entre eles: conteúdo duplicado entre documentos é sinal de que algo está no lugar errado.

Documento	Papel	Altura	Pergunta que responde
PRD	Problema, público, escopo e métricas de sucesso	Produto / negócio	Por que e o quê?
RFC	Proposta técnica da solução para revisão: abordagem geral, alternativas e questões em aberto	Arquitetura	Como pretendemos resolver, e o que ainda está em aberto?
ADRs	Cada decisão arquitetural isolada, com contexto e consequências	Decisão pontual	Por que decidimos exatamente assim?
FDD	Especificação de implementação: fluxos, contratos, erros, integração com o código	Implementação	Como construir, em detalhe?
Tracker	Rastreabilidade de cada item ao código ou à transcrição	Transversal	De onde veio cada coisa?
Em uma frase: o RFC propõe e abre para revisão, os ADRs registram cada decisão fechada e o FDD detalha como construir. O RFC é conciso (2 a 4 páginas) e fala em decisão; o FDD é profundo e fala em implementação. Não repita no RFC o nível de detalhe do FDD.

Contexto
A aplicação existente
O repositório base contém uma aplicação Node.js + TypeScript funcional: um Order Management System com módulos de autenticação, usuários, clientes, produtos e pedidos. Banco MySQL via Prisma. O ciclo de vida do pedido tem máquina de estados controlada, controle transacional de estoque e auditoria de mudanças de status.

A aplicação não tem nenhum mecanismo de notificação externa, eventos, filas ou webhooks. Esse vácuo é proposital. É exatamente o que a feature discutida na reunião pretende preencher.

Seus documentos vão precisar referenciar componentes do código existente, como a estrutura modular, a máquina de estados, a transação do changeStatus, as classes de erro, o padrão de códigos de erro, o middleware requireRole, o error middleware centralizado e o logger Pino. Use a IA para mapear esses pontos a partir do código.

A transcrição
O arquivo TRANSCRICAO.md contém a gravação literal da reunião técnica. Cinco participantes discutem por aproximadamente 55 minutos no formato [hh:mm] Nome: fala.

A transcrição inclui decisões fechadas, requisitos funcionais explícitos, restrições, ganchos com o código existente, pontos descartados ou adiados para fases futuras e detalhes técnicos secundários. Nem tudo que foi mencionado vira requisito. Algumas coisas foram explicitamente descartadas, outras foram adiadas. Identificar o que NÃO entra é tão importante quanto identificar o que entra. Use a IA com prompts dirigidos para fazer essa filtragem, não pedidos genéricos.

Tecnologias e ferramentas
Liberdade total na escolha de ferramentas de IA. Você pode usar qualquer combinação de Claude, ChatGPT, Cursor, Copilot Chat, Gemini, agentes, prompts customizados, skills ou plugins. Aproveite os prompts e plugins disponibilizados pelo professor durante o curso como ponto de partida.

Os documentos devem ser entregues em formato Markdown.

Na Parte 1, a entrega é puramente documental: você não deve mexer no código da aplicação (src/, prisma/, tests/, configurações). O código serve de contexto e referência. A Parte 2 tem uma exceção controlada e fornecida pelo próprio desafio (descrita na seção dela) e libera a criação de tooling de documentação (scripts, GitHub Actions, prompts, gerador de HTML), que não é código da aplicação.

Requisitos
1. PRD da feature
Produza o arquivo docs/PRD.md cobrindo a feature de Sistema de Webhooks de Notificação de Pedidos. O PRD deve seguir o formato apresentado no curso e incluir, no mínimo, as seguintes seções:

Resumo e contexto da feature
Problema e motivação
Público-alvo e cenários de uso
Objetivos e métricas de sucesso
Escopo (incluso e fora de escopo)
Requisitos funcionais
Requisitos não funcionais
Decisões e trade-offs principais
Dependências
Riscos e mitigação
Critérios de aceitação
Estratégia de testes e validação
A seção "Fora de escopo" deve listar explicitamente pelo menos 2 itens descartados ou adiados durante a reunião.

2. RFC da feature
Produza o arquivo docs/RFC.md com a proposta técnica da solução, no formato de um documento submetido à equipe para revisão. O RFC opera em nível de arquitetura: apresenta a abordagem escolhida, as alternativas que foram colocadas na mesa e as questões deixadas em aberto. É um documento conciso (2 a 4 páginas); o detalhamento de implementação fica no FDD. Deve seguir o formato apresentado no curso e incluir, no mínimo:

Metadados (autor, status, data, revisores); use os participantes da reunião como revisores
Resumo executivo (TL;DR) da proposta
Contexto e problema
Proposta técnica (visão geral da solução, sem descer ao detalhe de implementação do FDD)
Alternativas consideradas (pelo menos 2 alternativas reais discutidas e descartadas na reunião, cada uma com o trade-off que levou ao descarte)
Questões em aberto (pelo menos 2 pontos levantados na reunião e não decididos ou adiados)
Impacto e riscos
Decisões relacionadas (links para os ADRs correspondentes)
O RFC não deve duplicar o detalhamento do FDD. Ele responde "o que propomos e por quê"; o "como construir" em detalhe fica no FDD.

3. FDD da feature
Produza o arquivo docs/FDD.md detalhando o "como implementar" da feature. O FDD é o documento mais técnico e precisa estar acionável o suficiente para um desenvolvedor pegar e começar a codar. Deve seguir o formato apresentado no curso e incluir, no mínimo:

Contexto e motivação técnica
Objetivos técnicos
Escopo e exclusões
Fluxos detalhados (criação do evento na outbox, processamento pelo worker, retry, DLQ)
Contratos públicos (endpoints HTTP com payloads de exemplo, headers, status codes, semântica)
Matriz de erros previstos com códigos no padrão WEBHOOK_*
Estratégias de resiliência (timeouts, retries, backoff, fallback)
Observabilidade (métricas, logs, tracing)
Dependências e compatibilidade
Critérios de aceite técnicos
Riscos e mitigação
Seção obrigatória adicional, específica deste desafio: "Integração com o sistema existente". Esta seção deve nomear pelo menos 4 caminhos de arquivo reais do código base e descrever como o módulo de webhooks vai se integrar com cada um (por exemplo, como o método changeStatus será estendido, como as classes de erro existentes serão reutilizadas).

4. ADRs
Produza entre 5 e 8 ADRs em arquivos separados dentro de docs/adrs/, nomeados no formato ADR-NNN-titulo-em-kebab-case.md (ex: ADR-001-outbox-no-mysql.md).

Cada ADR deve seguir o formato MADR (ou variante padrão) com no mínimo as seções: Status, Contexto, Decisão, Alternativas Consideradas (pelo menos 1 alternativa real discutida ou plausível), Consequências (positivas e negativas, com trade-off explícito).

Pelo menos 1 ADR deve referenciar explicitamente arquivos, módulos ou padrões do código existente.

O conjunto de ADRs deve cobrir, no mínimo, 5 das 6 decisões principais discutidas na reunião:

Padrão Outbox no MySQL
Política de retry com backoff e DLQ
Autenticação HMAC-SHA256 com secret por endpoint
Garantia at-least-once com X-Event-Id
Worker em processo separado em polling
Reuso dos padrões existentes do projeto
Decisões técnicas secundárias (formato de payload, timeouts, headers, entre outras) podem virar ADRs adicionais ou ficar apenas no FDD, conforme você considerar mais adequado.

5. Tracker de Rastreabilidade
Produza o arquivo docs/TRACKER.md, uma tabela markdown que mapeia cada item registrado nos seus documentos à origem na transcrição ou no código. O tracker funciona como uma referência cruzada: permite que qualquer leitor entenda de onde veio cada decisão, requisito ou restrição, e garante que a documentação está alinhada com o que foi efetivamente discutido e com o que existe no código.

O tracker não é um conceito padrão do mercado nem é um documento abordado diretamente no curso. É uma exigência específica deste desafio que ajuda a manter a integridade da documentação contra alucinações da IA.

Formato obrigatório da tabela:

ID	Documento	Tipo	Conteúdo (resumo)	Fonte	Localização
Onde:

ID: identificador único do item (ex: PRD-FR-01, RFC-ALT-02, FDD-CONTRATO-03, ADR-002)
Documento: arquivo onde o item aparece (docs/PRD.md, docs/RFC.md, docs/FDD.md, docs/adrs/ADR-002-...md)
Tipo: Requisito Funcional, Requisito Não Funcional, Decisão, Restrição, Trade-off, entre outros
Conteúdo (resumo): descrição de uma linha do item
Fonte: TRANSCRICAO ou CODIGO
Localização: para TRANSCRICAO, timestamp + nome do falante (ex: [09:17] Diego). Para CODIGO, caminho do arquivo (ex: src/modules/orders/order.service.ts).
Cobertura mínima: pelo menos 80% dos itens identificáveis nos seus documentos devem ter linha correspondente no tracker.

6. README com o processo
O README.md na raiz do repositório base contém este enunciado. Substitua o conteúdo dele pela documentação do seu processo de produção. Você pode manter um link ou seção fazendo referência ao enunciado original se quiser, mas o foco do novo conteúdo é descrever sua jornada.

Estrutura obrigatória do novo README:

Sobre o desafio: 1 a 2 parágrafos descrevendo a tarefa em suas palavras
Ferramentas de IA utilizadas: lista das ferramentas que você usou, com breve nota sobre o papel de cada uma
Workflow adotado: como você organizou o trabalho. Em que ordem produziu os documentos, como organizou a interação com a IA
Prompts customizados: pelo menos 2 prompts relevantes que você escreveu ou adaptou, mostrados em blocos de código
Iterações e ajustes: descreva os principais momentos em que a IA gerou algo errado ou superficial e você teve que corrigir. Quantas iterações principais até chegar ao resultado final
Como navegar a entrega: caminho dos arquivos entregues e ordem sugerida de leitura
Critérios de Aceite
A entrega é avaliada contra os critérios abaixo. Todos são obrigatórios.

PRD (docs/PRD.md)
☐ Arquivo existe e está em Markdown
☐ Contém todas as seções obrigatórias listadas no requisito 1
☐ Identifica no mínimo 8 requisitos funcionais discutidos na reunião
☐ Inclui pelo menos 1 objetivo com métrica e meta quantitativa
☐ Seção "Fora de escopo" lista pelo menos 2 itens explicitamente descartados ou adiados na reunião
☐ Seção "Riscos" inclui pelo menos 2 riscos com probabilidade, impacto e mitigação
RFC (docs/RFC.md)
☐ Arquivo existe e está em Markdown
☐ Contém todas as seções obrigatórias listadas no requisito 2
☐ Seção "Alternativas consideradas" lista pelo menos 2 alternativas descartadas na reunião, cada uma com o trade-off que motivou o descarte
☐ Seção "Questões em aberto" lista pelo menos 2 pontos adiados ou não decididos na reunião
☐ Referencia, com link, pelo menos 2 ADRs do pacote
FDD (docs/FDD.md)
☐ Arquivo existe e está em Markdown
☐ Contém todas as seções obrigatórias listadas no requisito 3
☐ Seção "Contratos públicos" inclui pelo menos 4 endpoints HTTP com payload de exemplo (request e response) e status codes
☐ Matriz de erros usa códigos com prefixo WEBHOOK_
☐ Seção "Integração com o sistema existente" referencia pelo menos 4 caminhos de arquivo reais do código base
☐ Seção "Observabilidade" cita métricas, logs e tracing
ADRs (docs/adrs/ADR-NNN-*.md)
☐ Pasta docs/adrs/ contém entre 5 e 8 arquivos no formato ADR-NNN-titulo-em-kebab-case.md
☐ Cada ADR contém as seções Status, Contexto, Decisão, Alternativas Consideradas, Consequências
☐ O conjunto cobre pelo menos 5 das 6 decisões principais listadas no requisito 4
☐ Pelo menos 1 ADR referencia explicitamente arquivos, módulos ou classes do código base
Tracker (docs/TRACKER.md)
☐ Arquivo existe e segue o formato de tabela definido no requisito 5
☐ Pelo menos 80% dos itens identificáveis dos documentos têm linha correspondente
☐ Pelo menos 70% das linhas têm Fonte = TRANSCRICAO com timestamp válido no formato [hh:mm] Nome
☐ Pelo menos 5 linhas têm Fonte = CODIGO com caminho de arquivo real
README (README.md)
☐ Contém todas as seções obrigatórias listadas no requisito 6
☐ Lista pelo menos 1 ferramenta de IA utilizada
☐ Mostra pelo menos 2 prompts customizados em blocos de código
☐ Descreve pelo menos 2 iterações ou ajustes concretos feitos durante a produção
Consistência geral
☐ Nenhum requisito, decisão ou restrição registrada nos documentos contradiz a transcrição ou o código
☐ Nenhum arquivo de código mencionado nos documentos é inexistente no repositório
Parte 2: Documentação Viva em HTML
Esta é a etapa final do desafio e a mais técnica. Ela se constrói sobre o pacote da Parte 1, então só comece depois que a Parte 1 estiver completa e consistente.

Objetivo
Design docs envelhecem: o código muda e os documentos ficam para trás. Nesta parte você vai construir um mecanismo que mantém a documentação sincronizada com o código usando IA. O entregável tem três artefatos concretos e uma demonstração, descritos abaixo com exatidão; não há margem para interpretação sobre o que é esperado.

Artefato 1: Documentação em HTML (docs/site/)
Uma versão navegável em HTML do pacote da Parte 1, em docs/site/:

Gerada a partir dos arquivos Markdown da Parte 1 por um comando reproduzível (não escrita à mão).
Cobre os cinco documentos: PRD, RFC, FDD, ADRs e Tracker, navegáveis entre si.
Exibe de forma visível o hash do commit de origem (o mesmo do Artefato 2).
Artefato 2: Metadado de sincronização (docs/site/docs-meta.json)
Um arquivo JSON versionado que registra de qual ponto do código a documentação foi gerada. Campos obrigatórios:

{
  "source_commit": "<hash completo do HEAD no momento da geração>",
  "generated_at": "<timestamp ISO 8601>",
  "documents": ["docs/PRD.md", "docs/RFC.md", "docs/FDD.md", "docs/adrs/", "docs/TRACKER.md"]
}
O source_commit é a âncora de sincronização: ele afirma "esta documentação reflete o código neste commit".

Artefato 3: Mecanismo de auto-atualização
Um único ponto de entrada reproduzível (um script, ex.: npm run docs:update, ou um GitHub Action) com o código versionado no repositório. O contrato é fixo e deve executar exatamente estas etapas:

Etapa	O que faz
1. Lê a âncora	Lê source_commit de docs/site/docs-meta.json
2. Calcula o delta	Roda git diff <source_commit>..HEAD para descobrir os arquivos de código alterados
3. Direciona pelo Tracker	Usa as linhas do Tracker com Fonte = CODIGO para mapear arquivos alterados → itens de documento afetados
4. Atualiza com IA	Envia à IA apenas os trechos afetados + o diff, e aplica as atualizações nos Markdown correspondentes
5. Regenera e re-ancora	Regera o HTML e grava source_commit = HEAD em docs-meta.json
A etapa 3 é o que diferencia este mecanismo de uma regeneração cega: ele só mexe no que o código alterado de fato impacta. Documente, junto ao mecanismo, o comando exato para executá-lo.

Demonstração obrigatória (é assim que a Parte 2 é avaliada)
Você prova o mecanismo rodando-o sobre uma mudança de código conhecida, fornecida em fase-2/: uma nova transição na máquina de estados de pedidos, SHIPPED → CANCELLED (detalhes em fase-2/README.md). Crie uma seção "Demonstração da Parte 2" no README do processo registrando, nesta ordem:

Estado inicial: o source_commit gravado antes da mudança.
A mudança: a saída de git apply fase-2/order-status-change.patch e o commit resultante.
A execução: o comando que disparou o mecanismo e o log/saída dele.
O resultado: o diff dos documentos atualizados (trechos antes/depois) e o novo source_commit.
Como a mudança é conhecida, o resultado esperado é objetivo: depois da execução, os documentos precisam refletir que um pedido `SHIPPED` agora pode ser `CANCELLED`. Concretamente, ao menos o fluxo/contrato no FDD e o ADR da máquina de estados (e o evento/payload correspondente) devem mencionar essa nova transição, e nenhum documento pode continuar afirmando que SHIPPED só vai para DELIVERED.

Sobre a regra de não alterar o código
Aplicar o changeset da fase 2 é a única alteração de código permitida no desafio, é sancionada e fornecida por ele, e existe só para servir de gatilho desta demonstração. Fora isso, o código da aplicação (src/, prisma/, tests/) permanece intocado. Criar o tooling de documentação (gerador de HTML, script/Action de atualização, prompts) é parte esperada desta etapa.

Critérios de Aceite da Parte 2
☐ docs/site/ contém um HTML navegável gerado a partir dos Markdown da Parte 1, cobrindo PRD, RFC, FDD, ADRs e Tracker
☐ O HTML exibe de forma visível o hash do commit de origem
☐ docs/site/docs-meta.json existe e contém source_commit (hash real do repositório), generated_at e a lista de documentos
☐ O código do mecanismo de atualização está versionado e tem um ponto de entrada reproduzível e documentado (script ou Action)
☐ O mecanismo usa git diff <source_commit>..HEAD e o Tracker para direcionar a atualização, em vez de regenerar todos os documentos
☐ A seção "Demonstração da Parte 2" no README registra os quatro itens exigidos (estado inicial, mudança, execução, resultado), com diffs e saídas reais
☐ Após a demonstração, os documentos refletem a transição SHIPPED → CANCELLED e o source_commit gravado é igual ao commit que aplicou o changeset
Estrutura obrigatória do entregável
.
├── README.md                              (substituído pelo aluno)
├── TRANSCRICAO.md                         (não alterar)
├── fase-2/                                (changeset da Parte 2, fornecido pelo desafio)
│   ├── README.md
│   └── order-status-change.patch
├── docs/
│   ├── PRD.md                             (preenchido pelo aluno)
│   ├── RFC.md                             (preenchido pelo aluno)
│   ├── FDD.md                             (preenchido pelo aluno)
│   ├── TRACKER.md                         (preenchido pelo aluno)
│   ├── adrs/
│   │   ├── ADR-001-titulo-curto.md
│   │   ├── ADR-002-titulo-curto.md
│   │   ├── ADR-003-titulo-curto.md
│   │   ├── ADR-004-titulo-curto.md
│   │   ├── ADR-005-titulo-curto.md
│   │   └── ... (até 8 ADRs)
│   └── site/                              (Parte 2: HTML + docs-meta.json, gerados pelo aluno)
│       ├── index.html
│       └── docs-meta.json
├── src/                                   (não alterar, exceto o changeset da fase 2, na Parte 2)
├── prisma/                                (não alterar)
├── tests/                                 (não alterar)
└── ... (demais arquivos do boilerplate; o mecanismo de atualização da Parte 2, script ou Action, é versionado pelo aluno)
A entrega deve ser feita como repositório público no GitHub, a partir de fork do repositório base do desafio.

Repositório base
O repositório base do desafio contém a aplicação completa, a transcrição e a estrutura de pastas pra você preencher:

<link-do-repositorio-base-aqui>

Ordem de execução sugerida
Fork e setup: faça o fork do repositório base e clone localmente.
Contextualização com IA: forneça à IA acesso ao código (via Claude Code, Cursor lendo o repo, ou colando trechos relevantes) e à transcrição. Peça uma exploração inicial para entender estrutura, padrões e o que a feature precisa endereçar.
ADRs primeiro: identifique e produza as decisões principais antes dos demais documentos. As decisões formam o esqueleto do "como implementar".
RFC: consolide a proposta técnica em cima das decisões. As alternativas descartadas e as questões em aberto da reunião têm lugar natural aqui. Referencie os ADRs já escritos.
FDD: com as decisões formalizadas e a proposta consolidada, o desenho técnico se constrói em cima delas. Lembre da seção obrigatória "Integração com o sistema existente".
PRD: produza o PRD por último entre os grandes documentos. Como ele é mais alto nível, com RFC, FDD e ADRs em mãos vira praticamente uma consolidação.
Tracker: monte em paralelo com os outros documentos ou no fim, varrendo os documentos prontos.
README do processo: deixe por último, quando o processo já está completo e você pode documentá-lo com clareza.
Revisão final: passe pela checklist de critérios de aceite item por item antes do push final.
Itere: é esperado que o processo demande 3 a 5 ciclos de geração, revisão crítica, ajuste de prompt e nova geração. Se você gerou tudo de primeira sem ajustes, os documentos provavelmente estão genéricos demais.
Parte 2 (Documentação viva): depois da Parte 1 fechada, renderize o pacote em HTML, monte o mecanismo de auto-atualização e rode a demonstração com o changeset da fase 2.
Dicas Finais
A qualidade do prompt determina a qualidade do documento. Prompts vagos do tipo "gere um PRD a partir dessa transcrição" produzem documentos vazios e genéricos. Aproveite os prompts disponibilizados pelo professor no curso como base e adapte-os ao contexto deste desafio.

O tracker é seu melhor aliado contra alucinações da IA. Se você não consegue preencher a coluna "Localização" para uma linha do PRD ou do FDD, é sinal de que aquela informação não tem origem identificável e provavelmente foi inventada pela IA. Ajuste ou remova.

Cuidado com o que NÃO entra na documentação. A reunião descarta explicitamente algumas ideias. Se essas coisas aparecerem como requisito nos seus documentos, é sinal de que a IA não está sendo cuidadosa com o que você pediu.

Na Parte 1, a restrição de não alterar o código da aplicação é absoluta: o código serve de contexto e referência, e o entregável é puramente documental. A única exceção em todo o desafio é o changeset sancionado da fase 2, aplicado apenas na Parte 2.

Itere bastante. Os primeiros documentos que a IA gerar provavelmente serão superficiais ou redundantes. Volte com correções, peça refinamento de pontos específicos, peça para remover trechos vagos, peça exemplos concretos. O resultado final deve parecer escrito por alguém que pensou no problema com a IA ao lado, não por alguém que copiou e colou da transcrição.