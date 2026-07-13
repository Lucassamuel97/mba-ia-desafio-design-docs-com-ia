// Conversor Markdown -> HTML, sem dependências externas.
// Cobre o subconjunto usado nos design docs: headings, parágrafos, listas
// (com aninhamento), tabelas, code fences (incl. mermaid), blockquotes, hr,
// links, negrito, itálico e code inline. Não é um parser CommonMark completo.

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function slugify(text) {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

function inline(text, resolveLink) {
  // Tokeniza separando os code spans; só o texto fora de `code` recebe
  // processamento de links/negrito/itálico.
  const parts = text.split(/(`[^`]+`)/g);
  return parts
    .map((part) => {
      if (part.length >= 2 && part.startsWith('`') && part.endsWith('`')) {
        return `<code>${escapeHtml(part.slice(1, -1))}</code>`;
      }
      let t = escapeHtml(part);
      t = t.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (m, txt, u) => {
        const href = resolveLink ? resolveLink(u) : u;
        return `<a href="${href}">${txt}</a>`;
      });
      t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
      t = t.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
      return t;
    })
    .join('');
}

function isTableSeparator(line) {
  return /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line) && line.includes('-');
}

function splitRow(line) {
  return line
    .trim()
    .replace(/^\|/, '')
    .replace(/\|$/, '')
    .split('|')
    .map((s) => s.trim());
}

function buildList(items, resolveLink) {
  let idx = 0;
  function build() {
    const baseIndent = items[idx].indent;
    const ordered = /\d+\./.test(items[idx].marker);
    let out = ordered ? '<ol>' : '<ul>';
    while (idx < items.length && items[idx].indent >= baseIndent) {
      if (items[idx].indent > baseIndent) {
        out += build();
        continue;
      }
      const it = items[idx];
      idx++;
      let li = `<li>${inline(it.text, resolveLink)}`;
      if (idx < items.length && items[idx].indent > baseIndent) {
        li += build();
      }
      li += '</li>';
      out += li;
    }
    out += ordered ? '</ol>' : '</ul>';
    return out;
  }
  return build();
}

export function mdToHtml(markdown, { resolveLink } = {}) {
  const lines = markdown.replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let i = 0;
  const listRe = /^(\s*)([-*+]|\d+\.)\s+(.*)$/;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === '') {
      i++;
      continue;
    }

    // code fence
    const fence = line.match(/^```\s*([a-zA-Z0-9]*)\s*$/);
    if (fence) {
      const lang = fence[1];
      const buf = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i])) {
        buf.push(lines[i]);
        i++;
      }
      i++;
      const code = buf.join('\n');
      if (lang === 'mermaid') {
        out.push(`<pre class="mermaid">${escapeHtml(code)}</pre>`);
      } else {
        const cls = lang ? ` class="language-${lang}"` : '';
        out.push(`<pre><code${cls}>${escapeHtml(code)}</code></pre>`);
      }
      continue;
    }

    // heading
    const h = line.match(/^(#{1,6})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      out.push(`<h${level} id="${slugify(text)}">${inline(text, resolveLink)}</h${level}>`);
      i++;
      continue;
    }

    // hr
    if (/^\s*(---+|\*\*\*+|___+)\s*$/.test(line)) {
      out.push('<hr>');
      i++;
      continue;
    }

    // tabela
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      const header = splitRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].includes('|') && lines[i].trim() !== '') {
        rows.push(splitRow(lines[i]));
        i++;
      }
      let t = '<div class="table-wrap"><table><thead><tr>';
      t += header.map((c) => `<th>${inline(c, resolveLink)}</th>`).join('');
      t += '</tr></thead><tbody>';
      for (const r of rows) {
        t += '<tr>' + r.map((c) => `<td>${inline(c, resolveLink)}</td>`).join('') + '</tr>';
      }
      t += '</tbody></table></div>';
      out.push(t);
      continue;
    }

    // blockquote
    if (/^\s*>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*>\s?/, ''));
        i++;
      }
      out.push(`<blockquote>${mdToHtml(buf.join('\n'), { resolveLink })}</blockquote>`);
      continue;
    }

    // lista
    if (listRe.test(line)) {
      const items = [];
      while (i < lines.length && listRe.test(lines[i])) {
        const m = lines[i].match(listRe);
        items.push({ indent: m[1].length, marker: m[2], text: m[3] });
        i++;
      }
      out.push(buildList(items, resolveLink));
      continue;
    }

    // parágrafo
    const buf = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^(#{1,6})\s/.test(lines[i]) &&
      !/^```/.test(lines[i]) &&
      !/^\s*>\s?/.test(lines[i]) &&
      !listRe.test(lines[i]) &&
      !/^\s*(---+|\*\*\*+|___+)\s*$/.test(lines[i]) &&
      !(lines[i].includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1]))
    ) {
      buf.push(lines[i]);
      i++;
    }
    if (buf.length) {
      out.push(`<p>${inline(buf.join(' '), resolveLink)}</p>`);
    }
  }

  return out.join('\n');
}
