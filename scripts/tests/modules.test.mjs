import assert from 'node:assert/strict';
import test from 'node:test';
import { dependencyOrder, libraryModule, moduleNames, requestedModules } from '../lib/modules.mjs';

test('existing commands still select Explorer and --all covers every registered library', () => {
  assert.deepEqual(requestedModules([]), ['explorer']);
  assert.deepEqual(requestedModules(['--all', '--next']), moduleNames);
  assert.deepEqual(requestedModules(['--module', 'spreadsheet', '--online']), ['spreadsheet']);
  assert.deepEqual(requestedModules(['--module=spreadsheet']), ['spreadsheet']);
});

test('module selection cannot escape a package or silently choose a different package', () => {
  for (const args of [['--module'], ['--module', '--all'], ['--module', '../explorer'],
    ['--module='], ['--all', '--module', 'spreadsheet'], ['--module', 'explorer', '--module', 'spreadsheet']])
    assert.throws(() => requestedModules(args));
});

test('artifacts for separate libraries cannot overwrite each other', () => {
  const explorer = libraryModule('explorer'), spreadsheet = libraryModule('spreadsheet');
  assert.notEqual(explorer.packageRoot, spreadsheet.packageRoot);
  assert.notEqual(explorer.sourceRoot, spreadsheet.sourceRoot);
  assert.notEqual(explorer.artifactRoot, spreadsheet.artifactRoot);
  assert.ok(spreadsheet.artifactRoot.endsWith('/artifacts/spreadsheet'));
});

test('the core profile is headless and still participates in every distribution check', () => {
  const core = libraryModule('core');
  assert.equal(core.ui, false);
  assert.deepEqual(core.bundledDependencies, []);
  assert.ok(core.artifactRoot.endsWith('/artifacts/core'));
  assert.ok(requestedModules(['--all']).includes('core'));
  assert.equal(libraryModule('explorer').ui, true);
  assert.equal(libraryModule('spreadsheet').ui, true);
});

test('core builds first for a single UI package and is deduplicated for all modules', () => {
  assert.deepEqual(dependencyOrder(['explorer']), ['core', 'explorer']);
  assert.deepEqual(dependencyOrder(['spreadsheet', 'explorer']), ['core', 'spreadsheet', 'explorer']);
  assert.deepEqual(dependencyOrder(moduleNames), moduleNames);
});
