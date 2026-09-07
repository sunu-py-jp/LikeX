import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { artifactRoot, packageRoot, runNpm } from './lib/run.mjs';

const checks = ['check:styles', 'test:styles', 'test', 'lint', 'typecheck', 'pack:library', 'test:package', 'test:copy', 'build:playground'];
const completed = [];
await mkdir(artifactRoot, { recursive: true });
const reportFile = path.join(artifactRoot, 'release-check.json');
try {
  for (const check of checks) {
    console.log(`\nRelease check: ${check}`);
    await runNpm(['run', check, ...(['test:package', 'test:copy'].includes(check) ? ['--', '--next'] : [])], { timeout: 300_000 });
    completed.push(check);
  }
  const metadata = JSON.parse(await readFile(path.join(packageRoot, 'package.json'), 'utf8'));
  const pending = [];
  if (metadata.private) pending.push('Confirm the public registry and remove packages/explorer/package.json private only when ready.');
  if (metadata.license === 'UNLICENSED') pending.push('Choose the distribution license and replace the UNLICENSED notice in packages/explorer/LICENSE.');
  const report = { checkedAt: new Date().toISOString(), technicalChecks: 'passed', completed, publicationPending: pending };
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log('All technical release checks passed. No publishing was performed.');
  for (const item of pending) console.log(`Publication pending: ${item}`);
} catch (error) {
  await writeFile(reportFile, JSON.stringify({ checkedAt: new Date().toISOString(), technicalChecks: 'failed', completed,
    error: error instanceof Error ? error.message : String(error) }, null, 2) + '\n');
  throw error;
}
