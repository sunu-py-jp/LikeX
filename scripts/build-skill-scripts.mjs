import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const skillKinds = ['spreadsheet', 'slide'];

export async function generatedSkillScript(kind) {
  if (!skillKinds.includes(kind)) throw new Error(`Unsupported skill: ${kind}`);
  const metadata = JSON.parse(await readFile(path.join(repo, `packages/${kind}/package.json`), 'utf8'));
  const source = await readFile(path.join(repo, 'scripts/skills/document-cli.mjs'), 'utf8');
  return source.replace('// Canonical CLI source. Generate distributable scripts with scripts/build-skill-scripts.mjs.',
    '// Generated from scripts/skills/document-cli.mjs. Do not edit; run node scripts/build-skill-scripts.mjs.')
    .replace("'__DOCUMENT_KIND__'", JSON.stringify(kind)).replace("'__LIBRARY_VERSION__'", JSON.stringify(metadata.version));
}

export async function buildSkillScripts({ check = false } = {}) {
  const stale = [];
  for (const kind of skillKinds) {
    const destination = path.join(repo, `packages/${kind}/skills/likex-${kind}/scripts/document.mjs`);
    const generated = await generatedSkillScript(kind);
    if (check) {
      const existing = await readFile(destination, 'utf8').catch(error => { if (error.code === 'ENOENT') return null; throw error; });
      if (existing !== generated) stale.push(path.relative(repo, destination));
    } else { await mkdir(path.dirname(destination), { recursive: true }); await writeFile(destination, generated); }
  }
  if (stale.length) throw new Error(`Generated skill scripts are stale. Run node scripts/build-skill-scripts.mjs: ${stale.join(', ')}`);
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.some(arg => arg !== '--check') || args.length > 1) throw new Error('Usage: node scripts/build-skill-scripts.mjs [--check]');
  await buildSkillScripts({ check: args.includes('--check') });
}
