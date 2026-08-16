import { getHardwareInfo, HW_PAGES } from '../scraper.js';

const CATEGORIES = Object.keys(HW_PAGES);

export function register(program) {
  program
    .command('hwinfo [category]')
    .description('Show hardware information from the AMT WebUI')
    .addHelpText('after', `
Categories (default: all):
  system      Platform, Baseboard and BIOS
  processor   CPU information
  memory      RAM modules
  disk        Storage devices`)
    .option('--json', 'Output as JSON')
    .action(async (category, { json }) => {
      if (category && !CATEGORIES.includes(category)) {
        program.error(
          `unknown category "${category}" — valid: ${CATEGORIES.join(', ')}`,
          { exitCode: 2 }
        );
      }

      const data = await getHardwareInfo(category ?? null);

      if (json) return process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);

      for (const { label, sections, error } of Object.values(data)) {
        if (error) { process.stderr.write(`error fetching ${label}: ${error}\n`); continue; }

        for (const { title, fields } of sections) {
          if (!Object.keys(fields).length) continue;

          process.stdout.write(`[${title}]\n`);
          for (const [key, val] of Object.entries(fields)) {
            const k = key.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
            process.stdout.write(`${k}: ${val}\n`);
          }
          process.stdout.write('\n');
        }
      }
    });
}
