import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertSourceBoundary } from '../lib/source-boundary.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'likex-source-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const ui = path.join(root, 'explorer'), core = path.join(root, 'core');
  await mkdir(ui); await mkdir(core);
  return { ui, core, manifest: { name: '@likex/explorer', dependencies: { '@likex/core': '0.1.0' } } };
}

test('paired source copies allow only the explicitly declared sibling core directory', async t => {
  const { ui, core, manifest } = await fixture(t);
  await writeFile(path.join(ui, 'core.ts'), 'export * from "../core";\n');
  await assert.rejects(assertSourceBoundary(ui, manifest), /escapes/);
  assert.equal(await assertSourceBoundary(ui, manifest, { allowedSourceRoots: [core] }), 1);
  await writeFile(path.join(ui, 'core.ts'), 'export * from "../core-other";\n');
  await assert.rejects(assertSourceBoundary(ui, manifest, { allowedSourceRoots: [core] }), /escapes/);
});

test('paired copies still reject external aliases and escaping type-only imports', async t => {
  const { ui, core, manifest } = await fixture(t);
  await writeFile(path.join(ui, 'core.ts'), 'import type { Secret } from "../../private";\n');
  await assert.rejects(assertSourceBoundary(ui, manifest, { allowedSourceRoots: [core] }), /escapes/);
  await writeFile(path.join(ui, 'core.ts'), 'export * from "@app/private";\n');
  await assert.rejects(assertSourceBoundary(ui, manifest, { allowedSourceRoots: [core] }), /undeclared/);
});
