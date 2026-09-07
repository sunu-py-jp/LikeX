import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { pathToFileURL } from 'node:url';

async function fixture(t, packages) {
  const directory = await realpath(await mkdtemp(path.join(os.tmpdir(), 'likex package metadata ')));
  t.after(() => rm(directory, { recursive: true, force: true }));
  // A separate resolver module keeps these tests independent of workspace
  // installs and exercises the same import conditions as the release scripts.
  const resolverPath = path.join(directory, 'packages.mjs');
  await writeFile(resolverPath, await readFile(new URL('../lib/packages.mjs', import.meta.url)));
  for (const [name, files] of Object.entries(packages)) {
    for (const [file, contents] of Object.entries(files)) {
      const target = path.join(directory, 'node_modules', name, file);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, typeof contents === 'string' ? contents : JSON.stringify(contents));
    }
  }
  const { installedPackage } = await import(pathToFileURL(resolverPath).href);
  return { installedPackage, directory };
}

test('reads scoped type-only package metadata without requiring a runtime entry', async t => {
  const manifest = { name: '@types/example', version: '1.2.3', types: 'index.d.ts' };
  const { installedPackage, directory } = await fixture(t, {
    '@types/example': { 'package.json': manifest, 'index.d.ts': 'export interface Example {}' },
  });
  assert.deepEqual(await installedPackage('@types/example'), {
    directory: path.join(directory, 'node_modules/@types/example'), manifest,
  });
});

test('reads an exported manifest when a package deliberately has no main export', async t => {
  const manifest = { name: 'types-only', version: '1.0.0', types: 'index.d.ts',
    exports: { './package.json': './package.json' } };
  const { installedPackage } = await fixture(t, {
    'types-only': { 'package.json': manifest, 'index.d.ts': 'export interface Example {}' },
  });
  assert.deepEqual((await installedPackage('types-only')).manifest, manifest);
});

test('finds a private manifest through the imported entry and skips unrelated nested manifests', async t => {
  const manifest = { name: 'private-metadata', version: '2.0.0',
    exports: { '.': { import: './dist/index.mjs' } } };
  const { installedPackage, directory } = await fixture(t, {
    'private-metadata': {
      'package.json': manifest,
      'dist/package.json': { name: 'unrelated-nested-package', type: 'module' },
      'dist/index.mjs': 'export default true;',
    },
  });
  assert.deepEqual(await installedPackage('private-metadata'), {
    directory: path.join(directory, 'node_modules/private-metadata'), manifest,
  });
});

test('reports a missing package instead of returning an ancestor manifest', async t => {
  const { installedPackage } = await fixture(t, {});
  await assert.rejects(installedPackage('likex-nonexistent-metadata-test-package'), { code: 'ERR_MODULE_NOT_FOUND' });
});

test('does not hide invalid package metadata behind resolution fallback', async t => {
  const { installedPackage } = await fixture(t, {
    'invalid-metadata': { 'package.json': '{ malformed json', 'index.js': 'module.exports = true;' },
  });
  await assert.rejects(installedPackage('invalid-metadata'), { code: 'ERR_INVALID_PACKAGE_CONFIG' });
});
