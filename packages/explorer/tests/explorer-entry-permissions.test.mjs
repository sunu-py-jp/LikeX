import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { assertExplorerEntryPermissions: check, checksForExplorerAction: forAction,
  checksForExplorerChanges: forChanges, ExplorerOperationDeniedError } = await importTypeScript('../src/model/entry-permissions.ts');

const entry = (id, parent = 'root', kind = 'folder') => ({
  id, parent, name: kind === 'file' ? `${id}.txt` : id, kind,
  size: kind === 'file' ? 5 : 0, mime: kind === 'file' ? 'text/plain' : '',
  createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', favorite: 0,
  source: kind === 'file' ? { kind: 'existing', id: `source-${id}` } : null,
});
const tree = () => [entry('folder'), entry('nested', 'folder'), entry('file', 'nested', 'file'), entry('target')];
const denied = (fn, id, operation, message) => assert.throws(fn, error => {
  assert.ok(error instanceof ExplorerOperationDeniedError);
  assert.equal(error.name, 'ExplorerOperationDeniedError');
  assert.equal(error.entryId, id); assert.equal(error.operation, operation);
  if (message) assert.equal(error.message, message);
  else assert.match(error.message, /許可/);
  return true;
});

test('omitted resolver, result and operation preserve allowed operations', () => {
  const entries = tree(), checks = [{ id: 'file', operation: 'preview' }];
  assert.doesNotThrow(() => check(entries, checks));
  assert.doesNotThrow(() => check(entries, checks, () => undefined));
  assert.doesNotThrow(() => check(entries, checks, () => ({ delete: false })));
  assert.doesNotThrow(() => check(entries, checks, () => ({ preview: { allowed: true, message: 'unused' } })));
  assert.doesNotThrow(() => check(entries, checks, () => Object.assign(Object.create(null), { preview: true })));
});

test('host denials expose operation and entry plus custom or useful default messages', () => {
  const entries = tree(), checks = [{ id: 'file', operation: 'delete' }];
  denied(() => check(entries, checks, () => ({ delete: { allowed: false, message: '別の利用者が編集中です' } })),
    'file', 'delete', '別の利用者が編集中です');
  denied(() => check(entries, checks, () => ({ delete: false })), 'file', 'delete', '「file.txt」の削除は許可されていません');
  denied(() => check(entries, checks, () => ({ delete: { allowed: false, message: '   ' } })), 'file', 'delete');
});

test('every execution reads current host state without retaining permissions', () => {
  const entries = tree(), checks = [{ id: 'file', operation: 'rename' }];
  let locked = false;
  const resolver = target => target.id === 'file' ? { rename: !locked } : undefined;
  check(entries, checks, resolver);
  locked = true;
  denied(() => check(entries, checks, resolver), 'file', 'rename');
  locked = false;
  check(entries, checks, resolver);
});

test('ancestor and virtual root permissions prevent descendant bypass', () => {
  const entries = tree(), checks = [{ id: 'file', operation: 'download' }];
  denied(() => check(entries, checks, target => target.id === 'folder' ? { download: false } : undefined), 'folder', 'download');
  denied(() => check(entries, checks, target => target.id === 'root' ? { download: false } : undefined), 'root', 'download',
    'ルートフォルダのダウンロードは許可されていません');
});

test('recursive folder checks inspect descendants and direct checks do not', () => {
  const entries = tree();
  const resolver = target => target.id === 'file' ? { copy: false, favorite: false } : undefined;
  denied(() => check(entries, [{ id: 'folder', operation: 'copy', recursive: true }], resolver), 'file', 'copy');
  check(entries, [{ id: 'folder', operation: 'favorite' }], resolver);
});

test('repeated targets and overlapping recursive checks resolve each entry once', () => {
  const calls = [];
  check(tree(), [
    { id: 'folder', operation: 'copy', recursive: true },
    { id: 'nested', operation: 'copy', recursive: true },
    { id: 'file', operation: 'copy' }, { id: 'file', operation: 'save' },
  ], target => { calls.push(target.id); return undefined; });
  assert.deepEqual(calls.sort(), ['file', 'folder', 'nested', 'root']);
});

test('resolver descriptions include paths, extensions and isolated nested source data', () => {
  const entries = tree(), original = structuredClone(entries), targets = [];
  check(entries, [{ id: 'file', operation: 'preview' }], target => {
    targets.push(structuredClone(target));
    target.name = 'changed'; target.path = 'changed';
    if (target.source) target.source.id = 'changed';
  });
  assert.deepEqual(entries, original);
  assert.equal(targets[0].path, '/folder/nested/file.txt');
  assert.equal(targets[0].extension, 'txt');
  assert.deepEqual(targets.at(-1), { id: 'root', kind: 'root', path: '/' });
});

test('malformed and asynchronous permission results fail closed', async () => {
  const entries = tree(), checks = [{ id: 'file', operation: 'preview' }];
  for (const result of [null, false, [], 'yes', new Map(), new Date(),
    { preview: null }, { preview: 1 }, { preview: { allowed: 'yes' } },
    { preview: { allowed: false, message: 2 } }, { unexpected: true },
    { then() {} }, { preview: { allowed: true, then() {} } }, Promise.resolve({ preview: true })]) {
    denied(() => check(entries, checks, () => result), 'file', 'preview');
  }
  denied(() => check(entries, checks, async () => { throw new Error('unavailable'); }), 'file', 'preview');
  await new Promise(resolve => setImmediate(resolve));
});

test('resolver exceptions and throwing permission getters fail closed', () => {
  const entries = tree(), checks = [{ id: 'file', operation: 'save' }];
  denied(() => check(entries, checks, () => { throw new Error('backend unavailable'); }), 'file', 'save');
  denied(() => check(entries, checks, () => ({ get save() { throw new Error('bad getter'); } })), 'file', 'save');
});

test('stale targets and malformed ancestor chains fail before querying the host', () => {
  let calls = 0;
  assert.throws(() => check(tree(), [{ id: 'missing', operation: 'delete' }], () => { calls++; }), /見つかりません/);
  assert.throws(() => check([entry('file', 'missing', 'file')], [{ id: 'file', operation: 'delete' }]), /見つかりません/);
  assert.throws(() => check([entry('a', 'b'), entry('b', 'a')], [{ id: 'a', operation: 'move' }]), /循環/);
  assert.equal(calls, 0);
});

test('action checks enforce recursive rename, copy, move and delete plus destinations', () => {
  const entries = tree();
  for (const operation of ['rename', 'copy', 'move', 'delete']) {
    const checks = forAction(entries, { action: operation, ids: ['folder'], parent: 'target' });
    assert.deepEqual(checks[0], { id: 'folder', operation, recursive: true });
    denied(() => check(entries, checks, target => target.id === 'file' ? { [operation]: false } : undefined), 'file', operation);
    if (operation === 'copy' || operation === 'move') {
      denied(() => check(entries, checks, target => target.id === 'target' ? { [operation]: false } : undefined), 'target', operation);
    }
  }
});

test('favorite checks only selected entries and creation checks destination kinds', () => {
  const entries = tree();
  assert.deepEqual(forAction(entries, { action: 'favorite', ids: ['folder', 'folder'] }), [
    { id: 'folder', operation: 'favorite', recursive: false },
  ]);
  assert.deepEqual(forAction(entries, { action: 'create' }), [{ id: 'root', operation: 'createFolder' }]);
  assert.deepEqual(forAction(entries, { action: 'createFile', parent: 'folder' }), [{ id: 'folder', operation: 'createFile' }]);
  assert.throws(() => forAction(entries, { action: 'delete', ids: ['missing'] }), /見つかりません/);
  assert.throws(() => forAction(entries, { action: 'delete' }), /見つかりません/);
});

test('net changes classify rename, move, favorite, overwrite and deleted subtrees', () => {
  const before = tree();
  const after = before.filter(item => item.id !== 'nested').map(item => item.id === 'file'
    ? { ...item, name: 'renamed.txt', parent: 'target', favorite: 1, source: { kind: 'existing', id: 'replacement' } } : item);
  assert.deepEqual(forChanges(before, after), [
    { id: 'nested', operation: 'delete', recursive: true },
    { id: 'file', operation: 'rename', recursive: true },
    { id: 'file', operation: 'move', recursive: true }, { id: 'target', operation: 'move' },
    { id: 'file', operation: 'favorite' }, { id: 'file', operation: 'overwrite' },
  ]);
});

test('created nested uploads check each kind on the nearest existing destination', () => {
  const before = tree();
  const after = [...before, entry('newFolder', 'target'), entry('newNested', 'newFolder'), entry('newFile', 'newNested', 'file')];
  const checks = forChanges(before, after);
  assert.deepEqual(checks, [
    { id: 'target', operation: 'createFolder' }, { id: 'target', operation: 'createFolder' },
    { id: 'target', operation: 'createFile' },
  ]);
  denied(() => check(before, checks, target => target.id === 'target' ? { createFile: false } : undefined), 'target', 'createFile');
});

test('net changes ignore timestamps, extension metadata and equal source copies', () => {
  const before = tree();
  const after = before.map(item => ({ ...item, updatedAt: 'later', extension: 'stale', source: item.source ? { ...item.source } : null }));
  assert.deepEqual(forChanges(before, after), []);
  const file = new File(['one'], 'file.txt');
  const local = [{ ...entry('file', 'root', 'file'), source: { kind: 'local', file } }];
  assert.deepEqual(forChanges(local, [{ ...local[0], source: { kind: 'local', file } }]), []);
  assert.deepEqual(forChanges(local, [{ ...local[0], source: { kind: 'local', file: new File(['one'], 'file.txt') } }]), [
    { id: 'file', operation: 'overwrite' },
  ]);
});

test('large overlapping subtree checks keep resolver calls proportional to entry count', () => {
  const entries = Array.from({ length: 500 }, (_, index) => entry(`item-${index}`, index ? `item-${index - 1}` : 'root'));
  let calls = 0;
  check(entries, entries.map(item => ({ id: item.id, operation: 'delete', recursive: true })), () => { calls++; });
  assert.equal(calls, entries.length + 1);
});
