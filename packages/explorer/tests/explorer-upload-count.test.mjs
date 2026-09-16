import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { createDraftSnapshot, addFilesWithResult, applyAction } = await importTypeScript('../src/model/draft.ts');
const { resolveUploadOptions } = await importTypeScript('../src/model/upload.ts');
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind,
  size: kind === 'file' ? 4 : 0, mime: kind === 'file' ? 'text/plain' : '', favorite: 0,
  source: kind === 'file' ? { kind: 'existing', id } : null,
  createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z' });
const file = (name, path = '', content = 'next') => {
  const value = new File([content], name, { type: 'text/plain' });
  if (path) Object.defineProperty(value, 'webkitRelativePath', { value: path });
  return value;
};
const count = snapshot => snapshot.entries.filter(item => item.kind === 'file').length;
function upload(source, files, options = {}, answer = () => 'overwrite', parent = 'root') {
  const decisions = new Map();
  let session;
  for (let attempt = 0; attempt <= files.length * 2 + 1; attempt++) {
    try { return addFilesWithResult(source, files, parent, options, [...decisions.values()], session); }
    catch (error) {
      if (error.name !== 'ExplorerUploadConflictError') throw error;
      const { fileIndex, existing } = error.conflict;
      decisions.set(fileIndex, { fileIndex, existing, action: answer(error.conflict) });
      session = error.session;
    }
  }
  assert.fail('conflict resolution must terminate');
}
function rejected(callback) {
  let error;
  assert.throws(callback, caught => { error = caught; return caught.name === 'ExplorerUploadValidationError'; });
  return error;
}

test('file count settings accept zero or safe integer limits and reject invalid configuration', () => {
  for (const key of ['maxFilesPerUpload', 'maxTotalFiles']) {
    for (const value of [0, 1, Number.MAX_SAFE_INTEGER]) assert.equal(resolveUploadOptions({ [key]: value })[key], value);
    for (const value of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, null, '2', true])
      assert.throws(() => resolveUploadOptions({ [key]: value }));
  }
});

test('one upload limit counts both additions and approved overwrites and resets on the next operation', () => {
  const source = createDraftSnapshot(Array.from({ length: 7 }, (_, i) => entry(`e${i}`, `old-${i}.txt`)));
  const files = [...Array.from({ length: 7 }, (_, i) => file(`old-${i}.txt`)), ...Array.from({ length: 3 }, (_, i) => file(`new-${i}.txt`))];
  const result = upload(source, files, { maxFilesPerUpload: 10 });
  assert.equal(result.result.addedCount, 3); assert.equal(result.result.overwrittenCount, 7);
  assert.equal(count(result.snapshot), 10);
  const error = rejected(() => upload(source, [...files, file('too-many.txt')], { maxFilesPerUpload: 10 }));
  assert.equal(error.rejections[0].name, 'too-many.txt');
  assert.equal(error.rejections[0].reasons[0].code, 'upload-file-count-exceeded');
  assert.equal(error.rejections[0].reasons[0].maxFilesPerUpload, 10);
  assert.equal(count(source), 7);
  assert.equal(upload(result.snapshot, [file('next-operation.txt')], { maxFilesPerUpload: 1 }).result.addedCount, 1);
});

test('skipping a name conflict consumes no upload slot in either input order', () => {
  const source = createDraftSnapshot([entry('old', 'old.txt')]);
  for (const files of [[file('old.txt'), file('new.txt')], [file('new.txt'), file('old.txt')]]) {
    const result = upload(source, files, { maxFilesPerUpload: 1 }, () => 'skip');
    assert.equal(result.result.addedCount, 1); assert.equal(result.result.overwrittenCount, 0);
    assert.equal(result.result.skippedCount, 1);
    assert.equal(result.snapshot.entries.find(item => item.id === 'old').source.kind, 'existing');
    rejected(() => upload(source, files, { maxFilesPerUpload: 1 }));
  }
});

test('skip behavior keeps accepted input order and excludes invalid files and folders from the counters', () => {
  const source = createDraftSnapshot([entry('old', 'old.txt')]);
  const result = upload(source, [file('bad.exe', 'Never/bad.exe'), file('big.txt', 'Large/big.txt', '12345'),
    file('first.txt', 'Batch/Nested/first.txt'), file('old.txt'), file('last.txt', 'Rejected/last.txt')], {
    allowedExtensions: ['.txt'], maxFileSizeBytes: 4, maxFilesPerUpload: 2, maxTotalFiles: 2, invalidFileBehavior: 'skip',
  });
  assert.equal(result.result.addedCount, 1); assert.equal(result.result.overwrittenCount, 1);
  assert.equal(count(result.snapshot), 2);
  assert.deepEqual(result.snapshot.entries.filter(item => item.kind === 'folder').map(item => item.name), ['Batch', 'Nested']);
  assert.deepEqual(result.result.rejections.map(item => item.relativePath), ['Never/bad.exe', 'Large/big.txt', 'Rejected/last.txt']);
  assert.ok(result.result.rejections.at(-1).reasons.some(reason => reason.code === 'upload-file-count-exceeded'));
});

test('total ownership counts all draft files across folders, permits overwrite at capacity, and frees deleted slots', () => {
  const source = createDraftSnapshot([entry('folder', 'Folder', 'root', 'folder'), entry('old', 'old.txt', 'folder')]);
  const policy = { maxTotalFiles: 2 };
  const first = upload(source, [file('new.txt')], policy).snapshot;
  const error = rejected(() => upload(first, [file('blocked.txt', 'Other/blocked.txt')], policy));
  assert.equal(error.rejections[0].reasons[0].code, 'total-file-count-exceeded');
  assert.equal(error.rejections[0].reasons[0].maxTotalFiles, 2);
  const replaced = upload(first, [file('old.txt', 'Folder/old.txt')], policy);
  assert.equal(replaced.result.overwrittenCount, 1); assert.equal(count(replaced.snapshot), 2);
  const deleted = applyAction(first, { action: 'delete', ids: ['old'] }, policy);
  assert.equal(upload(deleted, [file('allowed.txt')], policy).result.addedCount, 1);
});

test('total capacity can skip a new file while a later overwrite still consumes the available upload slot', () => {
  const source = createDraftSnapshot([entry('old', 'old.txt')]);
  const result = upload(source, [file('new.txt', 'Never/new.txt'), file('old.txt')], {
    maxFilesPerUpload: 1, maxTotalFiles: 1, invalidFileBehavior: 'skip',
  });
  assert.equal(result.result.addedCount, 0); assert.equal(result.result.overwrittenCount, 1);
  assert.equal(result.snapshot.entries.length, 1);
  assert.deepEqual(result.result.rejections[0].reasons.map(reason => reason.code), ['total-file-count-exceeded']);
});

test('duplicate input paths count each approved write but use only one total-file slot', () => {
  const source = createDraftSnapshot([]), first = file('same.txt', 'Batch/same.txt', 'first'), last = file('same.txt', 'Batch/same.txt', 'last');
  const result = upload(source, [first, last], { maxFilesPerUpload: 2, maxTotalFiles: 1 });
  assert.equal(result.result.addedCount, 1); assert.equal(result.result.overwrittenCount, 1);
  assert.equal(count(result.snapshot), 1);
  assert.equal(result.snapshot.entries.at(-1).source.file, last);
  rejected(() => upload(source, [first, last], { maxFilesPerUpload: 1, maxTotalFiles: 1 }));
  const skipped = upload(source, [first, last], { maxFilesPerUpload: 1, maxTotalFiles: 1 }, () => 'skip');
  assert.equal(skipped.result.skippedCount, 1);
  assert.equal(skipped.snapshot.entries.at(-1).source.file, first);
});

test('zero limits and already-over-capacity data block growth without blocking overwrite, moves or deletes', () => {
  const empty = createDraftSnapshot([]);
  for (const policy of [{ maxFilesPerUpload: 0 }, { maxTotalFiles: 0 }]) {
    rejected(() => upload(empty, [file('new.txt')], policy));
    const result = upload(empty, [file('new.txt', 'Never/new.txt')], { ...policy, invalidFileBehavior: 'skip' });
    assert.equal(result.snapshot, empty); assert.equal(result.result.rejections.length, 1);
  }
  const source = createDraftSnapshot([entry('folder', 'Folder', 'root', 'folder'), entry('old', 'old.txt')]);
  const policy = { maxTotalFiles: 0 };
  assert.equal(upload(source, [file('old.txt')], policy).result.overwrittenCount, 1);
  assert.equal(applyAction(source, { action: 'move', ids: ['old'], parent: 'folder' }, policy).entries.at(-1).parent, 'folder');
  assert.equal(count(applyAction(source, { action: 'delete', ids: ['old'] }, policy)), 0);
});

test('empty file creation and subtree copies cannot exceed total capacity or partially copy a folder', () => {
  const source = createDraftSnapshot([entry('folder', 'Folder', 'root', 'folder'), entry('a', 'a.txt', 'folder'), entry('b', 'b.txt', 'folder')]);
  const policy = { maxTotalFiles: 3, maxFilesPerUpload: 0 };
  assert.equal(count(applyAction(source, { action: 'createFile', name: 'empty.txt' }, policy)), 3);
  assert.equal(count(applyAction(source, { action: 'copy', ids: ['a'], parent: 'root' }, policy)), 3);
  assert.throws(() => applyAction(source, { action: 'copy', ids: ['folder'], parent: 'root' }, policy), /上限/);
  assert.equal(count(applyAction(source, { action: 'copy', ids: ['folder', 'a'], parent: 'root' }, { maxTotalFiles: 4 })), 4,
    'selecting a descendant with its parent must not count or copy it twice');
  assert.equal(count(source), 2);
  assert.throws(() => applyAction(source, { action: 'createFile', name: 'empty.txt' }, { maxTotalFiles: 2 }), /上限/);
  const folder = applyAction(source, { action: 'create', name: 'Empty' }, { maxTotalFiles: 2 });
  assert.equal(folder.entries.at(-1).kind, 'folder');
  assert.equal(count(applyAction(folder, { action: 'copy', ids: [folder.entries.at(-1).id], parent: 'root' }, { maxTotalFiles: 2 })), 2);
});
