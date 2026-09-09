import assert from 'node:assert/strict';
import test from 'node:test';
import { libraryModule, moduleNames, requestedModules } from '../lib/modules.mjs';

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
