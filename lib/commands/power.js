import { sendPowerCommand } from '../scraper.js';

const ACTIONS = {
  on:       2,
  off:      1,
  cycle:    3,
  reset:    4,
  shutdown: 5,
};

const BOOT_OPTIONS = { normal: 1, hdd: 3, cd: 6 };

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
    .action(async (action, { boot }) => {
      if (!(action in ACTIONS)) {
        program.error(
          `unknown action "${action}" — valid: ${Object.keys(ACTIONS).join(', ')}`,
          { exitCode: 2 }
        );
      }

      if (!(boot in BOOT_OPTIONS)) {
        program.error(
          `unknown boot option "${boot}" — valid: ${Object.keys(BOOT_OPTIONS).join(', ')}`,
          { exitCode: 2 }
        );
      }

      const { ok, location } = await sendPowerCommand(ACTIONS[action], BOOT_OPTIONS[boot]);

      if (!ok) program.error(`command rejected by AMT (→ ${location})`, { exitCode: 1 });

      process.stdout.write('ok\n');
    });
}
