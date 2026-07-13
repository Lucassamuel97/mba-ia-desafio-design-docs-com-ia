// Gera o site HTML navegável (docs/site/) a partir dos Markdown dos design docs,
// grava docs/site/docs-meta.json com o commit de origem e mostra o hash na página.
// Uso: node tools/docs-site/build.mjs   (ou: npm run docs:build)
// Sem dependências externas.

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mdToHtml } from './md.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const SITE = path.join(ROOT, 'docs', 'site');

function sh(cmd) {
  return execSync(cmd, { cwd: ROOT }).toString().trim();
}

function repoWebUrl() {
  let url = '';
  try {
    url = sh('git remote get-url origin');
  } catch {
    return null;
  }
  url = url
    .replace(/^git@github\.com:/, 'https://github.com/')
    .replace(/^git@/, 'https://')
    .replace(/\.git$/, '');
  return url;
}

const FULL_HASH = sh('git rev-parse HEAD');
const SHORT_HASH = FULL_HASH.slice(0, 7);
const REPO_URL = repoWebUrl();
const GENERATED_AT = new Date().toISOString();

// Descobre os ADRs
const adrsDir = path.join(ROOT, 'docs', 'adrs');
const adrFiles = fs
  .readdirSync(adrsDir)
  .filter((f) => /^ADR-\d+-.*\.md$/.test(f))
  .sort();

// Mapa: caminho md (repo-relative, posix) -> caminho de saída no site
const linkMap = new Map([
  ['docs/PRD.md', 'prd.html'],
  ['docs/RFC.md', 'rfc.html'],
  ['docs/FDD.md', 'fdd.html'],
  ['docs/TRACKER.md', 'tracker.html'],
  ['docs/adrs/README.md', 'adrs/index.html'],
  ['docs/adrs', 'adrs/index.html'],
  ['docs/adrs/', 'adrs/index.html'],
  ['docs/diagrams/webhooks-diagrams.md', 'diagrams.html'],
]);
for (const f of adrFiles) {
  const num = f.match(/^ADR-(\d+)/)[1];
  linkMap.set(`docs/adrs/${f}`, `adrs/adr-${num}.html`);
}

// Navegação principal
const NAV = [
  { out: 'index.html', label: 'Início' },
  { out: 'prd.html', label: 'PRD' },
  { out: 'rfc.html', label: 'RFC' },
  { out: 'fdd.html', label: 'FDD' },
  { out: 'adrs/index.html', label: 'ADRs' },
  { out: 'tracker.html', label: 'Tracker' },
  { out: 'diagrams.html', label: 'Diagramas' },
];

function relUrl(fromOut, toOut) {
  const rel = path.posix.relative(path.posix.dirname(fromOut), toOut);
  return rel === '' ? path.posix.basename(toOut) : rel;
}

function makeResolveLink(fromSrc, fromOut) {
  const fromDir = path.posix.dirname(fromSrc);
  return (url) => {
    if (/^(https?:|mailto:|#)/.test(url)) return url;
    const [rawPath, hash] = url.split('#');
    let target = path.posix.normalize(path.posix.join(fromDir, rawPath));
    target = target.replace(/^\.\//, '');
    const noSlash = target.replace(/\/$/, '');
    const hit = linkMap.get(target) || linkMap.get(noSlash);
    if (hit) return relUrl(fromOut, hit) + (hash ? `#${hash}` : '');
    // fallback: aponta para o arquivo/pasta no GitHub
    if (REPO_URL) {
      const kind = /\.[a-z0-9]+$/i.test(noSlash) ? 'blob' : 'tree';
      return `${REPO_URL}/${kind}/main/${noSlash}`;
    }
    return url;
  };
}

function layout({ title, out, bodyHtml, isDiagrams }) {
  const navHtml = NAV.map((n) => {
    const active = n.out === out ? ' class="active"' : '';
    return `<a href="${relUrl(out, n.out)}"${active}>${n.label}</a>`;
  }).join('');
  const commitLink = REPO_URL
    ? `<a href="${REPO_URL}/commit/${FULL_HASH}" title="commit de origem">${SHORT_HASH}</a>`
    : SHORT_HASH;
  const mermaid = isDiagrams
    ? `<script type="module">import mermaid from 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs';mermaid.initialize({startOnLoad:true,theme:(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'default')});</script>`
    : '';
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title} · Design Docs Webhooks</title>
<style>${CSS}</style>
</head>
<body>
<header class="topbar">
  <div class="brand">Design Docs · <span>Webhooks de Notificação de Pedidos</span></div>
  <nav class="nav">${navHtml}</nav>
  <div class="commit">gerado do commit <code>${commitLink}</code></div>
</header>
<main class="content">
${bodyHtml}
</main>
<footer class="foot">
  Documentação viva gerada por <code>tools/docs-site/build.mjs</code> ·
  commit de origem <code>${SHORT_HASH}</code> · ${GENERATED_AT}
</footer>
${mermaid}
</body>
</html>`;
}

const CSS = `
:root{--bg:#ffffff;--fg:#1b1f24;--muted:#5b6570;--line:#e3e8ee;--accent:#2563eb;--code-bg:#f4f6f8;--th:#f0f4f9;}
@media (prefers-color-scheme: dark){:root{--bg:#0f1216;--fg:#e6e9ee;--muted:#9aa4af;--line:#252b33;--accent:#6ea8fe;--code-bg:#161b22;--th:#181f27;}}
*{box-sizing:border-box}
body{margin:0;font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;color:var(--fg);background:var(--bg)}
.topbar{position:sticky;top:0;z-index:10;background:var(--bg);border-bottom:1px solid var(--line);padding:.6rem 1rem;display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center}
.brand{font-weight:700}.brand span{color:var(--muted);font-weight:500}
.nav{display:flex;flex-wrap:wrap;gap:.25rem;margin-left:auto}
.nav a{padding:.3rem .7rem;border-radius:6px;text-decoration:none;color:var(--fg);font-weight:500}
.nav a:hover{background:var(--code-bg)}
.nav a.active{background:var(--accent);color:#fff}
.commit{width:100%;color:var(--muted);font-size:.85rem}
.commit code a{color:var(--accent);text-decoration:none}
.content{max-width:900px;margin:0 auto;padding:1.5rem 1rem 3rem}
.content h1{font-size:1.9rem;border-bottom:2px solid var(--line);padding-bottom:.3rem;margin-top:1.5rem}
.content h2{font-size:1.4rem;border-bottom:1px solid var(--line);padding-bottom:.2rem;margin-top:2rem}
.content h3{font-size:1.15rem;margin-top:1.6rem}
.content h4{font-size:1rem;margin-top:1.3rem;color:var(--muted)}
a{color:var(--accent)}
code{background:var(--code-bg);padding:.12em .4em;border-radius:4px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:.88em}
pre{background:var(--code-bg);padding:1rem;border-radius:8px;overflow-x:auto;border:1px solid var(--line)}
pre code{background:none;padding:0}
pre.mermaid{background:var(--bg);text-align:center}
blockquote{border-left:4px solid var(--accent);margin:1rem 0;padding:.3rem 1rem;color:var(--muted);background:var(--code-bg);border-radius:0 6px 6px 0}
.table-wrap{overflow-x:auto;margin:1rem 0}
table{border-collapse:collapse;width:100%;font-size:.92rem}
th,td{border:1px solid var(--line);padding:.5rem .6rem;text-align:left;vertical-align:top}
th{background:var(--th)}
hr{border:none;border-top:1px solid var(--line);margin:2rem 0}
ul,ol{padding-left:1.4rem}
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:1rem;margin:1.5rem 0}
.card{border:1px solid var(--line);border-radius:10px;padding:1rem;text-decoration:none;color:var(--fg);display:block}
.card:hover{border-color:var(--accent)}
.card h3{margin:.2rem 0}.card p{color:var(--muted);margin:.2rem 0 0;font-size:.9rem}
.foot{max-width:900px;margin:0 auto;padding:1rem;border-top:1px solid var(--line);color:var(--muted);font-size:.85rem}
`;

function writeFile(rel, html) {
  const dest = path.join(SITE, rel);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, html);
}

function renderDoc({ src, out, title, isDiagrams }) {
  const md = fs.readFileSync(path.join(ROOT, src), 'utf8');
  const body = mdToHtml(md, { resolveLink: makeResolveLink(src, out) });
  writeFile(out, layout({ title, out, bodyHtml: body, isDiagrams }));
}

// Limpa e recria o site
fs.rmSync(SITE, { recursive: true, force: true });
fs.mkdirSync(SITE, { recursive: true });

const generated = [];

// Landing page
const adrCards = adrFiles
  .map((f) => {
    const num = f.match(/^ADR-(\d+)/)[1];
    const first = fs.readFileSync(path.join(adrsDir, f), 'utf8').split('\n')[0].replace(/^#\s*/, '');
    return { num, title: first, href: `adrs/adr-${num}.html` };
  });
const indexBody = `
<h1>Design Docs — Sistema de Webhooks de Notificação de Pedidos</h1>
<p>Documentação técnica da feature, gerada a partir da transcrição da reunião e do código do OMS.
Esta é a versão navegável (documentação viva) do pacote de design docs. Commit de origem:
<code>${REPO_URL ? `<a href="${REPO_URL}/commit/${FULL_HASH}">${SHORT_HASH}</a>` : SHORT_HASH}</code>.</p>
<div class="cards">
  <a class="card" href="prd.html"><h3>PRD</h3><p>Produto: por quê e o quê.</p></a>
  <a class="card" href="rfc.html"><h3>RFC</h3><p>Proposta técnica, alternativas e questões em aberto.</p></a>
  <a class="card" href="fdd.html"><h3>FDD</h3><p>Como construir: contratos, erros, integração.</p></a>
  <a class="card" href="adrs/index.html"><h3>ADRs</h3><p>As 6 decisões arquiteturais.</p></a>
  <a class="card" href="tracker.html"><h3>Tracker</h3><p>Rastreabilidade de cada item à origem.</p></a>
  <a class="card" href="diagrams.html"><h3>Diagramas</h3><p>Fluxos e modelo de dados (Mermaid).</p></a>
</div>
<h2>ADRs</h2>
<div class="cards">
${adrCards.map((a) => `  <a class="card" href="${a.href}"><h3>ADR-${a.num}</h3><p>${a.title.replace(/^ADR-\d+:\s*/, '')}</p></a>`).join('\n')}
</div>`;
writeFile('index.html', layout({ title: 'Início', out: 'index.html', bodyHtml: indexBody }));
generated.push('index.html');

// Documentos principais
for (const d of [
  { src: 'docs/PRD.md', out: 'prd.html', title: 'PRD' },
  { src: 'docs/RFC.md', out: 'rfc.html', title: 'RFC' },
  { src: 'docs/FDD.md', out: 'fdd.html', title: 'FDD' },
  { src: 'docs/TRACKER.md', out: 'tracker.html', title: 'Tracker' },
  { src: 'docs/adrs/README.md', out: 'adrs/index.html', title: 'ADRs' },
  { src: 'docs/diagrams/webhooks-diagrams.md', out: 'diagrams.html', title: 'Diagramas', isDiagrams: true },
]) {
  renderDoc(d);
  generated.push(d.out);
}

// ADRs individuais
for (const f of adrFiles) {
  const num = f.match(/^ADR-(\d+)/)[1];
  renderDoc({ src: `docs/adrs/${f}`, out: `adrs/adr-${num}.html`, title: `ADR-${num}` });
  generated.push(`adrs/adr-${num}.html`);
}

// Metadado de sincronização
const meta = {
  source_commit: FULL_HASH,
  generated_at: GENERATED_AT,
  documents: ['docs/PRD.md', 'docs/RFC.md', 'docs/FDD.md', 'docs/adrs/', 'docs/TRACKER.md'],
};
fs.writeFileSync(path.join(SITE, 'docs-meta.json'), JSON.stringify(meta, null, 2) + '\n');
generated.push('docs-meta.json');

// .nojekyll para o GitHub Pages não processar o conteúdo
fs.writeFileSync(path.join(SITE, '.nojekyll'), '');

console.log(`Site gerado em docs/site/ (${generated.length} arquivos), commit ${SHORT_HASH}`);
console.log(generated.map((g) => `  - docs/site/${g}`).join('\n'));
