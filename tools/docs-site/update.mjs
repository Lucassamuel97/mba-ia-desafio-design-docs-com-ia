// Mecanismo de auto-atualização da documentação viva.
// Uso: node tools/docs-site/update.mjs   (ou: npm run docs:update)
//
// Contrato fixo (5 etapas):
//   1. Lê source_commit de docs/site/docs-meta.json
//   2. Roda git diff <source_commit>..HEAD para achar arquivos de CÓDIGO alterados
//   3. Usa as linhas do Tracker com Fonte = CODIGO para mapear
//      arquivo alterado -> itens de documento afetados
//   4. Envia à IA APENAS os trechos afetados + o diff e aplica as atualizações
//      nos Markdown (ver observação abaixo sobre a etapa de IA)
//   5. Regenera o HTML e re-ancora (source_commit = HEAD) rodando o build
//
// Sobre a etapa 4: a aplicação das edições é feita por IA. Este script prepara
// o "plano de atualização" determinístico (etapas 1-3) e o grava em
// docs/site/update-plan.json — é exatamente o contexto mínimo (trechos afetados
// + diff) que vai para a IA. Se a variável de ambiente USE_CLAUDE=1 estiver
// definida e o CLI `claude` existir, o script dispara a IA em modo headless;
// caso contrário, para após a etapa 3 para que a IA (ou o operador) aplique as
// edições e então re-rode o build (etapa 5). Isso mantem o mecanismo
// reproduzível sem exigir uma chave de API embutida.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const META = path.join(ROOT, 'docs', 'site', 'docs-meta.json');
const TRACKER = path.join(ROOT, 'docs', 'TRACKER.md');

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT }).toString();
}

// Etapa 1: âncora
if (!fs.existsSync(META)) {
  console.error('docs/site/docs-meta.json não existe. Rode primeiro: node tools/docs-site/build.mjs');
  process.exit(1);
}
const meta = JSON.parse(fs.readFileSync(META, 'utf8'));
const source = meta.source_commit;
const head = sh('git rev-parse HEAD').trim();
console.log(`[1] Âncora: source_commit=${source.slice(0, 7)}  HEAD=${head.slice(0, 7)}`);

if (source === head) {
  console.log('Nada a fazer: documentação já ancorada no HEAD.');
  process.exit(0);
}

// Etapa 2: delta de código
const changed = sh(`git diff --name-only ${source}..${head}`)
  .split('\n')
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((f) => f.startsWith('src/') || f.startsWith('prisma/') || f.startsWith('tests/'));
console.log(`[2] Arquivos de código alterados (${changed.length}):`);
changed.forEach((f) => console.log(`    - ${f}`));

// Etapa 3: direciona pelo Tracker (linhas com Fonte = CODIGO)
function parseTrackerCodigoRows() {
  const rows = [];
  for (const line of fs.readFileSync(TRACKER, 'utf8').split('\n')) {
    if (!line.includes('| CODIGO |')) continue;
    const cells = line.split('|').map((c) => c.trim());
    // | ID | Documento | Tipo | Conteúdo | Fonte | Localização |
    if (cells.length < 8) continue;
    rows.push({
      id: cells[1],
      documento: cells[2],
      tipo: cells[3],
      conteudo: cells[4],
      localizacao: cells[6],
    });
  }
  return rows;
}
const codigoRows = parseTrackerCodigoRows();

const affected = [];
for (const file of changed) {
  const matches = codigoRows.filter((r) => r.localizacao === file);
  for (const m of matches) affected.push({ file, ...m });
}
console.log(`[3] Itens de documento afetados via Tracker (${affected.length}):`);
affected.forEach((a) => console.log(`    - ${a.id} (${a.documento}) <- ${a.file}`));

const affectedDocs = [...new Set(affected.map((a) => a.documento))];

// Coleta os diffs dos arquivos afetados (contexto mínimo para a IA)
const diffByFile = {};
for (const file of changed) {
  try {
    diffByFile[file] = sh(`git diff ${source}..${head} -- ${file}`);
  } catch {
    diffByFile[file] = '';
  }
}

const plan = {
  source_commit: source,
  head_commit: head,
  changed_files: changed,
  affected_items: affected,
  affected_documents: affectedDocs,
  diffs: diffByFile,
  instruction:
    'Atualize APENAS os documentos e itens listados em affected_items para refletir as ' +
    'mudanças de código em diffs. Não regenere documentos não afetados. Preserve o estilo, ' +
    'a rastreabilidade (timestamps/caminhos) e não invente conteúdo sem origem no diff.',
};
const planPath = path.join(ROOT, 'docs', 'site', 'update-plan.json');
fs.writeFileSync(planPath, JSON.stringify(plan, null, 2) + '\n');
console.log(`[4] Plano de atualização (contexto p/ IA) gravado em docs/site/update-plan.json`);

if (affected.length === 0) {
  console.log('    Nenhum item de documento afetado pelo Tracker. Nada para a IA aplicar.');
}

// Etapa 4 (opcional): dispara a IA em modo headless se solicitado e disponível
let aiApplied = false;
if (process.env.USE_CLAUDE === '1' && affected.length > 0) {
  try {
    sh('command -v claude');
    console.log('    USE_CLAUDE=1: aplicando edições via CLI `claude -p`...');
    const prompt =
      'Você é um mantenedor de documentação. Leia docs/site/update-plan.json e aplique ' +
      'as edições necessárias APENAS nos documentos em affected_documents, refletindo os ' +
      'diffs. Não toque em documentos não afetados. Depois, não rode nenhum build.';
    execSync(`claude -p ${JSON.stringify(prompt)}`, { cwd: ROOT, stdio: 'inherit' });
    aiApplied = true;
  } catch {
    console.log('    CLI `claude` indisponível; pulei a aplicação automática.');
  }
}

if (!aiApplied && affected.length > 0) {
  console.log(
    '\n>> Etapa de IA pendente: aplique as edições descritas em docs/site/update-plan.json\n' +
      '   nos documentos afetados e então rode: node tools/docs-site/build.mjs (etapa 5).',
  );
  process.exit(0);
}

// Etapa 5: regenera o HTML e re-ancora (o build lê o HEAD atual)
console.log('[5] Regenerando o HTML e re-ancorando em HEAD...');
execSync('node tools/docs-site/build.mjs', { cwd: ROOT, stdio: 'inherit' });
console.log('Concluído.');
