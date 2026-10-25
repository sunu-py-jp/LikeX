import assert from 'node:assert/strict';
import test from 'node:test';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rewriteSourceCopyAdapters } from '../lib/source-copy.mjs';
import { libraryModule, moduleNames } from '../lib/modules.mjs';
import { assertSourceBoundary } from '../lib/source-boundary.mjs';

const uiModules = moduleNames.filter(name => libraryModule(name).ui);

async function fixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'likex-source-copy-adapters-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const sources = {
    'core.ts': 'export * from "@likex/core";\n',
    'browser.ts': 'export * from "@likex/core/browser";\n',
    'ooxml.ts': 'export * from "@likex/core/ooxml";\n',
    'json.ts': 'export * from "@likex/core/json";\n',
    'model/core-connectors.ts': 'export * from "@likex/core/connectors";\n',
    'model/core-office-shapes.ts': 'export * from "@likex/core/office-shapes";\n',
    'model/core-text-search.ts': 'export * from "@likex/core/text-search";\n',
  };
  await mkdir(path.join(directory, 'model'));
  await Promise.all(Object.entries(sources).map(([file, source]) => writeFile(path.join(directory, file), source)));
  return { directory, sources };
}

for (const moduleName of uiModules) test(`${moduleName} copy verification changes only core.ts and cannot repair stray Core subpath bridges`, async t => {
  const { directory, sources } = await fixture(t);
  assert.deepEqual(await rewriteSourceCopyAdapters(directory, moduleName), { 'core.ts': '../core' });
  for (const [file, source] of Object.entries(sources))
    assert.equal(await readFile(path.join(directory, file), 'utf8'), file === 'core.ts' ? 'export * from "../core";\n' : source, file);
});

test('core source copies need no adapter rewrites', async t => {
  const { directory, sources } = await fixture(t);
  assert.deepEqual(await rewriteSourceCopyAdapters(directory, 'core'), {});
  for (const [file, source] of Object.entries(sources))
    assert.equal(await readFile(path.join(directory, file), 'utf8'), source, file);
});

for (const moduleName of uiModules) test(`${moduleName} maintained source has no remaining LikeX package references after its single adapter rewrite`, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'likex-source-copy-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const profile = libraryModule(moduleName), directory = path.join(root, moduleName);
  await cp(profile.sourceRoot, directory, { recursive: true });
  const manifest = JSON.parse(await readFile(path.join(profile.packageRoot, 'package.json'), 'utf8'));
  // Copy consumers install third-party dependencies, never a hidden LikeX package.
  for (const field of ['dependencies', 'peerDependencies'])
    manifest[field] = Object.fromEntries(Object.entries(manifest[field] ?? {}).filter(([name]) => !name.startsWith('@likex/')));
  assert.deepEqual(await rewriteSourceCopyAdapters(directory, moduleName), { 'core.ts': '../core' });
  await assertSourceBoundary(directory, manifest, { allowedSourceRoots: [path.join(root, 'core')] });
});
