import { getStatus } from '../scraper.js';

export function register(program) {
  program
    .command('status')
    .description('Show system power state and basic info')
    .option('-q, --quiet', 'Print only the power state value (On/Off)')
    .option('--json', 'Output as JSON')
    .action(async ({ quiet, json }) => {
      const data = await getStatus();

      if (quiet) return process.stdout.write(`${data.power ?? '?'}\n`);
      if (json) return process.stdout.write(`${JSON.stringify(data)}\n`);

      for (const [key, val] of Object.entries(data)) {
        process.stdout.write(`${key}: ${val}\n`);
      }
    });
}
