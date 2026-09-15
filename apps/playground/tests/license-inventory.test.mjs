import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { readPackageNotice, resolvePackageDirectory } from '../../../scripts/lib/licenses.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const pluginUrl = new URL('../build/license-inventory.ts', import.meta.url).href;

function runInventory(modulePaths = []) {
  const code = `
    import { licenseInventory } from ${JSON.stringify(pluginUrl)};
    const emitted = [];
    const modules = Object.fromEntries(${JSON.stringify(modulePaths)}.map(id => [id, { renderedLength: 1 }]));
    licenseInventory().generateBundle.call({ emitFile(asset) { emitted.push(asset); } }, {}, {
      'demo.js': { type: 'chunk', modules }, 'demo.css': { type: 'asset', source: 'body{}' },
    });
    console.log(JSON.stringify(emitted));
  `;
  return JSON.parse(execFileSync(process.execPath, ['--experimental-strip-types', '--input-type=module', '-e', code], {
    encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  }));
}

test('standalone demo retains Tailwind and LikeX notices even with no rendered JS dependencies', () => {
  const assets = runInventory();
  const inventory = JSON.parse(assets.find(asset => asset.fileName === 'third-party-inventory.json').source);
  const notices = assets.find(asset => asset.fileName === 'third-party-notices.txt').source;
  for (const name of ['tailwindcss', '@likex/playground']) {
    const entry = readPackageNotice(resolvePackageDirectory(name, root));
    assert.ok(inventory.some(item => item.name === name && item.version === entry.version && item.license === 'MIT'));
    for (const text of entry.notices) assert.ok(notices.includes(text));
  }
});

test('rendered dependency with a missing packaged notice receives its reviewed version-specific text', () => {
  const directory = resolvePackageDirectory('react-remove-scroll-bar', root);
  const entry = readPackageNotice(directory);
  const assets = runInventory([path.join(directory, 'dist/es2015/index.js')]);
  const notices = assets.find(asset => asset.fileName === 'third-party-notices.txt').source;
  assert.match(notices, /react-remove-scroll-bar@2\.3\.8/);
  for (const text of entry.notices) assert.ok(notices.includes(text));
  assert.match(notices, /Copyright \(c\) 2025 Anton Korzunov/);
});

test('demo bundle cannot silently introduce a copyleft or notice-less dependency', t => {
  const fixture = mkdtempSync(path.join(os.tmpdir(), 'likex-demo-licenses-'));
  t.after(() => rmSync(fixture, { recursive: true, force: true }));
  const directory = path.join(fixture, 'node_modules/fixture-dependency');
  mkdirSync(directory, { recursive: true });
  const manifest = path.join(directory, 'package.json');
  writeFileSync(manifest, JSON.stringify({ name: 'fixture-dependency', version: '1.0.0', license: 'MPL-2.0' }));
  assert.throws(() => runInventory([path.join(directory, 'index.js')]), /License policy rejects/);
  writeFileSync(manifest, JSON.stringify({ name: 'fixture-dependency', version: '1.0.0', license: 'MIT' }));
  assert.throws(() => runInventory([path.join(directory, 'index.js')]), /Missing substantive/);
});
