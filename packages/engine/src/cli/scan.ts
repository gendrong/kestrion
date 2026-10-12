/**
 * CLI: npm run scan <tokenAddress> [--json]
 * Prints a full risk report. Progress goes to stderr, the report to stdout.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createEngineContext } from '../context';
import { renderReport } from '../report/text';
import { scanToken } from '../scan/scan';

function loadEnv() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [path.resolve(process.cwd(), '.env'), path.resolve(here, '../../../../.env')];
  for (const file of new Set(candidates)) {
    if (fs.existsSync(file)) {
      process.loadEnvFile(file);
      return;
    }
  }
}

async function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const address = args.find((a) => !a.startsWith('--'));
  if (!address) {
    console.error('Usage: npm run scan <tokenAddress> [--json]');
    process.exit(2);
  }
  loadEnv();
  const started = Date.now();
  const elapsed = () => ((Date.now() - started) / 1000).toFixed(1).padStart(5);
  const ctx = createEngineContext(process.env, (m) => process.stderr.write(`\x1b[2m${elapsed()}s  ${m}\x1b[0m\n`));
  try {
    const report = await scanToken(ctx, address);
    const secs = ((Date.now() - started) / 1000).toFixed(1);
    process.stderr.write(`\x1b[2m… done in ${secs}s (${ctx.explorer?.calls ?? 0} explorer calls)\x1b[0m\n\n`);
    console.log(asJson ? JSON.stringify(report, null, 2) : renderReport(report));
  } catch (e) {
    console.error(`\nScan failed: ${(e as Error).message}`);
    process.exit(1);
  }
}

void main();
