import path from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { artifactRoot, runNpm } from './lib/run.mjs';
import { libraryModule, moduleNames } from './lib/modules.mjs';

const online = process.argv.includes('--online');
const checks = [
  ...['check:styles', 'docs:check', 'test:scripts', 'test', 'lint', 'typecheck'].map(name => ({ name })),
  ...moduleNames.flatMap(module => ['pack:library', 'test:package', 'test:copy'].map(name => ({ name, module }))),
  { name: 'build:playground' },
];
const completed = [];
await mkdir(artifactRoot, { recursive: true });
const reportFile = path.join(artifactRoot, 'release-check.json');
try {
  for (const check of checks) {
    const label = check.module ? `${check.name}:${check.module}` : check.name;
    console.log(`\nRelease check: ${label}`);
    const options = check.module ? ['--module', check.module] : [];
    if (['test:package', 'test:copy'].includes(check.name)) {
      if (libraryModule(check.module).ui) options.push('--next');
      if (online) options.push('--online');
    }
    await runNpm(['run', check.name, ...(options.length ? ['--', ...options] : [])], { timeout: 300_000 });
    completed.push(label);
  }
  const pending = [];
  for (const moduleName of moduleNames) {
    const metadata = JSON.parse(await readFile(path.join(libraryModule(moduleName).packageRoot, 'package.json'), 'utf8'));
    if (metadata.private) pending.push(`Confirm the public registry and remove packages/${moduleName}/package.json private only when ready.`);
    if (metadata.license === 'UNLICENSED') pending.push(`Choose the distribution license and replace the UNLICENSED notice in packages/${moduleName}/LICENSE.`);
  }
  const report = { checkedAt: new Date().toISOString(), technicalChecks: 'passed', completed, publicationPending: pending };
  await writeFile(reportFile, JSON.stringify(report, null, 2) + '\n');
  console.log('All technical release checks passed. No publishing was performed.');
  for (const item of pending) console.log(`Publication pending: ${item}`);
} catch (error) {
  await writeFile(reportFile, JSON.stringify({ checkedAt: new Date().toISOString(), technicalChecks: 'failed', completed,
    error: error instanceof Error ? error.message : String(error) }, null, 2) + '\n');
  throw error;
}
