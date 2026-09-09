import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { bundlePlainStyles } from '../lib/plain-styles.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'likex-css-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(path.join(root, 'src'));
  const entry = path.join(root, 'src/styles.css');
  return { root, entry };
}
test('component CSS bundles local imports once in order without a host compiler', async t => {
  const { root, entry } = await fixture(t);
  await writeFile(entry, '@import "./base.css";\n@import "./controls.css";');
  await writeFile(path.join(root, 'src/base.css'), '.lxs-a { color: red; }');
  await writeFile(path.join(root, 'src/controls.css'), '.lxs-b { color: blue; }');
  const css = await bundlePlainStyles(entry);
  assert.doesNotMatch(css, /@import/);
  assert.ok(css.indexOf('.lxs-a') < css.indexOf('.lxs-b'));
});
test('component CSS rejects external and parent-folder dependencies', async t => {
  const { root, entry } = await fixture(t);
  await writeFile(entry, '@import "https://example.invalid/theme.css";');
  await assert.rejects(bundlePlainStyles(entry), /external dependency/);
  await writeFile(path.join(root, 'shared.css'), '.outside { color: red; }');
  await writeFile(entry, '@import "../shared.css";');
  await assert.rejects(bundlePlainStyles(entry), /leaves its source folder/);
});
