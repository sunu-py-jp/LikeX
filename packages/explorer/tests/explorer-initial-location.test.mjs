import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { resolveInitialExplorerLocation } = await importTypeScript('../src/model/initial-location.ts');
const folder = (id, parent, name) => ({ id, parent, name, kind: 'folder' });
const file = (id, parent, name) => ({ id, parent, name, kind: 'file' });
const initialEntries = [
  folder('projects', 'root', 'Projects'),
  folder('design', 'projects', '設計 資料'),
  folder('photos', 'root', '画像'),
  file('design-file', 'design', 'report.txt'),
  file('other-file', 'photos', 'report.txt'),
  file('root-file', 'root', 'README.md'),
];
const resolve = options => resolveInitialExplorerLocation({ initialEntries, ...options });

test('default and initial folder paths preserve root aliases and ancestor expansion', () => {
  assert.deepEqual(resolve({}), { location: 'root', expanded: ['root'], error: null, selectedFileId: null });
  assert.deepEqual(resolve({ defaultPath: '/Projects/設計 資料' }), {
    location: 'design', expanded: ['root', 'projects', 'design'], error: null, selectedFileId: null,
  });
  assert.deepEqual(resolve({ initialPath: '資料/画像', defaultPath: '/Projects', rootLabel: '資料' }), {
    location: 'photos', expanded: ['root', 'photos'], error: null, selectedFileId: null,
  });
  assert.equal(resolve({ initialPath: '/', defaultPath: '/Projects' }).location, 'root');
});

test('initial paths use the address bar rules instead of IDs or external paths', () => {
  assert.equal(resolve({ initialPath: 'projects\\設計 資料' }).location, 'design');
  for (const initialPath of ['/missing', '/Projects/設計 資料/report.txt', 'https://example.com/Projects', 'design']) {
    const result = resolve({ initialPath, defaultPath: '/Projects', selectedFile: 'root-file' });
    assert.equal(result.location, 'root');
    assert.deepEqual(result.expanded, ['root']);
    assert.equal(result.selectedFileId, null);
    assert.ok(result.error, initialPath);
  }
  assert.equal(resolve({ defaultPath: '   ' }).error, null);
  assert.ok(resolve({ defaultPath: '/missing' }).error);
});

test('blank initial paths explicitly open root rather than the selected file parent', () => {
  for (const initialPath of ['', '   ']) {
    assert.deepEqual(resolve({ initialPath, selectedFile: 'root-file' }), {
      location: 'root', expanded: ['root'], error: null, selectedFileId: 'root-file',
    });
    const result = resolve({ initialPath, defaultPath: '/画像', selectedFile: 'design-file' });
    assert.equal(result.location, 'root');
    assert.equal(result.selectedFileId, null);
    assert.match(result.error, /初期フォルダにありません/);
  }
});

test('matching selected file IDs select files in the requested initial folder', () => {
  assert.deepEqual(resolve({ initialPath: '/Projects/設計 資料', selectedFile: 'design-file' }), {
    location: 'design', expanded: ['root', 'projects', 'design'], error: null, selectedFileId: 'design-file',
  });
  assert.deepEqual(resolve({ initialPath: '/', selectedFile: 'root-file' }), {
    location: 'root', expanded: ['root'], error: null, selectedFileId: 'root-file',
  });
});

test('selected file alone opens its parent even if defaultPath points elsewhere or is invalid', () => {
  for (const defaultPath of [undefined, '/画像', '/missing']) {
    assert.deepEqual(resolve({ selectedFile: 'design-file', defaultPath }), {
      location: 'design', expanded: ['root', 'projects', 'design'], error: null, selectedFileId: 'design-file',
    });
  }
  assert.equal(resolve({ selectedFile: 'root-file', defaultPath: '/画像' }).location, 'root');
});

test('an explicit initial folder stays open when the selected file belongs to a different folder', () => {
  const result = resolve({ initialPath: '/画像', selectedFile: 'design-file' });
  assert.equal(result.location, 'photos');
  assert.deepEqual(result.expanded, ['root', 'photos']);
  assert.equal(result.selectedFileId, null);
  assert.match(result.error, /初期フォルダにありません/);
});

test('missing IDs, filenames and folder IDs never become a file selection or override the configured folder', () => {
  for (const selectedFile of ['missing', 'report.txt', '/Projects/設計 資料/report.txt', '', 'design']) {
    for (const options of [{ initialPath: '/画像' }, { defaultPath: '/画像' }]) {
      const result = resolve({ ...options, selectedFile });
      assert.equal(result.location, 'photos');
      assert.equal(result.selectedFileId, null);
      assert.ok(result.error, selectedFile);
    }
  }
  assert.match(resolve({ selectedFile: 'design' }).error, /フォルダ/);
});

test('invalid file ancestor chains cannot become an initial location', () => {
  for (const extra of [
    [file('broken', 'missing', 'broken.txt')],
    [folder('cycle', 'cycle', 'Cycle'), file('broken', 'cycle', 'broken.txt')],
    [file('broken', 'root-file', 'broken.txt')],
  ]) {
    const result = resolveInitialExplorerLocation({ initialEntries: [...initialEntries, ...extra], selectedFile: 'broken' });
    assert.equal(result.location, 'root');
    assert.equal(result.selectedFileId, null);
    assert.ok(result.error);
  }
});

test('initial resolution does not mutate entries or its options', () => {
  const entries = Object.freeze(initialEntries.map(entry => Object.freeze({ ...entry })));
  const options = Object.freeze({ initialEntries: entries, initialPath: '/Projects/設計 資料', selectedFile: 'design-file' });
  const before = structuredClone(options);
  assert.equal(resolveInitialExplorerLocation(options).selectedFileId, 'design-file');
  assert.deepEqual(options, before);
});
