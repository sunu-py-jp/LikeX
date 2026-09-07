import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from "./import-typescript.mjs";
const { createSnapshot, createDraftSnapshot, applyAction, addFiles, addFilesWithResult, getSavePayload, hasChanges } = await importTypeScript("../src/model/draft.ts");

const entry = (id, parent, name, kind = 'folder') => ({
  id, parent, name, kind, size: kind === 'file' ? 4 : 0,
  extension: kind === 'file' && name.lastIndexOf('.') > 0 ? name.slice(name.lastIndexOf('.') + 1).normalize('NFC').toLowerCase() : '',
  mime: kind === 'file' ? 'text/plain' : '',
  createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-01T00:00:00.000Z',
  favorite: 0, source: kind === 'file' ? { kind: 'existing', id: `content-${id}` } : null,
});
const initial = () => createSnapshot([
  entry('a', 'root', 'Design'), entry('b', 'a', 'Details'),
  entry('c', 'b', 'report.txt', 'file'), entry('d', 'root', 'Archive'),
]);
const byId = (snapshot, id) => snapshot.entries.find(item => item.id === id);
const upload = (name, relativePath = '', bytes = 'new content') => {
  const file = new File([bytes], name, { type: 'text/plain' });
  if (relativePath) Object.defineProperty(file, 'webkitRelativePath', { value: relativePath });
  return file;
};
function conflictOf(callback) {
  let caught;
  try { callback(); } catch (error) { caught = error; }
  assert.equal(caught?.name, 'ExplorerUploadConflictError', 'a collision needs an explicit overwrite or skip decision');
  return { ...caught.conflict, session: caught.session };
}
const decide = (conflict, action = 'overwrite') => ({ fileIndex: conflict.fileIndex, existing: conflict.existing, action });

test('snapshot boundaries derive normalized extensions from names and ignore missing or stale supplied values', () => {
  const supplied = [entry('plain', 'root', 'README', 'file'), entry('dot', 'root', '.env', 'file'),
    entry('compound', 'root', 'Archive.TAR.GZ', 'file'), entry('folder', 'root', 'Folder.TXT'),
    { ...entry('trim', 'root', '  Document.PDF  ', 'file'), extension: 'incorrect' },
    { ...entry('unicode', 'root', 'file.E\u0301', 'file'), extension: 'wrong' }];
  for (const item of supplied.slice(0, 4)) delete item.extension;
  const snapshot = createDraftSnapshot(supplied);
  assert.deepEqual(snapshot.entries.map(item => item.extension), ['', '', 'gz', '', 'pdf', 'é']);
  assert.equal(snapshot.entries[4].name, 'Document.PDF'); assert.equal(snapshot.entries[5].name, 'file.É');
  assert.equal(supplied[4].extension, 'incorrect'); assert.equal(supplied[4].name, '  Document.PDF  ');
  assert.equal(Object.hasOwn(supplied[0], 'extension'), false);
  assert.ok(snapshot.entries.every(item => Object.hasOwn(item, 'extension')));
  assert.equal(hasChanges(snapshot, snapshot), false);
});

test('create, upload, low-level rename, copy and move keep extensions aligned without cloning untouched entries', () => {
  const baseline = createDraftSnapshot([entry('keep', 'root', 'Keep.TXT', 'file')]);
  let snapshot = applyAction(baseline, { action: 'create', name: 'Folder.ZIP' });
  const folder = snapshot.entries.at(-1); assert.equal(folder.extension, '');
  snapshot = applyAction(snapshot, { action: 'createFile', name: 'Empty.TXT' });
  const empty = snapshot.entries.at(-1); assert.equal(empty.extension, 'txt');
  const file = upload('Archive.TAR.GZ');
  snapshot = addFiles(snapshot, [file], 'root');
  const uploaded = snapshot.entries.at(-1); assert.equal(uploaded.extension, 'gz');
  snapshot = applyAction(snapshot, { action: 'rename', ids: [uploaded.id], name: 'Changed.PDF' });
  assert.equal(byId(snapshot, uploaded.id).extension, 'pdf'); assert.equal(byId(snapshot, uploaded.id).source.file, file);
  snapshot = applyAction(snapshot, { action: 'move', ids: [uploaded.id], parent: folder.id });
  snapshot = applyAction(snapshot, { action: 'copy', ids: [uploaded.id], parent: 'root' });
  const copied = snapshot.entries.at(-1); assert.equal(copied.extension, 'pdf'); assert.equal(copied.source.file, file);
  snapshot = applyAction(snapshot, { action: 'rename', ids: [uploaded.id], name: '.env' });
  assert.equal(byId(snapshot, uploaded.id).extension, '');
  assert.equal(byId(snapshot, 'keep'), baseline.entries[0], 'normalizing a changed entry does not clone unchanged entries');
  assert.ok(getSavePayload(baseline, snapshot).entries.every(item => Object.hasOwn(item, 'extension')));
});

test('derived-extension differences alone are not dirty and save boundary copies repair stale values', () => {
  const baseline = createSnapshot([entry('same', 'root', 'Same.TXT', 'file')]);
  const stale = { entries: [{ ...baseline.entries[0], extension: 'wrong' }] };
  assert.equal(hasChanges(baseline, stale), false);
  const payload = getSavePayload(baseline, stale);
  assert.equal(payload.entries[0].extension, 'txt'); assert.equal(stale.entries[0].extension, 'wrong');
  assert.deepEqual(payload.changes, { created: [], updated: [], deleted: [] });
  const removed = applyAction(stale, { action: 'delete', ids: ['same'] });
  assert.equal(getSavePayload(stale, removed).changes.deleted[0].extension, 'txt');
});

test('host data and source wrappers are copied while immutable File objects retain identity', () => {
  const file = upload('local.txt');
  const supplied = [entry('a', 'root', 'stored.txt', 'file'), {
    ...entry('b', 'root', 'local.txt', 'file'), source: { kind: 'local', file },
  }];
  const snapshot = createSnapshot(supplied);
  supplied[0].name = 'changed externally.txt';
  supplied[0].source.id = 'changed externally';
  supplied[1].source.file = upload('other.txt');
  supplied.push(entry('c', 'root', 'external'));
  assert.equal(snapshot.entries.length, 2);
  assert.equal(byId(snapshot, 'a').name, 'stored.txt');
  assert.equal(byId(snapshot, 'a').source.id, 'content-a');
  assert.equal(byId(snapshot, 'b').source.file, file);
});

test('new folders and uploaded files can be moved then deleted without any net save changes', () => {
  const baseline = initial();
  let draft = applyAction(baseline, { action: 'create', parent: 'a', name: 'New folder' });
  const folder = draft.entries.find(item => item.name === 'New folder');
  draft = addFiles(draft, [upload('new.txt')], folder.id);
  draft = applyAction(draft, { action: 'move', ids: [folder.id], parent: 'd' });
  assert.equal(hasChanges(baseline, draft), true);
  draft = applyAction(draft, { action: 'delete', ids: [folder.id] });
  assert.equal(hasChanges(baseline, draft), false);
  assert.deepEqual(getSavePayload(baseline, draft).changes, { created: [], updated: [], deleted: [] });
  assert.deepEqual(draft, baseline);
});

test('renaming and moving an existing tree retain IDs and immutable content references', () => {
  const baseline = initial();
  let draft = applyAction(baseline, { action: 'rename', ids: ['a'], name: 'Design revised' });
  const renamed = draft;
  draft = applyAction(draft, { action: 'move', ids: ['a', 'b', 'c'], parent: 'd' });
  for (const before of renamed.entries) {
    assert.deepEqual(byId(draft, before.id), { ...before, parent: before.id === 'a' ? 'd' : before.parent });
  }
  assert.equal(byId(draft, 'a').parent, 'd');
  assert.equal(byId(draft, 'b').parent, 'a');
  assert.equal(byId(draft, 'c').parent, 'b');
  assert.deepEqual(byId(draft, 'c').source, { kind: 'existing', id: 'content-c' });
  assert.equal(byId(baseline, 'a').name, 'Design');
  assert.equal(byId(baseline, 'a').parent, 'root');
  const { changes } = getSavePayload(baseline, draft);
  assert.deepEqual(changes.updated.map(item => item.id), ['a']);
  assert.deepEqual(changes.created, []);
  assert.deepEqual(changes.deleted, []);
});

test('moving files or their ancestor preserves timestamps and content identity, and moving back removes the save delta', () => {
  const file = upload('local.txt');
  const baseline = createSnapshot([...initial().entries, {
    ...entry('local', 'b', 'local.txt', 'file'), source: { kind: 'local', file },
    createdAt: '2024-03-01T01:02:03.000Z', updatedAt: '2025-06-01T04:05:06.000Z',
  }]);
  for (const [ids, changedIds, originalParent] of [[['c', 'local'], ['c', 'local'], 'b'], [['a', 'b', 'c', 'local'], ['a'], 'root']]) {
    const moved = applyAction(baseline, { action: 'move', ids, parent: 'd' });
    for (const before of baseline.entries) {
      assert.deepEqual(byId(moved, before.id), { ...before, parent: changedIds.includes(before.id) ? 'd' : before.parent });
    }
    assert.equal(byId(moved, 'local').source.file, file);
    assert.equal(hasChanges(baseline, moved), true);
    const { changes } = getSavePayload(baseline, moved);
    assert.deepEqual(changes.updated.map(item => item.id), changedIds);
    assert.deepEqual(changes.created, []); assert.deepEqual(changes.deleted, []);
    for (const changed of changes.updated) {
      assert.equal(changed.parent, 'd');
      assert.equal(changed.updatedAt, byId(baseline, changed.id).updatedAt);
    }
    const restored = applyAction(moved, { action: 'move', ids: changedIds, parent: originalParent });
    assert.deepEqual(restored, baseline); assert.equal(byId(restored, 'local').source.file, file);
    assert.equal(hasChanges(baseline, restored), false);
    assert.deepEqual(getSavePayload(baseline, restored).changes, { created: [], updated: [], deleted: [] });
  }
});

test('copying duplicate ancestor and child selections creates one complete independent tree', () => {
  const baseline = initial();
  const draft = applyAction(baseline, { action: 'copy', ids: ['a', 'a', 'b', 'c'], parent: 'root' });
  const { created, updated, deleted } = getSavePayload(baseline, draft).changes;
  assert.equal(created.length, 3);
  const folder = created.find(item => item.parent === 'root');
  const child = created.find(item => item.name === 'Details');
  const file = created.find(item => item.kind === 'file');
  assert.equal(folder.name, 'Design (2)');
  assert.equal(child.parent, folder.id);
  assert.equal(file.parent, child.id);
  assert.deepEqual(file.source, { kind: 'existing', id: 'content-c' });
  assert.notEqual(file.source, byId(baseline, 'c').source);
  assert.equal(new Set(draft.entries.map(item => item.id)).size, 7);
  assert.deepEqual(updated, []);
  assert.deepEqual(deleted, []);
});

test('copying works when child records precede their parent records', () => {
  const baseline = createSnapshot([
    entry('file', 'folder', 'a.txt', 'file'), entry('folder', 'root', 'Folder'),
  ]);
  const draft = applyAction(baseline, { action: 'copy', ids: ['folder'], parent: 'root' });
  const created = getSavePayload(baseline, draft).changes.created;
  assert.equal(created.length, 2);
  assert.equal(created.find(item => item.kind === 'file').parent, created.find(item => item.kind === 'folder').id);
  assert.doesNotThrow(() => createSnapshot(draft.entries));
});

test('copying staged content preserves its File reference and deleting the original preserves the copy', () => {
  const baseline = createSnapshot([]);
  const file = upload('sample.txt');
  let draft = addFiles(baseline, [file], 'root');
  const original = draft.entries[0];
  draft = applyAction(draft, { action: 'copy', ids: [original.id], parent: 'root' });
  draft = applyAction(draft, { action: 'delete', ids: [original.id] });
  assert.equal(draft.entries.length, 1);
  assert.equal(draft.entries[0].name, 'sample (2).txt');
  assert.equal(draft.entries[0].source.file, file);
  assert.deepEqual(getSavePayload(baseline, draft).changes.created, draft.entries);
  assert.deepEqual(getSavePayload(baseline, draft).changes.deleted, []);
});

test('a batch move conflict leaves the entire input snapshot unchanged', () => {
  const baseline = createSnapshot([
    entry('a', 'root', 'First'), entry('b', 'root', 'Second'),
    entry('target', 'root', 'Target'), entry('occupied', 'target', 'second'),
  ]);
  const before = structuredClone(baseline);
  assert.throws(() => applyAction(baseline, { action: 'move', ids: ['a', 'b'], parent: 'target' }), /すでにあります/);
  assert.deepEqual(baseline, before);
});

test('invalid destinations, missing selections, and cycle-producing moves and copies are rejected', () => {
  const baseline = initial();
  for (const action of ['move', 'copy']) {
    for (const parent of ['a', 'b', 'c', 'missing']) {
      assert.throws(() => applyAction(baseline, { action, ids: ['a'], parent }));
    }
  }
  for (const action of ['rename', 'move', 'copy', 'delete', 'favorite']) {
    assert.throws(() => applyAction(baseline, { action, ids: [] }));
    assert.throws(() => applyAction(baseline, { action, ids: ['a', 'missing'] }));
  }
  assert.throws(() => applyAction(baseline, { action: 'create', name: 'New', parent: 'c' }));
  assert.throws(() => addFiles(baseline, [upload('a.txt')], 'missing'));
});

test('create and rename validate normalized case-insensitive sibling names', () => {
  const baseline = initial();
  for (const name of ['', '..', 'CON.txt', 'a/b', 'a\\b', 'trailing.']) {
    assert.throws(() => applyAction(baseline, { action: 'create', name }));
    assert.throws(() => applyAction(baseline, { action: 'rename', ids: ['a'], name }));
  }
  assert.throws(() => applyAction(baseline, { action: 'create', name: 'design' }));
  assert.throws(() => applyAction(baseline, { action: 'rename', ids: ['a'], name: 'ARCHIVE' }));
  assert.throws(() => applyAction(baseline, { action: 'rename', ids: ['a', 'b'], name: 'Changed' }));
  const draft = applyAction(baseline, { action: 'rename', ids: ['a', 'a'], name: ' DESIGN ' });
  assert.equal(byId(draft, 'a').name, 'DESIGN');
});

test('favorite deduplicates selected IDs while honoring selected children individually', () => {
  const baseline = initial();
  const draft = applyAction(baseline, { action: 'favorite', ids: ['a', 'a', 'b'] });
  assert.equal(byId(draft, 'a').favorite, 1);
  assert.equal(byId(draft, 'b').favorite, 1);
  assert.equal(byId(draft, 'c').favorite, 0);
  assert.deepEqual(getSavePayload(baseline, draft).changes.updated.map(item => item.id), ['a', 'b']);
});

test('reverting names, locations, and favorites leaves a clean draft regardless of timestamps or array order', () => {
  const baseline = initial();
  let draft = applyAction(baseline, { action: 'rename', ids: ['a'], name: 'Changed' });
  draft = applyAction(draft, { action: 'move', ids: ['a'], parent: 'd' });
  draft = applyAction(draft, { action: 'favorite', ids: ['a'] });
  draft = applyAction(draft, { action: 'rename', ids: ['a'], name: 'Design' });
  draft = applyAction(draft, { action: 'move', ids: ['a'], parent: 'root' });
  draft = applyAction(draft, { action: 'favorite', ids: ['a'] });
  draft.entries.reverse();
  assert.notEqual(byId(draft, 'a').updatedAt, byId(baseline, 'a').updatedAt);
  assert.equal(hasChanges(baseline, draft), false);
});

test('folder uploads merge normalized case-insensitive folders and overwrite only explicitly approved files', () => {
  const baseline = createSnapshot([entry('folder', 'root', 'Café'), entry('notes', 'folder', 'Notes'),
    entry('report', 'notes', 'Report.TXT', 'file'), entry('keep', 'notes', 'Keep.txt', 'file')]);
  const one = upload('Report.TXT', 'Cafe\u0301/Notes/Report.TXT');
  const two = upload('new.txt', 'CAFÉ/notes/new.txt');
  const conflict = conflictOf(() => addFiles(baseline, [one, two], 'root'));
  assert.equal(conflict.existing.id, 'report'); assert.equal(conflict.relativePath, 'Café/Notes/Report.TXT');
  const draft = addFiles(baseline, [one, two], 'root', undefined, [decide(conflict)]);
  const folders = draft.entries.filter(item => item.kind === 'folder');
  const files = draft.entries.filter(item => item.kind === 'file');
  assert.equal(folders.length, 2);
  const notes = folders.find(item => item.name === 'Notes');
  assert.equal(notes.parent, 'folder');
  assert.deepEqual(files.map(item => item.parent), [notes.id, notes.id, notes.id]);
  assert.deepEqual(files.map(item => item.name), ['Report.TXT', 'Keep.txt', 'new.txt']);
  assert.equal(files[0].source.file, one);
  assert.equal(files[2].source.file, two);
  for (const id of ['folder', 'notes', 'keep']) assert.deepEqual(byId(draft, id), byId(baseline, id));
  assert.equal(baseline.entries.length, 4); assert.equal(byId(baseline, 'report').source.kind, 'existing');
});

test('upload overwrite preserves destination identity and metadata while replacing only content, size and MIME', () => {
  const existing = { ...entry('stored', 'root', 'Résumé.TXT', 'file'), favorite: 1,
    createdAt: '2021-02-03T04:05:06.000Z', updatedAt: '2022-03-04T05:06:07.000Z' };
  const baseline = createSnapshot([existing]);
  const file = new File(['replacement body'], 'RE\u0301SUME\u0301.txt', { type: 'text/custom', lastModified: 1 });
  const conflict = conflictOf(() => addFilesWithResult(baseline, [file], 'root'));
  assert.equal(conflict.fileIndex, 0); assert.equal(conflict.relativePath, 'RÉSUMÉ.txt'); assert.equal(conflict.file, file);
  assert.deepEqual(conflict.existing, existing); assert.notEqual(conflict.existing, baseline.entries[0]);
  assert.notEqual(conflict.existing.source, baseline.entries[0].source);
  const { snapshot, result } = addFilesWithResult(baseline, [file], 'root', undefined, [decide(conflict)]);
  assert.deepEqual(snapshot.entries, [{ ...existing, size: file.size, mime: file.type, source: { kind: 'local', file } }]);
  assert.equal(snapshot.entries[0].source.file, file);
  assert.equal(snapshot.entries[0].extension, 'txt');
  assert.deepEqual(result, { attemptedCount: 1, addedCount: 0, overwrittenCount: 1, skippedCount: 0, rejections: [] });
  assert.equal(hasChanges(baseline, snapshot), true);
  const { changes } = getSavePayload(baseline, snapshot);
  assert.deepEqual(changes.updated, snapshot.entries); assert.deepEqual(changes.created, []); assert.deepEqual(changes.deleted, []);
  conflict.existing.name = 'Externally changed'; conflict.existing.source.id = 'wrong';
  assert.deepEqual(baseline.entries, [existing]);
});

test('overwriting a previously local file keeps its ID and replaces its File reference without suffixing', () => {
  const oldFile = upload('Local.txt', '', 'old'), incoming = upload('LOCAL.TXT', '', 'new');
  const baseline = createSnapshot([{ ...entry('local', 'root', 'Local.txt', 'file'), source: { kind: 'local', file: oldFile } }]);
  const conflict = conflictOf(() => addFiles(baseline, [incoming], 'root'));
  assert.equal(conflict.existing.source.file, oldFile);
  const result = addFilesWithResult(baseline, [incoming], 'root', undefined, [decide(conflict)]);
  assert.equal(result.snapshot.entries.length, 1); assert.equal(result.snapshot.entries[0].id, 'local');
  assert.equal(result.snapshot.entries[0].name, 'Local.txt'); assert.equal(result.snapshot.entries[0].source.file, incoming);
  assert.equal(baseline.entries[0].source.file, oldFile); assert.equal(result.result.overwrittenCount, 1);
});

test('sequential collision decisions are atomic and allow independent skip, overwrite and new-file outcomes', () => {
  const baseline = createSnapshot([entry('a', 'root', 'First.txt', 'file'), entry('b', 'root', 'Second.txt', 'file')]);
  const files = [upload('Fresh.txt', 'New/Fresh.txt'), upload('FIRST.TXT'), upload('second.txt')];
  const first = conflictOf(() => addFilesWithResult(baseline, files, 'root'));
  assert.equal(first.fileIndex, 1); assert.equal(first.existing.id, 'a'); assert.equal(baseline.entries.length, 2);
  const decisions = [decide(first, 'skip')];
  const second = conflictOf(() => addFilesWithResult(baseline, files, 'root', undefined, decisions));
  assert.equal(second.fileIndex, 2); assert.equal(second.existing.id, 'b'); assert.equal(baseline.entries.length, 2);
  decisions.push(decide(second));
  const { snapshot, result } = addFilesWithResult(baseline, files, 'root', undefined, decisions);
  assert.deepEqual(result, { attemptedCount: 3, addedCount: 1, overwrittenCount: 1, skippedCount: 1, rejections: [] });
  assert.deepEqual(byId(snapshot, 'a'), byId(baseline, 'a')); assert.equal(byId(snapshot, 'b').source.file, files[2]);
  assert.equal(snapshot.entries.find(item => item.name === 'Fresh.txt').source.file, files[0]);
  assert.deepEqual(getSavePayload(baseline, snapshot).changes.updated.map(item => item.id), ['b']);
});

test('an all-skip upload keeps the original snapshot clean and does not create a suffixed file', () => {
  const baseline = initial(), file = upload('REPORT.txt');
  const conflict = conflictOf(() => addFilesWithResult(baseline, [file], 'b'));
  const { snapshot, result } = addFilesWithResult(baseline, [file], 'b', undefined, [decide(conflict, 'skip')]);
  assert.equal(snapshot, baseline); assert.equal(hasChanges(baseline, snapshot), false);
  assert.deepEqual(result, { attemptedCount: 1, addedCount: 0, overwrittenCount: 0, skippedCount: 1, rejections: [] });
});

test('a retry session stabilizes new entries when two incoming files collide within the same batch', () => {
  const baseline = createSnapshot([]), first = upload('Same.txt', 'New/Same.txt', 'first'), second = upload('SAME.TXT', 'new/SAME.TXT', 'second');
  const files = [first, second];
  const conflict = conflictOf(() => addFilesWithResult(baseline, files, 'root'));
  assert.equal(conflict.fileIndex, 1); assert.equal(conflict.existing.source.file, first); assert.ok(conflict.session);
  const repeated = conflictOf(() => addFilesWithResult(baseline, files, 'root', undefined, [], conflict.session));
  assert.deepEqual(repeated.existing, conflict.existing); assert.equal(repeated.session, conflict.session);
  const { snapshot, result } = addFilesWithResult(baseline, files, 'root', undefined, [decide(conflict)], conflict.session);
  assert.equal(snapshot.entries.length, 2); assert.equal(snapshot.entries[1].id, conflict.existing.id);
  assert.equal(snapshot.entries[1].name, 'Same.txt'); assert.equal(snapshot.entries[1].source.file, second);
  assert.equal(snapshot.entries[1].createdAt, conflict.existing.createdAt);
  assert.deepEqual(result, { attemptedCount: 2, addedCount: 1, overwrittenCount: 1, skippedCount: 0, rejections: [] });
  assert.throws(() => addFilesWithResult(baseline, [first, upload('Other.txt')], 'root', undefined, [], conflict.session));
});

test('invalid or duplicate collision decisions are rejected without partially staging accepted files', () => {
  const baseline = initial(), files = [upload('report.txt')];
  const conflict = conflictOf(() => addFiles(baseline, files, 'b'));
  for (const decisions of [[{ ...decide(conflict), fileIndex: -1 }], [{ ...decide(conflict), fileIndex: 1 }],
    [{ ...decide(conflict), action: 'replace' }], [decide(conflict), decide(conflict, 'skip')]]) {
    assert.throws(() => addFiles(baseline, files, 'b', undefined, decisions));
    assert.deepEqual(baseline, initial());
  }
});

test('overwrite approval becomes a new conflict when any observed target metadata or source changes', () => {
  const baseline = initial(), file = upload('report.txt');
  const conflict = conflictOf(() => addFiles(baseline, [file], 'b'));
  for (const patch of [{ id: 'replacement-id' }, { favorite: 1 }, { size: 5 }, { mime: 'text/custom' },
    { createdAt: '2020-01-01T00:00:00.000Z' }, { updatedAt: '2026-01-01T00:00:00.000Z' },
    { source: { kind: 'existing', id: 'new-content-id' } }]) {
    const latest = createSnapshot(baseline.entries.map(item => item.id === 'c' ? { ...item, ...patch } : item));
    const next = conflictOf(() => addFiles(latest, [file], 'b', undefined, [decide(conflict)]));
    assert.deepEqual(next.existing, byId(latest, patch.id ?? 'c'));
    assert.equal(next.file, file); assert.equal(latest.entries.length, baseline.entries.length);
  }
});

test('a collision decision is not reused after its target disappears, and a folder cannot be overwritten as a file', () => {
  const baseline = initial(), file = upload('report.txt');
  const conflict = conflictOf(() => addFiles(baseline, [file], 'b'));
  const removed = applyAction(baseline, { action: 'delete', ids: ['c'] });
  for (const action of ['overwrite', 'skip']) {
    const { snapshot, result } = addFilesWithResult(removed, [file], 'b', undefined, [decide(conflict, action)], conflict.session);
    const added = snapshot.entries.find(item => item.name === 'report.txt');
    assert.notEqual(added.id, 'c'); assert.equal(added.source.file, file);
    assert.equal(result.addedCount, 1); assert.equal(result.overwrittenCount, 0); assert.equal(result.skippedCount, 0);
  }
  assert.throws(() => addFiles(baseline, [upload('Design')], 'root'), error => error.name !== 'ExplorerUploadConflictError');
});

test('uploading the same File elsewhere is a new identity and deleting the original remains created plus deleted', () => {
  const file = upload('Same.txt');
  const baseline = createSnapshot([entry('folder', 'root', 'Folder'),
    { ...entry('original', 'root', 'Same.txt', 'file'), size: file.size, source: { kind: 'local', file } }]);
  let next = addFiles(baseline, [file], 'folder');
  const created = next.entries.find(item => item.parent === 'folder');
  assert.notEqual(created.id, 'original'); assert.equal(created.source.file, file);
  next = applyAction(next, { action: 'delete', ids: ['original'] });
  const { changes } = getSavePayload(baseline, next);
  assert.deepEqual(changes.created.map(item => item.id), [created.id]);
  assert.deepEqual(changes.deleted.map(item => item.id), ['original']); assert.deepEqual(changes.updated, []);
});

test('a folder upload batch fails atomically on invalid paths or a file blocking a directory', () => {
  const baseline = createSnapshot([entry('occupied', 'root', 'Blocked', 'file')]);
  const before = structuredClone(baseline);
  for (const path of ['Blocked/report.txt', 'New/../report.txt', '/report.txt', 'New//report.txt']) {
    assert.throws(() => addFiles(baseline, [upload('good.txt', 'New/good.txt'), upload('report.txt', path)], 'root'));
    assert.deepEqual(baseline, before);
  }
});

test('staging content imposes no backend-specific upload size limit', () => {
  const large = upload('large.txt');
  Object.defineProperty(large, 'size', { value: 26 * 1024 * 1024 });
  const draft = addFiles(createSnapshot([]), [large], 'root');
  assert.equal(draft.entries[0].size, 26 * 1024 * 1024);
  assert.equal(draft.entries[0].source.file, large);
});

test('a collision at the filename length limit keeps the generated filename valid', () => {
  const name = `${'a'.repeat(176)}.txt`;
  const baseline = createSnapshot([entry('a', 'root', name, 'file')]);
  const draft = applyAction(baseline, { action: 'copy', ids: ['a'], parent: 'root' });
  assert.equal(draft.entries[1].name.length, 180);
  assert.match(draft.entries[1].name, / \(2\)\.txt$/);
  assert.doesNotThrow(() => createSnapshot(draft.entries));
});

test('deleting an existing parent reports every removed baseline record exactly once', () => {
  const baseline = initial();
  const draft = applyAction(baseline, { action: 'delete', ids: ['a', 'a', 'b', 'c'] });
  assert.deepEqual(draft.entries.map(item => item.id), ['d']);
  assert.deepEqual(getSavePayload(baseline, draft).changes.deleted.map(item => item.id), ['a', 'b', 'c']);
});

test('save payload mutation cannot modify current or baseline snapshots', () => {
  const baseline = initial();
  let draft = applyAction(baseline, { action: 'rename', ids: ['c'], name: 'updated.txt' });
  draft = applyAction(draft, { action: 'delete', ids: ['d'] });
  draft = addFiles(draft, [upload('new.txt')], 'root');
  const payload = getSavePayload(baseline, draft);
  const stagedId = payload.changes.created[0].id;
  payload.entries.find(item => item.id === 'c').name = 'mutated.txt';
  payload.changes.updated[0].source.id = 'mutated-content';
  payload.changes.created[0].source.file = upload('replacement.txt');
  payload.changes.deleted[0].name = 'mutated folder';
  payload.entries.pop();
  assert.equal(byId(draft, 'c').name, 'updated.txt');
  assert.equal(byId(draft, 'c').source.id, 'content-c');
  assert.equal(byId(draft, stagedId).source.file.name, 'new.txt');
  assert.equal(byId(baseline, 'd').name, 'Archive');
  assert.equal(draft.entries.length, 4);
});

test('a changed content reference is a real update even when all visible metadata matches', () => {
  const baseline = initial();
  const draft = createSnapshot(baseline.entries);
  byId(draft, 'c').source.id = 'replacement-content';
  assert.equal(hasChanges(baseline, draft), true);
  assert.deepEqual(getSavePayload(baseline, draft).changes.updated.map(item => item.id), ['c']);
});

test('invalid supplied trees are rejected before local editing', () => {
  for (const records of [
    [entry('a', 'root', 'One'), entry('a', 'root', 'Two')],
    [entry('a', 'root', 'One'), entry('b', 'root', 'ONE')],
    [entry('root', 'root', 'Reserved')],
    [entry('a', 'missing', 'Orphan')],
    [entry('a', 'root', 'a.txt', 'file'), entry('b', 'a', 'Child')],
    [entry('a', 'b', 'One'), entry('b', 'a', 'Two')],
  ]) assert.throws(() => createSnapshot(records));
});
