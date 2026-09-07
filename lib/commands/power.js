import { sendPowerCommand } from '../scraper.js';

export const ACTIONS = {
  on:       2,
  off:      1,
  cycle:    3,
  reset:    4,
  shutdown: 5,
};

export const BOOT_OPTIONS = { normal: 1, hdd: 3, cd: 6 };

export async function run(action, { boot = 'normal' } = {}) {
  if (!action || !(action in ACTIONS)) {
    process.stderr.write(
      `amt-util: unknown action "${action}" — valid: ${Object.keys(ACTIONS).join(', ')}\n`
    );
    process.exit(2);
  }

  if (!(boot in BOOT_OPTIONS)) {
    process.stderr.write(
      `amt-util: unknown boot option "${boot}" — valid: ${Object.keys(BOOT_OPTIONS).join(', ')}\n`
    );
    process.exit(2);
  }

  const { ok, location } = await sendPowerCommand(ACTIONS[action], BOOT_OPTIONS[boot]);

  if (!ok) {
    process.stderr.write(`amt-util: command rejected by AMT (→ ${location})\n`);
    process.exit(1);
  }

  process.stdout.write('ok\n');
}

export function register(program) {
  program
    .command('power <action>')
    .description('Send a power control command to the machine')
    .addHelpText('after', `
Actions:
  on        Turn power on (only when off)
  off       Force power off
  cycle     Power cycle (off then on)
  reset     Hard reset
  shutdown  Graceful shutdown (requires Intel MEI driver on the OS)`)
    .option('--boot <option>', 'Boot device for cycle/reset/on: normal|hdd|cd', 'normal')
    .action((action, opts) => run(action, opts));
}
