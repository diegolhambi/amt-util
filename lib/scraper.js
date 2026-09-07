/**
 * lib/scraper.js
 * Scraping das páginas do Intel AMT WebUI → dados estruturados puros.
 * Implementação nativa rápida sem dependências externas (sem Cheerio).
 */

import { get, post } from './client.js';

// ─── HTML Helpers ─────────────────────────────────────────────────────────────

function decodeHtml(str) {
  return str
    .replace(/&nbsp;|\u00a0/g, ' ')
    .replace(/&#x2F;/g, '/')
    .replace(/&reg;/g, '®')
    .replace(/&trade;/g, '™')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function cleanText(str) {
  if (!str) return '';
  return decodeHtml(str.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getStatus() {
  const { status, data } = await get('/index.htm');
  if (status !== 200) throw new Error(`HTTP ${status}`);

  const result = {};

  const compMatch = data.match(/<p[^>]*class=["']?top2["']?[^>]*>([\s\S]*?)<\/p>/i);
  if (compMatch) {
    const compText = cleanText(compMatch[1]).replace(/^Computer:\s*/i, '').trim();
    if (compText) result.computer = compText;
  }

  const tdRegex = /<td[^>]*class=["']?r1["']?[^>]*>([\s\S]*?)<\/td>/gi;
  const cells = [];
  let m;
  while ((m = tdRegex.exec(data)) !== null) {
    const text = cleanText(m[1]);
    if (text) cells.push(text);
  }

  for (let i = 0; i < cells.length - 1; i += 2) {
    if (cells[i].includes('Refresh') || cells[i + 1].includes('Refresh')) continue;
    const key = cells[i].replace(/:$/, '').toLowerCase().replace(/\s+/g, '_');
    result[key] = cells[i + 1];
  }

  return result;
}

// ─── Remote / Power ───────────────────────────────────────────────────────────

export async function getRemoteInfo() {
  const { status, data } = await get('/remote.htm');
  if (status !== 200) throw new Error(`HTTP ${status}`);

  const tokenMatch = data.match(/<input[^>]*name=["']?t["']?[^>]*value=["']([^"']+)["']/i)
    || data.match(/<input[^>]*value=["']([^"']+)["'][^>]*name=["']?t["']/i);
  const token = tokenMatch ? tokenMatch[1] : '';

  const powerMatch = data.match(/Power state:\s*([^<\r\n]+)/i);
  const powerState = powerMatch ? powerMatch[1].trim() : '';

  const actions = [];
  const actionRegex = /<input[^>]*name=["']?amt_html_rc_radio_group["']?[^>]*value=["']?(\d+)["']?/gi;
  let m;
  while ((m = actionRegex.exec(data)) !== null) {
    actions.push(Number(m[1]));
  }
  if (actions.length === 0) {
    const actionRegex2 = /<input[^>]*value=["']?(\d+)["']?[^>]*name=["']?amt_html_rc_radio_group["']?/gi;
    while ((m = actionRegex2.exec(data)) !== null) {
      actions.push(Number(m[1]));
    }
  }

  return { powerState, token, actions };
}

export async function sendPowerCommand(action, bootOption = 1) {
  const { token, actions } = await getRemoteInfo();
  if (!token) throw new Error('Token CSRF não encontrado em /remote.htm');

  if (!actions.includes(action)) {
    const NAMES = { 1: 'off', 2: 'on', 3: 'cycle', 4: 'reset', 5: 'shutdown' };
    const avail = actions.map(a => NAMES[a] ?? a).join(', ');
    process.stderr.write(
      `aviso: "${NAMES[action] ?? action}" não está no formulário atual ` +
      `(disponíveis: ${avail}) — tentando mesmo assim\n`
    );
  }

  const res = await post('/remoteform', {
    t: token,
    amt_html_rc_radio_group: String(action),
    amt_html_rc_boot_special: String(bootOption),
  });

  const location = res.headers['location']?.toLowerCase() ?? '';
  const ok = res.status === 200 || (res.status === 303 && !location.includes('invreq'));

  return { ok, location };
}

// ─── Hardware ─────────────────────────────────────────────────────────────────

export const HW_PAGES = {
  system: { path: '/hw-sys.htm', label: 'System' },
  processor: { path: '/hw-proc.htm', label: 'Processor' },
  memory: { path: '/hw-mem.htm', label: 'Memory' },
  disk: { path: '/hw-disk.htm', label: 'Disk' },
};

function parseHardwarePage(html) {
  const sections = [];
  let current = null;

  const logTableStart = html.search(/<table[^>]*class=["']?log["']?/i);
  if (logTableStart === -1) return sections;

  let content = html.slice(logTableStart);
  // Substitui tabelas aninhadas (ex: BIOS Supported functions) pelo seu texto para não interferir nas linhas
  content = content.replace(/<table(?!\s*class=["']?log)[\s\S]*?<\/table>/gi, match => cleanText(match));

  const trTokens = content.split(/(?=<tr\b)/i).slice(1);

  for (const rowSnippet of trTokens) {
    const rowEndIdx = rowSnippet.search(/<\/tr>/i);
    const row = rowEndIdx !== -1 ? rowSnippet.slice(0, rowEndIdx + 5) : rowSnippet;

    // Título via <h2> dentro de td sem classe r1 (ex: Platform, Baseboard, BIOS, Processor 1, Module 1, Disk 1)
    const h2Match = row.match(/<td(?![^>]*class=["']?r1["']?)[^>]*>[\s\S]*?<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (h2Match) {
      const h2 = cleanText(h2Match[1]);
      if (h2) {
        current = { title: h2, fields: {} };
        sections.push(current);
        continue;
      }
    }

    const tdTokens = row.split(/(?=<td\b)/i).slice(1);
    const r1Cells = [];

    for (const tdSnippet of tdTokens) {
      const tdStartMatch = tdSnippet.match(/^<td([^>]*)>/i);
      if (!tdStartMatch) continue;
      const attrs = tdStartMatch[1];
      if (!/\bclass=["']?r1["']?/i.test(attrs)) continue;

      const tdContent = tdSnippet.slice(tdStartMatch[0].length);
      const closeIdx = tdContent.search(/<\/td>/i);
      const cellHtml = closeIdx !== -1 ? tdContent.slice(0, closeIdx) : tdContent;
      const text = cleanText(cellHtml);
      r1Cells.push(text);
    }

    if (!r1Cells.length) continue;

    // Linha com 1 célula r1 → título de seção
    if (r1Cells.length === 1) {
      const title = r1Cells[0];
      if (title) {
        current = { title, fields: {} };
        sections.push(current);
      }
      continue;
    }

    const key = r1Cells[0].replace(/:$/, '');
    const val = r1Cells[1] || '—';
    if (!key) continue;

    current ??= { title: 'Item 1', fields: {} };
    if (!sections.includes(current)) sections.push(current);

    // Chave repetida = novo bloco sem header (Disk 2, Module 2, …)
    if (key in current.fields) {
      const m = current.title.match(/^(.*?)(\d+)$/);
      const base = m ? m[1] : `${current.title} `;
      const num = m ? Number(m[2]) + 1 : 2;
      current = { title: `${base}${num}`, fields: {} };
      sections.push(current);
    }

    current.fields[key] = val;
  }

  return sections;
}

export async function getHardwareInfo(category = null) {
  const pages = category ? { [category]: HW_PAGES[category] } : HW_PAGES;

  if (category && !HW_PAGES[category]) {
    throw new Error(`Categoria inválida: "${category}". Use: ${Object.keys(HW_PAGES).join(', ')}`);
  }

  const entries = await Promise.all(
    Object.entries(pages).map(async ([id, { path, label }]) => {
      try {
        const { status, data } = await get(path);
        if (status !== 200) throw new Error(`HTTP ${status}`);
        return [id, { label, sections: parseHardwarePage(data) }];
      } catch ({ message }) {
        return [id, { label, error: message }];
      }
    })
  );

  return Object.fromEntries(entries);
}
