import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { DEFAULT_ROOT_LABEL, formatExplorerPath, resolveExplorerPath } = await importTypeScript('../src/model/path.ts');
const folder = (id, parent, name) => ({ id, parent, name, kind: 'folder' });
const entries = [
  folder('projects', 'root', 'Projects'),
  folder('design', 'projects', '設計 資料'),
  folder('release', 'design', 'Release Notes'),
  folder('photos', 'root', '画像'),
  folder('japanese', 'photos', 'ガイド'),
  folder('accent', 'root', 'Café'),
  folder('literal-root', 'root', 'ファイル'),
  folder('literal-child', 'literal-root', '内容'),
  folder('english-files', 'root', 'files'),
  folder('articles', 'root', '記事一覧'),
  folder('article-drafts', 'articles', '草稿'),
  folder('legacy-label', 'root', 'マイファイル'),
  { id: 'document', parent: 'projects', name: 'report.txt', kind: 'file' },
];

test('canonical addresses use folder names from root and round trip to the same ID', () => {
  assert.equal(formatExplorerPath(entries, 'root'), '/');
  assert.equal(formatExplorerPath(entries, 'release'), '/Projects/設計 資料/Release Notes');
  for (const entry of entries.filter(entry => entry.kind === 'folder')) {
    assert.equal(resolveExplorerPath(entries, formatExplorerPath(entries, entry.id)), entry.id);
  }
});

test('absolute paths ignore the current folder and preserve spaces inside names', () => {
  assert.equal(resolveExplorerPath(entries, '/', 'release'), 'root');
  assert.equal(resolveExplorerPath(entries, '\\', 'release'), 'root');
  assert.equal(resolveExplorerPath(entries, '  /Projects/設計 資料/Release Notes  ', 'photos'), 'release');
  assert.equal(resolveExplorerPath(entries, '/Projects/設計 資料/', 'missing'), 'design');
  assert.throws(() => resolveExplorerPath(entries, '/Projects/設計資料'), /設計資料.*見つかりません/);
});

test('relative paths use the current folder with dot segments and root-clamped parents', () => {
  assert.equal(resolveExplorerPath(entries, '設計 資料', 'projects'), 'design');
  assert.equal(resolveExplorerPath(entries, './Release Notes', 'design'), 'release');
  assert.equal(resolveExplorerPath(entries, '.', 'release'), 'release');
  assert.equal(resolveExplorerPath(entries, '..', 'release'), 'design');
  assert.equal(resolveExplorerPath(entries, '../../画像/ガイド', 'design'), 'japanese');
  assert.equal(resolveExplorerPath(entries, '../../../..', 'design'), 'root');
  assert.equal(resolveExplorerPath(entries, '../../Projects', 'root'), 'projects');
});

test('unprefixed ファイル is the default root alias while absolute and dot-relative ファイル stay literal', () => {
  assert.equal(DEFAULT_ROOT_LABEL, 'ファイル');
  assert.equal(resolveExplorerPath(entries, 'ファイル', 'release'), 'root');
  assert.equal(resolveExplorerPath(entries, 'ファイル/Projects/設計 資料', 'photos'), 'design');
  assert.equal(resolveExplorerPath(entries, 'ファイル\\画像\\ガイド', 'projects'), 'japanese');
  assert.equal(resolveExplorerPath(entries, '/ファイル'), 'literal-root');
  assert.equal(resolveExplorerPath(entries, '/ファイル/内容'), 'literal-child');
  assert.equal(resolveExplorerPath(entries, './ファイル'), 'literal-root');
  assert.equal(resolveExplorerPath(entries, './ファイル/内容'), 'literal-child');
  assert.equal(formatExplorerPath(entries, 'literal-child'), '/ファイル/内容');
});

test('custom root labels replace the default alias without hiding same-named folders', () => {
  assert.equal(resolveExplorerPath(entries, '記事一覧', 'release', '記事一覧'), 'root');
  assert.equal(resolveExplorerPath(entries, '記事一覧/Projects/設計 資料', 'photos', '記事一覧'), 'design');
  assert.equal(resolveExplorerPath(entries, '/記事一覧', 'release', '記事一覧'), 'articles');
  assert.equal(resolveExplorerPath(entries, '/記事一覧/草稿', 'release', '記事一覧'), 'article-drafts');
  assert.equal(resolveExplorerPath(entries, './記事一覧/草稿', 'root', '記事一覧'), 'article-drafts');
  assert.equal(resolveExplorerPath(entries, 'ファイル', 'root', '記事一覧'), 'literal-root');
  assert.throws(() => resolveExplorerPath(entries, 'ファイル', 'release', '記事一覧'), /ファイル.*見つかりません/);
  assert.equal(formatExplorerPath(entries, 'article-drafts'), '/記事一覧/草稿');
});

test('root label matching trims labels, defaults blank labels, and normalizes Unicode and case', () => {
  assert.equal(resolveExplorerPath(entries, '記事一覧/画像', 'release', '  記事一覧  '), 'photos');
  for (const label of ['', ' \t\n ']) {
    assert.equal(resolveExplorerPath(entries, 'ファイル', 'release', label), 'root');
    assert.equal(resolveExplorerPath(entries, '/ファイル', 'release', label), 'literal-root');
  }
  assert.equal(resolveExplorerPath(entries, 'FiLeS', 'release', ' files '), 'root');
  assert.equal(resolveExplorerPath(entries, 'CAFÉ/Projects', 'photos', 'cafe\u0301'), 'projects');
  assert.equal(resolveExplorerPath(entries, '/CAFÉ', 'release', 'cafe\u0301'), 'accent');
});

test('files is an ordinary folder name by default and remains available as a custom alias', () => {
  assert.equal(resolveExplorerPath(entries, 'files'), 'english-files');
  assert.throws(() => resolveExplorerPath(entries, 'files', 'release'), /files.*見つかりません/);
  assert.equal(resolveExplorerPath(entries, 'FILES/Projects', 'release', 'files'), 'projects');
  assert.equal(resolveExplorerPath(entries, '/files', 'release', 'files'), 'english-files');
  assert.equal(resolveExplorerPath(entries, './files', 'root', 'files'), 'english-files');
});

test('the former マイファイル label has no special meaning unless explicitly configured', () => {
  assert.equal(resolveExplorerPath(entries, 'マイファイル'), 'legacy-label');
  assert.throws(() => resolveExplorerPath(entries, 'マイファイル', 'release'), /マイファイル.*見つかりません/);
  assert.equal(resolveExplorerPath(entries, 'マイファイル', 'release', 'マイファイル'), 'root');
});

test('dot segments remain relative even when the display label is dot or dot-dot', () => {
  assert.equal(resolveExplorerPath(entries, '.', 'release', '.'), 'release');
  assert.equal(resolveExplorerPath(entries, '..', 'release', '..'), 'design');
  assert.equal(resolveExplorerPath(entries, './Release Notes', 'design', '.'), 'release');
  assert.equal(resolveExplorerPath(entries, '../Release Notes', 'release', '..'), 'release');
});

test('backslashes, mixed separators and repeated internal separators resolve locally', () => {
  assert.equal(resolveExplorerPath(entries, '\\Projects\\設計 資料\\Release Notes'), 'release');
  assert.equal(resolveExplorerPath(entries, '/Projects\\設計 資料/Release Notes'), 'release');
  assert.equal(resolveExplorerPath(entries, 'Projects//設計 資料\\\\Release Notes'), 'release');
  assert.equal(resolveExplorerPath(entries, '..\\画像', 'projects'), 'photos');
});

test('matching uses the draft model Unicode normalization and case-insensitive names', () => {
  assert.equal(resolveExplorerPath(entries, '/pRoJeCtS/設計 資料/release notes'), 'release');
  assert.equal(resolveExplorerPath(entries, '/CAFE\u0301'), 'accent');
  assert.equal(resolveExplorerPath(entries, '/画像/カ\u3099イド'), 'japanese');
  assert.equal(formatExplorerPath(entries, 'accent'), '/Café');
});

test('empty, missing and file destinations report errors without silently navigating', () => {
  for (const value of ['', '   ', '\t\n']) assert.throws(() => resolveExplorerPath(entries, value), /パスを入力/);
  assert.throws(() => resolveExplorerPath(entries, '/missing'), /missing.*見つかりません/);
  assert.throws(() => resolveExplorerPath(entries, '/Projects/report.txt'), /report.txt.*ファイル/);
  assert.throws(() => resolveExplorerPath(entries, '/Projects/report.txt/..'), /ファイル/);
  assert.throws(() => resolveExplorerPath(entries, '.', 'document'), /ファイル/);
  assert.throws(() => resolveExplorerPath(entries, '.', 'missing'), /見つかりません/);
});

test('URLs, OS drives and network shares cannot be interpreted as draft addresses', () => {
  for (const value of [
    'https://example.com/Projects',
    'file:///Projects',
    's3://bucket/Projects',
    'C:\\Projects',
    'C:/Projects',
    '\\\\server\\share',
    '//server/share',
  ]) assert.throws(() => resolveExplorerPath(entries, value), /このエクスプローラー内/);
});

test('missing, file and malformed ancestor chains cannot produce misleading addresses', () => {
  assert.throws(() => formatExplorerPath(entries, 'missing'), /見つかりません/);
  assert.throws(() => formatExplorerPath(entries, 'document'), /ファイル/);
  assert.throws(() => formatExplorerPath([folder('orphan', 'missing', 'Orphan')], 'orphan'), /見つかりません/);
  const cycle = [folder('one', 'two', 'One'), folder('two', 'one', 'Two')];
  assert.throws(() => formatExplorerPath(cycle, 'one'), /循環/);
  assert.throws(() => resolveExplorerPath(cycle, '..', 'one'), /循環/);
});

test('formatting and resolution never mutate the supplied draft, even on failure', () => {
  const frozen = Object.freeze(entries.map(entry => Object.freeze({ ...entry })));
  const before = structuredClone(frozen);
  assert.equal(formatExplorerPath(frozen, 'release'), '/Projects/設計 資料/Release Notes');
  assert.equal(resolveExplorerPath(frozen, '../設計 資料/Release Notes', 'design'), 'release');
  assert.throws(() => resolveExplorerPath(frozen, '/Projects/missing'), /見つかりません/);
  assert.deepEqual(frozen, before);
});
