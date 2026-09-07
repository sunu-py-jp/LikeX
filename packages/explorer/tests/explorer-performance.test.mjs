import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export * from './src/model/draft.ts';
  export * from './src/model/entry-index.ts';
  export * from './src/model/item-info.ts';
  export * from './src/model/text.ts';
`, resolveDir: packageRoot, sourcefile: 'performance-regression.ts' },
bundle: true, platform: 'node', format: 'esm', write: false });
const { createSnapshot, createDraftSnapshot, applyAction, addFiles, hasChanges, getSavePayload,
  getEntryIndex, describeEntry, describeEntries, naturalNameOrder } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const entry = (id, parent = 'root', kind = 'file') => ({ id, parent, name: kind === 'folder' ? id : `${id}.txt`,
  kind, size: 0, mime: 'text/plain', createdAt: '2026-09-06', updatedAt: '2026-09-06', favorite: 0,
  source: kind === 'folder' ? null : { kind: 'existing', id: `content-${id}` } });

test('internal edits share unchanged immutable entries while keeping host inputs and payloads isolated', () => {
  const input = [entry('folder', 'root', 'folder'), entry('a', 'folder'), entry('b')];
  const baseline = createDraftSnapshot(input);
  input[1].name = 'host.txt';
  const next = applyAction(baseline, { action: 'rename', ids: ['b'], name: 'changed.txt' });
  assert.equal(next.entries[0], baseline.entries[0]);
  assert.equal(next.entries[1], baseline.entries[1]);
  assert.notEqual(next.entries[2], baseline.entries[2]);
  assert.equal(next.entries[2].source, baseline.entries[2].source);
  assert.equal(baseline.entries[1].name, 'a.txt');
  assert.ok(Object.isFrozen(next.entries) && Object.isFrozen(next.entries[2].source));
  const payload = getSavePayload(baseline, next);
  payload.entries[1].source.id = 'changed-by-host';
  assert.equal(next.entries[1].source.id, 'content-a');
  assert.equal(applyAction(next, { action: 'rename', ids: ['b'], name: 'changed.txt' }), next);
  assert.equal(addFiles(next, [], 'root'), next);
});

test('folder edits refresh descendant paths without cloning unchanged descendants', () => {
  const baseline = createDraftSnapshot([entry('from', 'root', 'folder'), entry('to', 'root', 'folder'), entry('a', 'from')]);
  assert.equal(describeEntry(baseline.entries, baseline.entries[2]).path, '/from/a.txt');
  const moved = applyAction(baseline, { action: 'move', ids: ['from'], parent: 'to' });
  assert.equal(moved.entries[2], baseline.entries[2]);
  assert.equal(describeEntry(moved.entries, moved.entries[2]).path, '/to/from/a.txt');
  assert.equal(describeEntry(baseline.entries, baseline.entries[2]).path, '/from/a.txt');
  const renamed = applyAction(moved, { action: 'rename', ids: ['from'], name: 'new' });
  assert.equal(describeEntry(renamed.entries, renamed.entries[2]).path, '/to/new/a.txt');
  assert.deepEqual(getSavePayload(baseline, renamed).changes.updated.map(entry => entry.id), ['from']);
});

test('shared indexes are reused only for immutable inputs; mutable caller data stays fresh', () => {
  const snapshot = createDraftSnapshot([entry('a')]);
  assert.equal(getEntryIndex(snapshot.entries), getEntryIndex(snapshot.entries));
  const mutable = createSnapshot(snapshot.entries);
  assert.notEqual(getEntryIndex(mutable.entries), getEntryIndex(mutable.entries));
  mutable.entries[0].name = 'new.txt';
  assert.equal(getEntryIndex(mutable.entries).namesByParent.get('root').get('new.txt').id, 'a');
});

test('describing every immutable entry reads metadata linearly, not once per entry pair', () => {
  let reads = 0;
  const entries = Object.freeze(Array.from({ length: 1000 }, (_, index) => Object.freeze({
    ...entry(`a-${index}`), get name() { reads++; return `a-${index}.txt`; },
  })));
  const descriptions = entries.map(item => describeEntry(entries, item));
  assert.equal(descriptions.length, 1000);
  assert.ok(reads < 20 * entries.length, `metadata reads: ${reads}`);
  const payload = describeEntries(entries);
  payload[0].source.id = 'observer';
  assert.equal(entries[0].source.id, 'content-a-0');
});

test('memoized net changes still clear after reversal and survive payload mutation', () => {
  const baseline = createDraftSnapshot([entry('a')]);
  const changed = applyAction(baseline, { action: 'rename', ids: ['a'], name: 'new.txt' });
  assert.equal(hasChanges(baseline, changed), true);
  getSavePayload(baseline, changed).changes.updated.pop();
  assert.equal(getSavePayload(baseline, changed).changes.updated.length, 1);
  const reverted = applyAction(changed, { action: 'rename', ids: ['a'], name: 'a.txt' });
  assert.equal(hasChanges(baseline, reverted), false);
});

test('batch naming indexes preserve case-insensitive collisions, hierarchy and atomic failures', () => {
  const initial = createDraftSnapshot([]);
  const files = Array.from({ length: 1000 }, (_, index) => new File(['x'], index ? `report-${index}.txt` : 'report.txt'));
  files.push(new File(['second content'], 'REPORT.TXT'));
  let error;
  assert.throws(() => addFiles(initial, files, 'root'), caught => { error = caught; return caught.name === 'ExplorerUploadConflictError'; });
  assert.equal(error.conflict.fileIndex, 1000); assert.equal(error.conflict.existing.source.file, files[0]);
  assert.equal(initial.entries.length, 0, 'a collision never commits earlier batch entries');
  const next = addFiles(initial, files, 'root', undefined,
    [{ fileIndex: 1000, existing: error.conflict.existing, action: 'skip' }], error.session);
  assert.equal(next.entries[0].name, 'report.txt');
  assert.equal(next.entries.at(-1).name, 'report-999.txt');
  assert.equal(next.entries[0].source.file, files[0]);
  assert.equal(new Set(next.entries.map(item => item.name)).size, 1000);
  const copied = applyAction(next, { action: 'copy', ids: [next.entries[0].id], parent: 'root' });
  assert.equal(copied.entries.at(-1).name, 'report (2).txt', 'internal copy keeps its existing suffix behavior');
  assert.equal(copied.entries.at(-1).source.file, files[0]);
  assert.throws(() => addFiles(next, [new File(['x'], 'valid.txt'), new File(['x'], 'bad?.txt')], 'root'));
  assert.equal(next.entries.length, 1000);
});

test('reused natural collator preserves the existing Japanese numeric ordering', () => {
  const names = ['item10', 'item2', 'item01', 'Ａ', 'a', 'A', '資料12', '資料2', '2026-09-01'];
  assert.deepEqual([...names].sort(naturalNameOrder.compare), [...names].sort((a, b) => a.localeCompare(b, 'ja', { numeric: true })));
});
