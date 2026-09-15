import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `export { projectExplorerImportPreview } from './src/state/import-preview.ts';`, resolveDir: packageRoot },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { projectExplorerImportPreview: project } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const entry = (id, name, parent = 'root', kind = 'file') => Object.freeze({ id, name, parent, kind,
  extension: kind === 'file' ? name.split('.').at(-1).toLowerCase() : '', size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id } : null,
  createdAt: '2026-09-06T00:00:00Z', updatedAt: '2026-09-06T00:00:00Z', favorite: 0 });
const item = (path, id = path) => ({ entry: { ...entry(`temporary:${id}`, path.split('/').at(-1)), source: null }, relativePath: path });
const preview = (paths, parent = 'root') => ({ id: 'batch-one', parent, entries: paths.map(path => typeof path === 'string' ? item(path) : path) });
const children = (result, parent = 'root') => result.pendingEntriesByParent.get(parent) ?? [];
const names = (result, parent = 'root') => children(result, parent).map(value => value.entry.name);

test('directory imports appear as a navigable hierarchy, never as root-level flattened files', () => {
  const original = Object.freeze([entry('saved', 'Saved.txt')]);
  const result = project(preview(['Folder/A.txt', 'Folder/Nested/B.txt', 'Folder/Nested/C.txt']), original);
  assert.deepEqual(names(result), ['Folder']);
  const folder = children(result)[0].entry;
  assert.equal(folder.kind, 'folder');
  assert.deepEqual(names(result, folder.id), ['A.txt', 'Nested']);
  const nested = children(result, folder.id)[1].entry;
  assert.deepEqual(names(result, nested.id), ['B.txt', 'C.txt']);
  assert.deepEqual(result.navigationEntries.map(value => value.name), ['Saved.txt', 'Folder', 'Nested']);
  assert.equal(result.navigationEntries[0], original[0]);
  assert.equal(result.navigationEntries.filter(value => value.kind === 'file').length, 1);
  assert.deepEqual([...result.folderPaths.values()], ['/Folder', '/Folder/Nested']);
  for (const id of ['root', folder.id, nested.id, ...children(result, nested.id).map(value => value.entry.id)]) {
    assert.ok(result.importingEntryIds.has(id), `${id} has a pending descendant or is pending itself`);
  }
  assert.equal(result.importingEntryIds.has('saved'), false);
  assert.equal(result.fileCount, 3);
});

test('a merge reuses existing folder IDs and marks existing overwrite targets without duplicate rows', () => {
  const original = Object.freeze([
    entry('folder', 'Folder', 'root', 'folder'), entry('nested', 'Nested', 'folder', 'folder'),
    entry('saved', 'A.txt', 'nested'), entry('untouched', 'Keep.txt', 'nested'),
  ]);
  const result = project(preview(['folder/nested/a.TXT', 'Folder/Nested/B.txt']), original);
  assert.deepEqual(names(result), []);
  assert.deepEqual(names(result, 'folder'), []);
  assert.deepEqual(names(result, 'nested'), ['B.txt']);
  assert.equal(result.navigationEntries, original);
  assert.equal(result.folderPaths.size, 0);
  assert.deepEqual(new Set(result.importingEntryIds), new Set(['root', 'folder', 'nested', 'saved', 'temporary:Folder/Nested/B.txt']));
  assert.equal(result.importingEntryIds.has('untouched'), false);
});

test('ancestors of a nested destination spin while sibling folders remain untouched', () => {
  const original = Object.freeze([
    entry('parent', 'Projects', 'root', 'folder'), entry('destination', 'Current', 'parent', 'folder'),
    entry('sibling', 'Archive', 'parent', 'folder'),
  ]);
  const result = project(preview(['Import/Docs/A.txt'], 'destination'), original);
  const folder = children(result, 'destination')[0].entry;
  const docs = children(result, folder.id)[0].entry;
  assert.deepEqual(names(result), []);
  assert.equal(result.folderPaths.get(folder.id), '/Projects/Current/Import');
  assert.equal(result.folderPaths.get(docs.id), '/Projects/Current/Import/Docs');
  assert.ok(['root', 'parent', 'destination', folder.id, docs.id].every(id => result.importingEntryIds.has(id)));
  assert.equal(result.importingEntryIds.has('sibling'), false);
});

test('temporary directory IDs remain stable when discoveries grow, reorder, or are omitted', () => {
  const first = project(preview(['Folder/Nested/A.txt', 'Folder/Nested/B.txt']), []);
  const second = project(preview(['folder/nested/B.txt', 'folder/Other/C.txt']), []);
  const third = project(preview(['Folder/Other/C.txt', 'Folder/Nested/B.txt']), []);
  const folderIds = result => result.navigationEntries.map(value => value.id);
  assert.equal(folderIds(first)[0], folderIds(second)[0]);
  assert.equal(folderIds(first)[1], folderIds(second)[1]);
  assert.deepEqual(new Set(folderIds(second)), new Set(folderIds(third)));
  const anotherBatch = project({ ...preview(['Folder/Nested/B.txt']), id: 'batch-two' }, []);
  assert.notEqual(folderIds(first)[0], folderIds(anotherBatch)[0]);
});

test('normalized Unicode and case variants share provisional parent folders', () => {
  const result = project(preview(['Café/A.txt', 'CAFE\u0301/B.txt']), []);
  assert.deepEqual(names(result), ['Café']);
  assert.deepEqual(names(result, children(result)[0].entry.id), ['A.txt', 'B.txt']);
  assert.equal(result.navigationEntries.length, 1);
});

test('the same filename at different paths retains independent pending identities', () => {
  const result = project(preview(['One/A.txt', 'Two/A.txt']), []);
  assert.deepEqual(names(result), ['One', 'Two']);
  const ids = children(result).map(({ entry: folder }) => children(result, folder.id)[0].entry.id);
  assert.notEqual(ids[0], ids[1]);
  assert.equal(result.fileCount, 2);
});

test('a file where an incoming directory is required never creates a duplicate folder or children beneath the file', () => {
  const original = Object.freeze([entry('blocker', 'Folder')]);
  const result = project(preview(['Folder/Nested/A.txt']), original);
  assert.equal(result.navigationEntries, original);
  assert.equal(result.pendingEntriesByParent.size, 0);
  assert.deepEqual(new Set(result.importingEntryIds), new Set(['blocker', 'root']));
});

test('clearing an import or omitting its last child removes all provisional folders and activity', () => {
  const original = Object.freeze([entry('saved', 'A.txt')]);
  for (const current of [null, preview([])]) {
    const result = project(current, original);
    assert.equal(result.navigationEntries, original);
    assert.equal(result.pendingEntriesByParent.size, 0);
    assert.equal(result.importingEntryIds.size, 0);
    assert.equal(result.folderPaths.size, 0);
    assert.equal(result.fileCount, 0);
  }
});

test('a removed import destination cannot produce orphan navigation entries', () => {
  const original = Object.freeze([entry('saved', 'A.txt')]);
  const result = project(preview(['Folder/A.txt'], 'removed-folder'), original);
  assert.equal(result.navigationEntries, original);
  assert.equal(result.pendingEntriesByParent.size, 0);
  assert.equal(result.importingEntryIds.size, 0);
});

test('large imports build only directory navigation entries and distribute files among their own parents', () => {
  const paths = Array.from({ length: 10000 }, (_, index) => `Import/Folder-${Math.floor(index / 500)}/File-${index}.txt`);
  const result = project(preview(paths), []);
  assert.equal(result.navigationEntries.length, 21);
  assert.equal(result.fileCount, 10000);
  assert.deepEqual(names(result), ['Import']);
  const root = children(result)[0].entry;
  assert.equal(children(result, root.id).length, 20);
  for (const { entry: folder } of children(result, root.id)) assert.equal(children(result, folder.id).length, 500);
  assert.equal(result.importingEntryIds.size, 10022);
});
