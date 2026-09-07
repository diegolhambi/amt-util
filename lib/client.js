/**
 * lib/client.js
 * HTTP + Digest Auth para o Intel AMT WebUI usando fetch nativo.
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
  retries: Number(process.env.AMT_RETRIES ?? fileConfig.retries ?? 3),
  retryDelay: Number(process.env.AMT_RETRY_DELAY ?? fileConfig.retryDelay ?? 2000),
  timeout: Number(process.env.AMT_TIMEOUT ?? fileConfig.timeout ?? 5000),
};

/** Sobrescreve config com flags CLI (chamado no preAction do commander). */
export function configure({ host, port, user, pass, retries, retryDelay, timeout } = {}) {
  if (host?.trim()) config.host = host.trim();
  if (port) config.port = Number(port);
  if (user?.trim()) config.user = user.trim();
  if (pass?.trim()) config.pass = pass.trim();
  if (retries !== undefined && retries !== null && !isNaN(Number(retries))) config.retries = Number(retries);
  if (retryDelay !== undefined && retryDelay !== null && !isNaN(Number(retryDelay))) config.retryDelay = Number(retryDelay);
  if (timeout !== undefined && timeout !== null && !isNaN(Number(timeout))) config.timeout = Number(timeout);
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

let authChallenge = null;
let ncCounter = 0;

function parseWwwAuthenticate(header) {
  if (!header) return null;
  const realm = header.match(/realm="([^"]+)"/)?.[1];
  const nonce = header.match(/nonce="([^"]+)"/)?.[1];
  if (!realm || !nonce) return null;

  const qop = header.match(/qop="?([^",]+)"?/)?.[1] ?? '';
  const opaque = header.match(/opaque="([^"]+)"/)?.[1] ?? '';

  return { realm, nonce, qop, opaque };
}

function buildDigestHeader(method, uri) {
  if (!authChallenge) return null;
  ncCounter++;
  const nc = String(ncCounter).padStart(8, '0');
  const cnonce = randomBytes(8).toString('hex');
  const { realm, nonce, qop, opaque } = authChallenge;

  const ha1 = md5(`${config.user}:${realm}:${config.pass}`);
  const ha2 = md5(`${method}:${uri}`);

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

const RETRYABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'EPIPE',
  'ECONNABORTED',
  'ERR_BAD_RESPONSE',
]);

const sleep = ms => new Promise(r => setTimeout(r, ms));

function isRetryableError(err) {
  if (!err) return false;
  if (err.name === 'TimeoutError' || err.name === 'AbortError') return true;
  const code = err.code || err.cause?.code;
  if (code && RETRYABLE_CODES.has(code)) return true;
  if (err.message && /socket hang up|ECONNREFUSED|ECONNRESET|ETIMEDOUT|timeout|fetch failed/i.test(err.message)) return true;
  return false;
}

async function request(method, path, data = null) {
  validate();

  const url = `${baseURL()}${path}`;
  const maxAttempts = 1 + Math.max(0, config.retries);
  let lastError;

  const body = data ? new URLSearchParams(data).toString() : undefined;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const headers = { 'User-Agent': 'amt-util/2.0' };
      if (data) headers['Content-Type'] = 'application/x-www-form-urlencoded';

      // Reusa authChallenge imediatamente se disponível
      if (authChallenge) {
        headers['Authorization'] = buildDigestHeader(method, path);
      }

      let res = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(config.timeout),
        redirect: 'manual',
      });

      // Se não autenticado, atualiza o challenge e tenta novamente
      if (res.status === 401) {
        const wwwAuth = res.headers.get('www-authenticate') ?? '';
        const challenge = parseWwwAuthenticate(wwwAuth);
        if (challenge) {
          authChallenge = challenge;
          ncCounter = 0;
          headers['Authorization'] = buildDigestHeader(method, path);

          res = await fetch(url, {
            method,
            headers,
            body,
            signal: AbortSignal.timeout(config.timeout),
            redirect: 'manual',
          });
        }
      }

      const text = await res.text();
      const location = res.headers.get('location') ?? '';
      const wwwAuthenticate = res.headers.get('www-authenticate') ?? '';

      return {
        status: res.status,
        data: text,
        headers: {
          location,
          'www-authenticate': wwwAuthenticate,
          get: name => res.headers.get(name),
        },
      };
    } catch (err) {
      lastError = err;
      if (!isRetryableError(err) || attempt >= maxAttempts) {
        throw err;
      }
      await sleep(config.retryDelay);
    }
  }

  throw lastError;
}

export const get = path => request('GET', path);
export const post = (path, data) => request('POST', path, data);
