import { getRemoteInfo } from '../scraper.js';

const sleep = ms => new Promise(r => setTimeout(r, ms));

export async function run({ interval = 10, timeout = 300, quiet = false } = {}) {
  const intervalMs = Number(interval) * 1000;
  const timeoutMs = Number(timeout) * 1000;
  const log = msg => { if (!quiet) process.stderr.write(`${msg}\n`); };

  log(`waiting for OS interval=${interval}s timeout=${timeout}s`);

  const start = Date.now();
  let attempt = 1;

  while (true) {
    if (Date.now() - start >= timeoutMs) {
      process.stderr.write('amt-util: timeout waiting for OS\n');
      process.exit(1);
    }

    try {
      const { powerState, actions } = await getRemoteInfo();
      const on = powerState === 'On';
      const mei = actions.includes(5);

      log(`[${attempt}] power=${powerState} mei=${mei ? 'yes' : 'no'} actions=${actions.join(',')}`);

      if (on && mei) return process.stdout.write('ready\n');
    } catch ({ message }) {
      log(`[${attempt}] error: ${message}`);
    }

    attempt++;
    await sleep(intervalMs);
  }
}

export function register(program) {
  program
    .command('wait-os')
    .description('Wait until the OS is fully booted (MEI driver active)')
    .addHelpText('after', `
Progress is written to stderr; "ready" is written to stdout on success.
Allows composition: amt-util wait-os && amt-util hwinfo`)
    .option('--interval <seconds>', 'Polling interval', Number, 10)
    .option('--timeout <seconds>', 'Max wait time', Number, 300)
    .option('-q, --quiet', 'Suppress progress output')
    .action(run);
}
