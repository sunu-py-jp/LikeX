import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { assertInventoryRetained, assertNoticesRetained, assertPermissiveLicense,
  collectRuntimeNotices, readPackageNotice } from '../lib/licenses.mjs';

const license = 'MIT License\nCopyright (c) Example contributor\n\nPermission is hereby granted, free of charge, to any person obtaining a copy of this software to use, copy, modify and distribute it.';
function fixture(t) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'likex licenses '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  function put(relative, manifest, notice = license) {
    const directory = path.join(root, relative);
    mkdirSync(directory, { recursive: true });
    writeFileSync(path.join(directory, 'package.json'), JSON.stringify({ name: relative.split('/').at(-1) || 'root', version: '1.0.0', license: 'MIT', ...manifest }));
    if (notice !== null) writeFileSync(path.join(directory, 'LICENSE'), notice);
    return directory;
  }
  return { root, put };
}

test('rejects a non-permissive transitive dependency, even behind an MIT parent', t => {
  const { root, put } = fixture(t);
  put('', { dependencies: { parent: '*' } });
  put('node_modules/parent', { dependencies: { child: '*' } });
  put('node_modules/child', { license: 'GPL-3.0-only' });
  assert.throws(() => collectRuntimeNotices(root), /rejects child@1.0.0: GPL-3.0-only/);
});

test('runtime closure excludes development tooling while including requested bundled CSS', t => {
  const { root, put } = fixture(t);
  put('', { dependencies: { runtime: '*' }, devDependencies: { compiler: '*', tailwindcss: '*' } });
  put('node_modules/runtime', {});
  put('node_modules/compiler', { license: 'LGPL-3.0-only' });
  put('node_modules/tailwindcss', {});
  assert.deepEqual(collectRuntimeNotices(root, ['tailwindcss']).map(entry => entry.name), ['runtime', 'tailwindcss']);
});

test('absent optional peers and optional dependencies are skipped', t => {
  const { root, put } = fixture(t);
  put('', { peerDependencies: { optional: '*' }, peerDependenciesMeta: { optional: { optional: true } }, optionalDependencies: { native: '*' } });
  assert.deepEqual(collectRuntimeNotices(root), []);
});

test('absent required runtime peers fail', t => {
  const { root, put } = fixture(t);
  put('', { dependencies: { dependency: '*' } });
  put('node_modules/dependency', { peerDependencies: { required: '*' } });
  assert.throws(() => collectRuntimeNotices(root), /Cannot resolve required package required/);
});

test('installed optional peers are audited and cannot hide rejected licenses', t => {
  const { root, put } = fixture(t);
  put('', { peerDependencies: { optional: '*' }, peerDependenciesMeta: { optional: { optional: true } } });
  put('node_modules/optional', { license: 'MPL-2.0' });
  assert.throws(() => collectRuntimeNotices(root), /rejects optional/);
});

test('a dependency also listed as an optional peer remains required', t => {
  const { root, put } = fixture(t);
  put('', { dependencies: { needed: '*' }, peerDependencies: { needed: '*' }, peerDependenciesMeta: { needed: { optional: true } } });
  assert.throws(() => collectRuntimeNotices(root), /Cannot resolve required package needed/);
});

test('different nested versions retain their own metadata and notices', t => {
  const { root, put } = fixture(t);
  put('', { dependencies: { parent: '*', shared: '*' } });
  put('node_modules/parent', { dependencies: { shared: '*' } });
  put('node_modules/shared', { version: '1.0.0' });
  put('node_modules/parent/node_modules/shared', { version: '2.0.0' }, license.replace('Example', 'Nested'));
  const entries = collectRuntimeNotices(root).filter(entry => entry.name === 'shared');
  assert.deepEqual(entries.map(entry => entry.version), ['1.0.0', '2.0.0']);
  assert.match(entries[1].notices[0], /Nested contributor/);
});

test('workspace links retain their license and follow dependencies without including the starting package', t => {
  const { root, put } = fixture(t);
  const app = put('apps/example', { name: 'application', dependencies: { core: '*' } });
  const core = put('packages/core', { name: 'core', dependencies: { utility: '*' } });
  put('node_modules/utility', {});
  symlinkSync(core, path.join(root, 'node_modules/core'), 'dir');
  assert.deepEqual(collectRuntimeNotices(app).map(entry => entry.name), ['core', 'utility']);
});

test('missing or empty attribution text fails even with permissive metadata', t => {
  const { root, put } = fixture(t);
  put('', { dependencies: { empty: '*' } });
  const directory = put('node_modules/empty', {}, null);
  assert.throws(() => collectRuntimeNotices(root), /Missing substantive license\/notice text/);
  writeFileSync(path.join(directory, 'LICENSE'), 'MIT');
  assert.throws(() => collectRuntimeNotices(root), /Missing substantive license\/notice text/);
});

test('unreviewed, malformed, unlicensed and copyleft expressions fail conservatively', () => {
  const entry = { name: 'example', version: '1', notices: [license] };
  for (const value of ['UNKNOWN', 'UNLICENSED', 'MIT OR GPL-3.0-only', 'MIT Apache-2.0', '(MIT', 'MIT WITH exception'])
    assert.throws(() => assertPermissiveLicense({ ...entry, license: value }), /License policy rejects/);
  for (const value of ['MIT', 'Apache-2.0', '(MIT OR Apache-2.0)', 'BSD-3-Clause AND ISC'])
    assert.doesNotThrow(() => assertPermissiveLicense({ ...entry, license: value }));
});

test('reviewed fallback applies to only the exact package version and never replaces existing text', async t => {
  const { root, put } = fixture(t);
  mkdirSync(path.join(root, 'scripts/lib'), { recursive: true });
  mkdirSync(path.join(root, 'scripts/license-notices'));
  writeFileSync(path.join(root, 'scripts/lib/licenses.mjs'), readFileSync(new URL('../lib/licenses.mjs', import.meta.url)));
  writeFileSync(path.join(root, 'scripts/license-notices/registry.json'), JSON.stringify({
    'react-remove-scroll-bar@2.3.8': { file: 'notice.txt', source: 'https://example.org/upstream/2.3.8/LICENSE', sha256: createHash('sha256').update(license).digest('hex') },
  }));
  writeFileSync(path.join(root, 'scripts/license-notices/notice.txt'), license);
  const helper = await import(pathToFileURL(path.join(root, 'scripts/lib/licenses.mjs')));
  const exact = put('exact', { name: 'react-remove-scroll-bar', version: '2.3.8' }, null);
  const next = put('next', { name: 'react-remove-scroll-bar', version: '2.3.9' }, null);
  assert.deepEqual(helper.readPackageNotice(exact).notices, [license]);
  assert.deepEqual(helper.readPackageNotice(next).notices, []);
  assert.throws(() => helper.assertPermissiveLicense(helper.readPackageNotice(next)), /Missing substantive/);
  writeFileSync(path.join(root, 'scripts/license-notices/notice.txt'), `${license}\nUnreviewed edit`);
  assert.throws(() => helper.readPackageNotice(exact), /Notice fallback hash mismatch/);
  writeFileSync(path.join(exact, 'LICENSE'), `${license}\nPackaged upstream text`);
  assert.match(helper.readPackageNotice(exact).notices[0], /Packaged upstream text/);
});

test('artifact audit requires Tailwind, correct installed metadata and all original notices', t => {
  const { put } = fixture(t);
  const tailwind = readPackageNotice(put('tailwindcss', { version: '4.3.3' }));
  const react = readPackageNotice(put('react', { version: '19.2.8' }));
  const inventory = [react, tailwind].map(({ name, version, license }) => ({ name, version, license }));
  const notices = [react, tailwind].map(entry => `${entry.name}@${entry.version}\n${entry.notices.join('\n')}`).join('\n');
  assert.doesNotThrow(() => assertInventoryRetained(inventory, notices, [react, tailwind], ['tailwindcss']));
  assert.throws(() => assertInventoryRetained([inventory[0]], notices, [react, tailwind], ['tailwindcss']), /omits bundled dependency tailwindcss/);
  assert.throws(() => assertInventoryRetained([{ ...inventory[0], license: 'ISC' }], notices, [react]), /does not match installed metadata/);
  assert.throws(() => assertNoticesRetained('react@19.2.8', [react], 'test notices'), /omits license\/notice text/);
});
