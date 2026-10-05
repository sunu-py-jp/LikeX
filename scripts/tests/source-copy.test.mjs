import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rewriteSourceCopyAdapters } from '../lib/source-copy.mjs';

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

for (const moduleName of ['spreadsheet', 'slide', 'document']) test(`${moduleName} copy verification changes only core.ts and cannot repair stray Core subpath bridges`, async t => {
  const { directory, sources } = await fixture(t);
  assert.deepEqual(await rewriteSourceCopyAdapters(directory, moduleName), { 'core.ts': '../core' });
  for (const [file, source] of Object.entries(sources))
    assert.equal(await readFile(path.join(directory, file), 'utf8'), file === 'core.ts' ? 'export * from "../core";\n' : source, file);
});

test('other UI modules retain their documented optional Core subpath adapters', async t => {
  const { directory } = await fixture(t);
  const expected = { 'core.ts': '../core', 'browser.ts': '../core/browser', 'ooxml.ts': '../core/ooxml',
    'json.ts': '../core/json', 'model/core-connectors.ts': '../../core/connectors',
    'model/core-office-shapes.ts': '../../core/office-shapes', 'model/core-text-search.ts': '../../core/text-search' };
  assert.deepEqual(await rewriteSourceCopyAdapters(directory, 'explorer'), expected);
  for (const [file, imported] of Object.entries(expected))
    assert.equal(await readFile(path.join(directory, file), 'utf8'), `export * from "${imported}";\n`);
  await rm(path.join(directory, 'browser.ts'));
  delete expected['browser.ts'];
  assert.deepEqual(await rewriteSourceCopyAdapters(directory, 'explorer'), expected);
  assert.deepEqual(await rewriteSourceCopyAdapters(directory, 'core'), {});
});
