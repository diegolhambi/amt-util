/**
 * lib/scraper.js
 * Scraping das páginas do Intel AMT WebUI → dados estruturados puros.
 */

import { load } from 'cheerio';
import { get, post } from './client.js';

// ─── Status ───────────────────────────────────────────────────────────────────

export async function getStatus() {
  const { status, data } = await get('/index.htm');
  if (status !== 200) throw new Error(`HTTP ${status}`);

  const $ = load(data);
  const result = {};

  const computer = $('p.top2').text().replace(/^Computer:\s*/i, '').trim();
  if (computer) result.computer = computer;

  const cells = [];
  $('td.r1').each((_, el) => {
    const text = $(el).text().trim().replace(/\s+/g, ' ');
    if (text && text !== '\u00a0') cells.push(text);
  });

  for (let i = 0; i < cells.length - 1; i += 2) {
    const key = cells[i].replace(/:$/, '').toLowerCase().replace(/\s+/g, '_');
    result[key] = cells[i + 1];
  }

  return result;
}

// ─── Remote / Power ───────────────────────────────────────────────────────────

export async function getRemoteInfo() {
  const { status, data } = await get('/remote.htm');
  if (status !== 200) throw new Error(`HTTP ${status}`);

  const $ = load(data);
  const token = $('input[name="t"]').val() ?? '';
  const powerState = $('td.r1 p').first().text()
    .replace(/^Power state:\s*/i, '').trim();
  const actions = $('input[name="amt_html_rc_radio_group"]')
    .map((_, el) => Number($(el).val()))
    .toArray();

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
  const $ = load(html);
  const sections = [];
  let current = null;

  const clean = el =>
    $(el).text().trim()
      .replace(/\s+/g, ' ')
      .replace(/\u00a0/g, '')
      .replace(/&#x2F;/g, '/')
      .trim();

  $('table.log tr').each((_, row) => {
    const $row = $(row);

    // Título via <h2> dentro de td sem classe (ex: Platform, Baseboard, BIOS)
    const h2 = $row.find('td:not(.r1) h2').first().text().trim();
    if (h2) {
      current = { title: h2, fields: {} };
      sections.push(current);
      return;
    }

    const $r1 = $row.find('td.r1');
    if (!$r1.length) return;

    // Linha com 1 célula → título de seção
    if ($r1.length === 1) {
      const title = clean($r1[0]);
      if (title) { current = { title, fields: {} }; sections.push(current); }
      return;
    }

    const key = clean($r1[0]).replace(/:$/, '');
    const val = clean($r1[1]) || '—';
    if (!key) return;

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
  });

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
