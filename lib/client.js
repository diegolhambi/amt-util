/**
 * lib/client.js
 * HTTP + Digest Auth para o Intel AMT WebUI.
 *
 * Configuração (ordem de precedência):
 *   1. configure({ host, port, user, pass })  — flags CLI via preAction do commander
 *   2. Variáveis de ambiente: AMT_HOST, AMT_PORT, AMT_USER, AMT_PASS
 *   3. Arquivo de config: ~/.config/amt-util/config  |  ./.amtrc
 *
 * Formato do config file:
 *   host=192.168.15.200
 *   pass=sua-senha
 */

import axios from 'axios';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

// ─── Config file ──────────────────────────────────────────────────────────────

function loadConfigFile() {
  const candidates = [
    join(homedir(), '.config', 'amt-util', 'config'),
    join(process.cwd(), '.amtrc'),
  ];

  for (const file of candidates) {
    if (!existsSync(file)) continue;

    return Object.fromEntries(
      readFileSync(file, 'utf8')
        .split('\n')
        .flatMap(line => {
          const [key, ...rest] = line.trim().split('=');
          return key && rest.length ? [[key.trim(), rest.join('=').trim()]] : [];
        })
    );
  }

  return {};
}

const fileConfig = loadConfigFile();

// ─── Active config ────────────────────────────────────────────────────────────

export const config = {
  host: process.env.AMT_HOST ?? fileConfig.host ?? null,
  port: Number(process.env.AMT_PORT ?? fileConfig.port ?? 16992),
  user: process.env.AMT_USER ?? fileConfig.user ?? 'admin',
  pass: process.env.AMT_PASS ?? fileConfig.pass ?? null,
};

/** Sobrescreve config com flags CLI (chamado no preAction do commander). */
export function configure({ host, port, user, pass } = {}) {
  if (host?.trim()) config.host = host.trim();
  if (port) config.port = Number(port);
  if (user?.trim()) config.user = user.trim();
  if (pass?.trim()) config.pass = pass.trim();
}

function validate() {
  const missing = ['host', 'pass'].filter(k => !config[k]);
  if (!missing.length) return;

  const msg = [
    `amt-util: missing required config: ${missing.join(', ')}`,
    '',
    'Provide credentials via (in order of precedence):',
    '  CLI flags:    amt-util --host <h> --pass <p> <command>',
    '  Environment:  AMT_HOST=<h> AMT_PASS=<p> amt-util <command>',
    '  Config file:  ~/.config/amt-util/config',
    '                  host=192.168.1.100',
    '                  pass=your-password',
  ].join('\n');

  process.stderr.write(msg + '\n');
  process.exit(1);
}

const baseURL = () => `http://${config.host}:${config.port}`;

// ─── Digest Auth ──────────────────────────────────────────────────────────────

const md5 = str => createHash('md5').update(str).digest('hex');

function buildDigestHeader(method, uri, wwwAuth) {
  const realm = wwwAuth.match(/realm="([^"]+)"/)?.[1] ?? '';
  const nonce = wwwAuth.match(/nonce="([^"]+)"/)?.[1] ?? '';
  const qop = wwwAuth.match(/qop="?([^",]+)"?/)?.[1] ?? '';
  const opaque = wwwAuth.match(/opaque="([^"]+)"/)?.[1] ?? '';

  const ha1 = md5(`${config.user}:${realm}:${config.pass}`);
  const ha2 = md5(`${method}:${uri}`);
  const nc = '00000001';
  const cnonce = randomBytes(8).toString('hex');

  const response = qop
    ? md5(`${ha1}:${nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : md5(`${ha1}:${nonce}:${ha2}`);

  const parts = [
    `Digest username="${config.user}"`,
    `realm="${realm}"`,
    `nonce="${nonce}"`,
    `uri="${uri}"`,
    `response="${response}"`,
    ...(qop ? [`qop=${qop}`, `nc=${nc}`, `cnonce="${cnonce}"`] : []),
    ...(opaque ? [`opaque="${opaque}"`] : []),
  ];

  return parts.join(', ');
}

// ─── Request ──────────────────────────────────────────────────────────────────

async function request(method, path, data = null) {
  validate();

  const url = `${baseURL()}${path}`;
  const headers = { 'User-Agent': 'amt-util/2.0' };

  if (data) headers['Content-Type'] = 'application/x-www-form-urlencoded';

  const axiosCfg = {
    method,
    url,
    maxRedirects: 0,
    validateStatus: () => true,
    headers,
    ...(data && { data: new URLSearchParams(data).toString() }),
  };

  let res = await axios(axiosCfg);

  if (res.status === 401) {
    const wwwAuth = res.headers['www-authenticate'] ?? '';
    axiosCfg.headers = {
      ...headers,
      Authorization: buildDigestHeader(method.toUpperCase(), path, wwwAuth),
    };
    res = await axios(axiosCfg);
  }

  return res;
}

export const get = path => request('GET', path);
export const post = (path, data) => request('POST', path, data);
