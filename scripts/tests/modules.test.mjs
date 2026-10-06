import assert from 'node:assert/strict';
import test from 'node:test';
import { access, readFile } from 'node:fs/promises';
import path from 'node:path';
import ts from 'typescript';
import { dependencyOrder, libraryModule, moduleNames, requestedModules } from '../lib/modules.mjs';
import { allowedPackageFile } from '../lib/package-files.mjs';

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
  assert.equal(core.headlessEntries['text-search'], 'text-search.ts');
  assert.ok(core.headlessDependencies.includes('re2js'));
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

test('each UI module exposes a separate headless model entry without changing its UI entry', () => {
  for (const name of moduleNames.filter(name => name !== 'core')) {
    assert.deepEqual(libraryModule(name).headlessEntries, { model: 'model-entry.ts' });
    assert.equal(libraryModule(name).ui, true);
  }
});

test('dedicated UI entries have distinct outputs and never become headless/browser entries', () => {
  assert.deepEqual(moduleNames.filter(name => Object.keys(libraryModule(name).uiEntries ?? {}).length), ['spreadsheet', 'slide', 'document']);
  for (const name of moduleNames) {
    const profile = libraryModule(name);
    const outputs = ['index', ...Object.keys(profile.uiEntries ?? {}), ...Object.keys(profile.headlessEntries ?? {}), ...Object.keys(profile.browserEntries ?? {})];
    assert.equal(new Set(outputs).size, outputs.length, `${name} must not overwrite an entry output`);
    if (!profile.ui) assert.deepEqual(profile.uiEntries ?? {}, {});
  }
  for (const name of ['spreadsheet', 'slide', 'document']) {
    const profile = libraryModule(name);
    assert.deepEqual(profile.uiEntries, { thumbnail: 'thumbnail.ts' });
    assert.equal(profile.headlessEntries.thumbnail, undefined);
    assert.equal(profile.browserEntries?.thumbnail, undefined);
  }
});

const thumbnailExports = {
  spreadsheet: { runtime: ['SpreadsheetThumbnail'], types: ['SpreadsheetThumbnailProps'] },
  slide: { runtime: ['LikeSlideThumbnail', 'LikeSlidePdfThumbnail', 'createSlidePdfLoader', 'SLIDE_PDF_LIMITS'],
    types: ['SlideThumbnailProps', 'SlidePdfThumbnailProps', 'SlidePdfLoader', 'SlidePdfDocument', 'SlidePdfPage', 'SlidePdfInput', 'SlidePdfJsModule', 'SlidePdfLoaderOptions', 'SlidePdfRenderOptions'] },
  document: { runtime: ['LikeDocumentThumbnail', 'default'], types: ['DocumentThumbnailProps'] },
};

for (const name of Object.keys(thumbnailExports)) test(`${name} thumbnail manifest exposes the configured client JavaScript and declarations`, async () => {
  const profile = libraryModule(name), manifest = JSON.parse(await readFile(path.join(profile.packageRoot, 'package.json'), 'utf8'));
  const source = profile.uiEntries.thumbnail;
  assert.deepEqual(manifest.exports['./thumbnail'], { types: './dist/types/thumbnail.d.ts', import: './dist/thumbnail.js', default: './dist/thumbnail.js' });
  assert.equal(Object.keys(manifest.exports['./thumbnail'])[0], 'types', 'TypeScript must resolve the declaration condition before the runtime fallback');
  assert.equal(manifest.exports['./thumbnail'].types, `./dist/types/${source.replace(/\.tsx?$/, '.d.ts')}`);
  assert.ok(manifest.files.includes('dist'), 'npm packaging includes every generated UI entry');
  for (const file of ['dist/thumbnail.js', 'dist/thumbnail.js.map', 'dist/types/thumbnail.d.ts'])
    assert.equal(allowedPackageFile(file, name), true, file);
  assert.equal(manifest.exports['.'].import, './dist/index.js', 'The full UI root remains available');
  assert.equal(manifest.exports['./model'].import, './dist/model.js', 'The headless model remains a separate entry');
  assert.equal(manifest.exports['./styles.css'], './dist/styles.css', 'Thumbnails share the standalone stylesheet');
});

for (const [name, expected] of Object.entries(thumbnailExports)) test(`${name} source-copy thumbnail preserves its client boundary and explicit public surface`, async () => {
  const profile = libraryModule(name), filename = path.join(profile.sourceRoot, profile.uiEntries.thumbnail);
  const source = ts.createSourceFile(filename, await readFile(filename, 'utf8'), ts.ScriptTarget.Latest, true);
  const first = source.statements[0];
  assert.ok(ts.isExpressionStatement(first) && ts.isStringLiteral(first.expression) && first.expression.text === 'use client', 'The dedicated entry must establish its own Next.js client boundary');
  const runtime = [], types = [];
  for (const statement of source.statements) {
    if (!ts.isExportDeclaration(statement)) continue;
    assert.ok(statement.moduleSpecifier && ts.isStringLiteral(statement.moduleSpecifier));
    assert.ok(statement.moduleSpecifier.text.startsWith('.'), 'Source-copy entry must not point back to its npm package');
    const target = path.resolve(profile.sourceRoot, statement.moduleSpecifier.text);
    assert.ok(target.startsWith(profile.sourceRoot + path.sep), 'Thumbnail re-exports stay inside the copied source tree');
    assert.ok(await Promise.any(['.ts', '.tsx', '/index.ts', '/index.tsx'].map(extension => access(target + extension).then(() => true))).catch(() => false), `Missing source-copy export: ${statement.moduleSpecifier.text}`);
    assert.ok(statement.exportClause && ts.isNamedExports(statement.exportClause), 'Keep thumbnail exports explicit instead of pulling in the editor root');
    for (const item of statement.exportClause.elements) (statement.isTypeOnly || item.isTypeOnly ? types : runtime).push(item.name.text);
  }
  assert.deepEqual(runtime.sort(), [...expected.runtime].sort());
  assert.deepEqual(types.sort(), [...expected.types].sort());
});
