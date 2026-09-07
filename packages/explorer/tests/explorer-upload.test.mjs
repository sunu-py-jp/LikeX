import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode, useLayoutEffect } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const result = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `
    export { addFiles, addFilesWithResult, createDraftSnapshot } from './src/model/draft.ts';
    export { resolveUploadOptions, ExplorerUploadValidationError } from './src/model/upload.ts';
    export { useExplorerDraft } from './src/state/use-explorer-draft.ts';
    export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
    export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
    export { default as Explorer } from './src/explorer.tsx';
  `, resolveDir: packageRoot, sourcefile: 'explorer-upload-contract.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-and-picker-surface', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'upload-test' }));
    builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'upload-test' }));
    builder.onResolve({ filter: /^\.\/ui\/explorer-(sidebar|header|status-bar|file-list|dialogs)$/ }, () => ({ path: 'ui', namespace: 'upload-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'upload-test' }, ({ path }) => ({
      resolveDir: packageRoot, loader: 'tsx', contents: {
        portal: 'export const createPortal = children => children;',
        radix: 'export const Tooltip = { Provider: ({children}) => children };',
        ui: `export const ExplorerSidebar = () => null; export const ExplorerHeader = () => null;
          export const ExplorerStatusBar = () => null; export const ExplorerFileList = () => null; export const ExplorerDialogs = () => null;`,
      }[path],
    }));
  } }],
});
const { addFiles, addFilesWithResult, createDraftSnapshot, resolveUploadOptions, ExplorerUploadValidationError,
  useExplorerDraft, useExplorerWorkspace, useExplorerViewController, Explorer } = await import(
  `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text + '\n//# sourceURL=explorer-upload-contract.mjs').toString('base64')}`
);
const change = async callback => { await act(async () => { await callback(); }); };
const file = (name, size = 4, relativePath = '') => {
  const value = new File(['x'.repeat(size)], name, { type: 'application/octet-stream' });
  if (relativePath) Object.defineProperty(value, 'webkitRelativePath', { value: relativePath });
  return value;
};
const folder = { extension: '', id: 'folder', parent: 'root', name: '資料', kind: 'folder', size: 0, mime: '', source: null,
  createdAt: '2026-09-06T00:00:00.000Z', updatedAt: '2026-09-06T00:00:00.000Z', favorite: 0 };
const snapshot = () => createDraftSnapshot([folder]);
const rejected = callback => {
  let error;
  assert.throws(callback, caught => { error = caught; return caught instanceof ExplorerUploadValidationError; });
  return error;
};

async function mountDraft(t, supplied = {}) {
  let latest, renderer;
  const events = [], saves = [], dirty = [];
  let props = { initialEntries: [folder], onSave: payload => { saves.push(payload); }, onDirtyChange: value => dirty.push(value),
    onEvent: event => { if (event.type !== 'edit-mode') events.push(event); }, ...supplied };
  function Probe({ options }) { latest = useExplorerDraft(options); return null; }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  await change(() => { renderer = create(tree()); });
  t.after(() => change(() => renderer.unmount()));
  return { get current() { return latest; }, events, saves, dirty,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); } };
}

async function mountSharedViews(t, supplied = {}) {
  let latest, renderer;
  const events = [], saves = [], reads = [];
  let props = { initialEntries: [folder], onSave: payload => { saves.push(payload); },
    readFile: id => { reads.push(id); throw Error('Unexpected read'); }, onEvent: event => { if (event.type !== 'edit-mode') events.push(event); }, ...supplied };
  function Probe({ options }) {
    const workspace = useExplorerWorkspace(options);
    const main = useExplorerViewController(options, workspace, 'main', null);
    const child = useExplorerViewController(options, workspace, 'child', null);
    useLayoutEffect(() => {
      const tabs = workspace.tabs.forWindow('child');
      if (!tabs.tabs.length) tabs.addTab();
    }, [workspace.tabs]);
    latest = { workspace, main, child };
    return null;
  }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  await change(() => { renderer = create(tree()); });
  events.length = 0;
  t.after(() => change(() => renderer.unmount()));
  return { get current() { return latest; }, events, saves, reads,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); } };
}

function dropEvent(files) {
  return { ctrlKey: false, preventDefault() {}, stopPropagation() {}, dataTransfer: {
    files, types: ['Files'], getData: () => '', effectAllowed: 'all', dropEffect: 'none',
  } };
}

test('upload options default to unrestricted and normalize a defensive copy of allowed suffixes', () => {
  assert.deepEqual(resolveUploadOptions(), { allowedExtensions: undefined, maxFileSizeBytes: undefined, accept: undefined, invalidFileBehavior: 'reject-batch' });
  const allowed = Object.freeze([' .PDF ', '.pdf', '.Tar.Gz', '.E\u0301', '.É']);
  const options = Object.freeze({ allowedExtensions: allowed, maxFileSizeBytes: 25 });
  const resolved = resolveUploadOptions(options);
  assert.deepEqual(resolved.allowedExtensions, ['.pdf', '.tar.gz', '.é']);
  assert.equal(resolved.accept, '.pdf,.tar.gz,.é');
  assert.equal(resolved.maxFileSizeBytes, 25);
  assert.notEqual(resolved.allowedExtensions, allowed);
  assert.deepEqual(allowed, [' .PDF ', '.pdf', '.Tar.Gz', '.E\u0301', '.É']);
  assert.equal(resolveUploadOptions({ allowedExtensions: [] }).accept, undefined);
  assert.equal(resolveUploadOptions({ invalidFileBehavior: 'skip' }).invalidFileBehavior, 'skip');
  assert.equal(resolveUploadOptions({ invalidFileBehavior: 'reject-batch' }).invalidFileBehavior, 'reject-batch');
});

test('invalid runtime upload configuration is rejected rather than weakening restrictions', () => {
  for (const options of [null, [], true, 'pdf']) assert.throws(() => resolveUploadOptions(options));
  for (const value of ['pdf', '.', '..pdf', '.tar..gz', '.tar.', '.p df', '.pdf,.exe', 'image/*', '.p/f', '.p\\f', '.{pdf}', 3]) {
    assert.throws(() => resolveUploadOptions({ allowedExtensions: [value] }), String(value));
  }
  for (const allowedExtensions of [null, '.pdf', {}]) assert.throws(() => resolveUploadOptions({ allowedExtensions }));
  for (const maxFileSizeBytes of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '4', null]) {
    assert.throws(() => resolveUploadOptions({ maxFileSizeBytes }), String(maxFileSizeBytes));
  }
  assert.equal(resolveUploadOptions({ maxFileSizeBytes: Number.MAX_SAFE_INTEGER }).maxFileSizeBytes, Number.MAX_SAFE_INTEGER);
  for (const invalidFileBehavior of [null, '', 'reject', 'SKIP', true, [], {}]) {
    assert.throws(() => resolveUploadOptions({ invalidFileBehavior }));
  }
});

test('unrestricted imports retain File objects without reading contents or requiring an extension', t => {
  const files = [file('README'), file('.env'), file('photo.png'), file('archive.tar.gz')];
  const reads = files.flatMap(value => ['arrayBuffer', 'text', 'stream'].map(method =>
    t.mock.method(value, method, () => { throw Error('File bytes must stay unread'); })));
  const imported = addFiles(snapshot(), files, 'root');
  assert.deepEqual(imported.entries.filter(e => e.kind === 'file').map(e => e.name), files.map(f => f.name));
  assert.deepEqual(imported.entries.filter(e => e.kind === 'file').map(e => e.source.file), files);
  assert.ok(reads.every(spy => spy.mock.callCount() === 0));
});

test('allowed extensions are case-insensitive NFC suffixes, including compound suffixes and size equality', () => {
  const files = [file('REPORT.PdF', 8), file('archive.TAR.GZ', 8), file('note.E\u0301', 8)];
  const imported = addFiles(snapshot(), files, 'root', { allowedExtensions: ['.pdf', '.tar.gz', '.é'], maxFileSizeBytes: 8 });
  assert.equal(imported.entries.filter(e => e.kind === 'file').length, 3);
  assert.equal(imported.entries.at(-1).name, 'note.É');
  const error = rejected(() => addFiles(snapshot(), [file('archive.gz'), file('report.pdf.exe')], 'root', { allowedExtensions: ['.pdf', '.tar.gz'] }));
  assert.deepEqual(error.rejections.map(e => e.extension), ['gz', 'exe']);
});

test('an empty allowlist prohibits every file and hidden or extensionless names do not match suffix rules', () => {
  const values = [file('report.pdf'), file('.env'), file('README')];
  assert.equal(rejected(() => addFiles(snapshot(), values, 'root', { allowedExtensions: [] })).rejections.length, 3);
  const error = rejected(() => addFiles(snapshot(), values.slice(1), 'root', { allowedExtensions: ['.env', '.txt'] }));
  assert.deepEqual(error.rejections.map(e => e.extension), ['', '']);
  assert.ok(error.rejections.every(e => e.reasons[0].code === 'extension-not-allowed'));
});

test('a zero byte limit accepts only empty files and reports every oversized file independently', () => {
  assert.equal(addFiles(snapshot(), [file('empty.txt', 0)], 'root', { maxFileSizeBytes: 0 }).entries.at(-1).size, 0);
  const error = rejected(() => addFiles(snapshot(), [file('a.txt', 1), file('b.txt', 2)], 'root', { maxFileSizeBytes: 0 }));
  assert.deepEqual(error.rejections.map(e => e.size), [1, 2]);
  assert.ok(error.rejections.every(e => e.reasons[0].code === 'file-too-large' && e.reasons[0].maxFileSizeBytes === 0));
});

test('mixed folder imports reject atomically and report normalized paths plus all reasons without reading bytes', t => {
  const source = snapshot();
  const good = file('good.txt', 4, ' Batch /nested/good.txt');
  const bad = file('bad.exe', 9, ' Batch /nested/bad.exe');
  const calls = [good, bad].map(value => t.mock.method(value, 'arrayBuffer', () => { throw Error('Unexpected read'); }));
  const error = rejected(() => addFiles(source, [good, bad], 'folder', { allowedExtensions: ['.txt'], maxFileSizeBytes: 4 }));
  assert.deepEqual(source.entries, [folder]);
  assert.equal(error.name, 'ExplorerUploadValidationError');
  assert.equal(error.rejections.length, 1);
  assert.equal(error.rejections[0].file, bad);
  assert.equal(error.rejections[0].relativePath, 'Batch/nested/bad.exe');
  assert.equal(error.rejections[0].name, 'bad.exe');
  assert.equal(error.rejections[0].extension, 'exe');
  assert.deepEqual(error.rejections[0].reasons.map(e => e.code), ['extension-not-allowed', 'file-too-large']);
  assert.match(error.message, /Batch\/nested\/bad\.exe/);
  assert.ok(calls.every(spy => spy.mock.callCount() === 0));
});

test('folder validation checks the actual staged basename rather than a mismatched File.name', () => {
  const masked = file('looks-safe.txt', 1, 'Batch/actually.exe');
  const error = rejected(() => addFiles(snapshot(), [masked], 'root', { allowedExtensions: ['.txt'] }));
  assert.equal(error.rejections[0].name, 'actually.exe');
  assert.equal(error.rejections[0].relativePath, 'Batch/actually.exe');
});

test('a rejected hook import emits one structured event without changing dirty state or saving', async t => {
  const fetchSpy = t.mock.method(globalThis, 'fetch', () => { throw Error('Unexpected network'); });
  const hook = await mountDraft(t, { upload: { allowedExtensions: ['.txt'], maxFileSizeBytes: 4 } });
  const before = hook.current.entries;
  const bad = file('oversized.exe', 6, 'Batch/oversized.exe');
  let error;
  await change(() => { error = rejected(() => hook.current.add([file('fine.txt', 3), bad], 'folder')); });
  assert.equal(hook.current.entries, before);
  assert.equal(hook.current.dirty, false);
  assert.ok(hook.dirty.every(value => value === false));
  assert.equal(hook.saves.length, 0);
  assert.equal(fetchSpy.mock.callCount(), 0);
  assert.equal(hook.events.length, 1);
  const event = hook.events[0];
  assert.equal(event.type, 'upload'); assert.equal(event.status, 'rejected');
  assert.equal(event.parentId, 'folder'); assert.equal(event.parentPath, '/資料'); assert.equal(event.attemptedCount, 2);
  assert.equal(event.rejections[0].file, bad);
  assert.deepEqual(event.rejections, error.rejections);
  assert.notEqual(event.rejections, error.rejections);
  assert.notEqual(event.rejections[0], error.rejections[0]);
  assert.notEqual(event.rejections[0].reasons, error.rejections[0].reasons);
  assert.notEqual(event.rejections[0].reasons[0], error.rejections[0].reasons[0]);
  assert.notEqual(event.rejections[0].reasons[0].allowedExtensions, error.rejections[0].reasons[0].allowedExtensions);
  assert.equal(event.message, error.message);
});

test('event observers cannot corrupt rejection errors or later validation, and observer failures are isolated', async t => {
  const errors = [];
  const hook = await mountDraft(t, { upload: { allowedExtensions: ['.txt'] }, onEvent(event) {
    if (event.type !== 'upload') return;
    event.rejections[0].name = 'observer-name';
    event.rejections[0].reasons[0].allowedExtensions.push('.exe');
    event.rejections[0].reasons[0].message = 'observer-message';
    throw Error('Observer failure');
  } });
  for (let i = 0; i < 2; i++) await change(() => { errors.push(rejected(() => hook.current.add([file('bad.exe')], 'root'))); });
  for (const error of errors) {
    assert.equal(error.rejections[0].name, 'bad.exe');
    assert.deepEqual(error.rejections[0].reasons[0].allowedExtensions, ['.txt']);
    assert.notEqual(error.rejections[0].reasons[0].message, 'observer-message');
  }
  assert.equal(hook.current.dirty, false);
});

test('dynamic restrictions apply to future imports while preserving existing dirty entries and save behavior', async t => {
  const hook = await mountDraft(t, { upload: { allowedExtensions: ['.txt'], maxFileSizeBytes: 4 } });
  await change(() => hook.current.add([file('before.txt', 4)], 'root'));
  assert.equal(hook.current.dirty, true);
  const before = hook.current.entries;
  await hook.update({ upload: { allowedExtensions: ['.pdf'], maxFileSizeBytes: 2 } });
  await change(() => { rejected(() => hook.current.add([file('after.txt', 4)], 'root')); });
  assert.equal(hook.current.entries, before);
  assert.equal(hook.current.dirty, true);
  await change(() => hook.current.add([file('allowed.pdf', 2)], 'root'));
  await change(() => hook.current.save());
  assert.equal(hook.saves.length, 1);
  assert.deepEqual(hook.saves[0].changes.created.map(e => e.name), ['before.txt', 'allowed.pdf']);
  assert.equal(hook.current.dirty, false);
  await hook.update({ upload: undefined });
  await change(() => hook.current.add([file('unrestricted.bin', 9)], 'root'));
  assert.equal(hook.current.entries.at(-1).name, 'unrestricted.bin');
});

test('ordinary files, directory imports and external drops share restrictions across parent and child controllers', async t => {
  const hook = await mountSharedViews(t, { upload: { allowedExtensions: ['.txt'], maxFileSizeBytes: 4 } });
  const before = hook.current.main.entries;
  const batches = [
    () => hook.current.main.addLocalFiles([file('invalid.exe')]),
    () => hook.current.child.addLocalFiles([file('fine.txt', 3, 'Batch/fine.txt'), file('invalid.exe', 8, 'Batch/invalid.exe')], 'folder', 'folder'),
    () => hook.current.child.drop(dropEvent([file('dropped.exe')]), 'folder'),
  ];
  for (let index = 0; index < batches.length; index++) {
    await change(batches[index]);
    assert.equal(hook.current.main.entries, before);
    assert.equal(hook.current.child.entries, before);
    assert.equal(hook.current.main.dirty, false); assert.equal(hook.current.child.dirty, false);
    assert.equal(hook.events.filter(e => e.type === 'upload').length, index + 1);
    assert.equal(hook.events.filter(e => e.type === 'change').length, 0);
  }
  assert.equal(hook.events.filter(e => e.type === 'upload').at(-1).parentPath, '/資料');
  assert.deepEqual(hook.saves, []); assert.deepEqual(hook.reads, []);
  await hook.update({ upload: { allowedExtensions: ['.exe'], maxFileSizeBytes: 4 } });
  await change(() => hook.current.child.drop(dropEvent([file('allowed.exe')]), 'folder'));
  assert.equal(hook.current.main.entries.at(-1).name, 'allowed.exe');
  assert.equal(hook.current.main.entries.at(-1).parent, 'folder');
  assert.equal(hook.current.child.entries, hook.current.main.entries);
  assert.equal(hook.current.main.dirty, true);
});

test('real Explorer file pickers expose normalized accept, keep directory contents complete and reset after rejection', async t => {
  const events = [], saves = [];
  let props = { initialEntries: [folder], onSave: value => { saves.push(value); }, onEvent: event => events.push(event),
    upload: { allowedExtensions: ['.TXT', '.txt', '.tar.gz'], maxFileSizeBytes: 4 } };
  let renderer;
  const tree = () => h(StrictMode, null, h(Explorer, props));
  await change(() => { renderer = create(tree()); });
  t.after(() => change(() => renderer.unmount()));
  const inputs = () => renderer.root.findAllByType('input').filter(e => e.props.type === 'file');
  const fileInput = () => inputs().find(e => e.props['aria-label'] === '追加するファイル');
  const folderInput = () => inputs().find(e => e.props['aria-label'] === '追加するフォルダ');
  assert.equal(fileInput().props.accept, '.txt,.tar.gz');
  assert.equal(folderInput().props.accept, undefined);
  assert.ok(Object.hasOwn(folderInput().props, 'webkitdirectory'));
  const fileTarget = { files: [file('bad.exe')], value: 'fake-file-path' };
  await change(() => fileInput().props.onChange({ target: fileTarget }));
  assert.equal(fileTarget.value, '');
  const folderTarget = { files: [file('ok.txt', 1, 'Batch/ok.txt'), file('bad.exe', 6, 'Batch/bad.exe')], value: 'fake-folder-path' };
  await change(() => folderInput().props.onChange({ target: folderTarget }));
  assert.equal(folderTarget.value, '');
  assert.equal(events.filter(e => e.type === 'upload').length, 2);
  assert.equal(events.filter(e => e.type === 'change').length, 0);
  assert.deepEqual(saves, []);
  props = { ...props, upload: { allowedExtensions: ['.PDF'] } };
  await change(() => renderer.update(tree()));
  assert.equal(fileInput().props.accept, '.pdf'); assert.equal(folderInput().props.accept, undefined);
  const accepted = { files: [file('allowed.PDF')], value: 'fake-file-path' };
  await change(() => fileInput().props.onChange({ target: accepted }));
  assert.equal(accepted.value, '');
  assert.equal(events.filter(e => e.type === 'change').length, 1);
  props = { ...props, upload: { allowedExtensions: [] } };
  await change(() => renderer.update(tree()));
  assert.equal(fileInput().props.accept, undefined);
});

test('upload results report accepted file counts without counting created folders, with reject-batch as the default', () => {
  const source = snapshot();
  const good = file('inside.txt', 1, 'Batch/Nested/inside.txt');
  const imported = addFilesWithResult(source, [good], 'root');
  assert.deepEqual(imported.result, { attemptedCount: 1, addedCount: 1, overwrittenCount: 0, skippedCount: 0, rejections: [] });
  assert.equal(imported.snapshot.entries.length - source.entries.length, 3);
  assert.equal(imported.snapshot.entries.at(-1).source.file, good);
  assert.deepEqual(addFilesWithResult(source, [], 'root').result, { attemptedCount: 0, addedCount: 0, overwrittenCount: 0, skippedCount: 0, rejections: [] });
  assert.equal(addFilesWithResult(source, [], 'root').snapshot, source);
  for (const invalidFileBehavior of [undefined, 'reject-batch']) {
    rejected(() => addFilesWithResult(source, [good, file('bad.exe')], 'root', { allowedExtensions: ['.txt'], invalidFileBehavior }));
    assert.deepEqual(source.entries, [folder]);
  }
});

test('skip imports only valid files, omits rejected-only folders, and reports all extension and size reasons', t => {
  const source = snapshot();
  const good = file('good.TXT', 4, ' Batch /Allowed/good.TXT');
  const badExtension = file('bad.exe', 4, 'Batch/Rejected/bad.exe');
  const badSize = file('large.txt', 5, 'Batch/Rejected/large.txt');
  const badBoth = file('both.exe', 7, 'Batch/Rejected/both.exe');
  const spies = [good, badExtension, badSize, badBoth].flatMap(value => ['arrayBuffer', 'text', 'stream'].map(method =>
    t.mock.method(value, method, () => { throw Error('Unexpected file content read'); })));
  const { snapshot: updated, result } = addFilesWithResult(source, [good, badExtension, badSize, badBoth], 'folder', {
    allowedExtensions: ['.txt'], maxFileSizeBytes: 4, invalidFileBehavior: 'skip',
  });
  assert.equal(result.attemptedCount, 4); assert.equal(result.addedCount, 1);
  assert.deepEqual(result.rejections.map(item => item.file), [badExtension, badSize, badBoth]);
  assert.deepEqual(result.rejections.map(item => item.reasons.map(reason => reason.code)), [
    ['extension-not-allowed'], ['file-too-large'], ['extension-not-allowed', 'file-too-large'],
  ]);
  assert.deepEqual(updated.entries.slice(1).map(item => item.name), ['Batch', 'Allowed', 'good.TXT']);
  assert.equal(updated.entries.at(-1).source.file, good);
  assert.deepEqual(source.entries, [folder]);
  assert.ok(spies.every(spy => spy.mock.callCount() === 0));
  assert.equal(result.rejections.at(-1).relativePath, 'Batch/Rejected/both.exe');
});

test('all skipped files retain snapshot identity and skip handles hidden names, zero sizes and compound suffixes', () => {
  const source = snapshot();
  const excluded = file('bad.exe', 1, 'NeverCreated/Nested/bad.exe');
  const result = addFilesWithResult(source, [excluded], 'root', { allowedExtensions: [], invalidFileBehavior: 'skip' });
  assert.equal(result.snapshot, source); assert.equal(result.result.addedCount, 0); assert.equal(result.result.rejections.length, 1);
  assert.equal(addFiles(source, [excluded], 'root', { allowedExtensions: [], invalidFileBehavior: 'skip' }), source);
  const mixed = addFilesWithResult(source, [file('empty.TAR.GZ', 0), file('.env', 0), file('README', 0), file('full.tar.gz', 1)], 'root', {
    allowedExtensions: ['.tar.gz', '.env'], maxFileSizeBytes: 0, invalidFileBehavior: 'skip',
  });
  assert.equal(mixed.result.attemptedCount, 4); assert.equal(mixed.result.addedCount, 1);
  assert.equal(mixed.snapshot.entries.at(-1).name, 'empty.TAR.GZ');
  assert.deepEqual(mixed.result.rejections.map(item => item.name), ['.env', 'README', 'full.tar.gz']);
});

test('validation skips retain input indices while accepted duplicate names need an explicit conflict decision', () => {
  const good = file('same.txt', 1), rejectedDuplicate = file('same.txt', 6);
  const source = snapshot(), files = [rejectedDuplicate, good, good, rejectedDuplicate];
  const options = { maxFileSizeBytes: 1, invalidFileBehavior: 'skip' };
  let conflict;
  assert.throws(() => addFilesWithResult(source, files, 'root', options), error => {
    conflict = error; return error.name === 'ExplorerUploadConflictError';
  });
  assert.equal(conflict.conflict.fileIndex, 2); assert.equal(conflict.conflict.file, good);
  const { snapshot: updated, result } = addFilesWithResult(source, files, 'root', options,
    [{ fileIndex: 2, existing: conflict.conflict.existing, action: 'skip' }], conflict.session);
  assert.equal(result.attemptedCount, 4); assert.equal(result.addedCount, 1);
  assert.equal(result.overwrittenCount, 0); assert.equal(result.skippedCount, 1);
  assert.equal(result.rejections.length, 2); assert.equal(result.rejections[0].file, rejectedDuplicate);
  assert.equal(result.rejections[1].file, rejectedDuplicate);
  const imported = updated.entries.filter(item => item.kind === 'file');
  assert.equal(imported.length, 1); assert.equal(imported[0].name, 'same.txt');
  assert.equal(imported[0].source.file, good);
});

test('skip does not suppress malformed paths, invalid configuration, invalid destinations or broken File objects', () => {
  const source = snapshot();
  const options = { allowedExtensions: ['.txt'], invalidFileBehavior: 'skip' };
  const malformed = [file('bad.exe', 1, 'Batch/../bad.exe'), file('bad.exe', 1, 'Batch//bad.exe'),
    { name: 'broken.exe', size: 1 }, { name: 'broken.exe', size: NaN, arrayBuffer() {} }];
  for (const bad of malformed) {
    assert.throws(() => addFilesWithResult(source, [file('valid.txt'), bad], 'root', options), error => !(error instanceof ExplorerUploadValidationError));
    assert.deepEqual(source.entries, [folder]);
  }
  assert.throws(() => addFilesWithResult(source, [file('bad.exe')], 'missing-folder', options));
  assert.throws(() => addFilesWithResult(source, [file('bad.exe')], 'root', { ...options, maxFileSizeBytes: -1 }));
  const colliding = addFiles(source, [file('Batch')], 'root');
  assert.throws(() => addFilesWithResult(colliding, [file('good.txt', 1, 'Batch/good.txt'), file('bad.exe')], 'root', options));
  assert.equal(colliding.entries.filter(item => item.kind === 'file').length, 1);
});

test('partial skip returns isolated metadata and emits one change before a skipped event with the original destination', async t => {
  const hook = await mountDraft(t, { upload: { allowedExtensions: ['.txt'], maxFileSizeBytes: 4, invalidFileBehavior: 'skip' } });
  const good = file('good.txt', 2), bad = file('bad.exe', 8, 'OnlyRejected/bad.exe');
  let result;
  await change(() => { result = hook.current.add([good, bad], 'folder'); });
  assert.equal(result.attemptedCount, 2); assert.equal(result.addedCount, 1);
  assert.equal(result.rejections[0].file, bad);
  assert.equal(hook.current.dirty, true); assert.deepEqual(hook.saves, []);
  assert.deepEqual(hook.events.map(event => [event.type, event.type === 'upload' ? event.status : event.action]), [['change', 'upload'], ['upload', 'skipped']]);
  const event = hook.events[1];
  assert.equal(event.parentId, 'folder'); assert.equal(event.parentPath, '/資料');
  assert.equal(event.attemptedCount, 2); assert.equal(event.addedCount, 1);
  assert.deepEqual(event.rejections, result.rejections);
  assert.notEqual(event.rejections, result.rejections); assert.notEqual(event.rejections[0], result.rejections[0]);
  assert.notEqual(event.rejections[0].reasons, result.rejections[0].reasons);
  assert.notEqual(event.rejections[0].reasons[0], result.rejections[0].reasons[0]);
  assert.notEqual(event.rejections[0].reasons[0].allowedExtensions, result.rejections[0].reasons[0].allowedExtensions);
  event.rejections[0].name = 'changed.exe'; event.rejections[0].reasons[0].allowedExtensions.push('.exe');
  assert.equal(result.rejections[0].name, 'bad.exe');
  assert.deepEqual(result.rejections[0].reasons[0].allowedExtensions, ['.txt']);
  assert.equal(hook.current.entries.at(-1).source.file, good);
});

test('all-skipped and empty hook imports preserve clean or existing dirty state and avoid change events', async t => {
  const hook = await mountDraft(t, { upload: { allowedExtensions: ['.txt'], invalidFileBehavior: 'skip' } });
  let emptyResult;
  const clean = hook.current.entries;
  await change(() => { emptyResult = hook.current.add([], 'root'); });
  assert.deepEqual(emptyResult, { attemptedCount: 0, addedCount: 0, overwrittenCount: 0, skippedCount: 0, rejections: [] });
  assert.equal(hook.events.length, 0); assert.equal(hook.current.entries, clean);
  let skipped;
  await change(() => { skipped = hook.current.add([file('bad.exe', 1, 'Ignored/bad.exe')], 'root'); });
  assert.equal(skipped.addedCount, 0); assert.equal(hook.current.entries, clean); assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.events.map(event => event.type), ['upload']); assert.equal(hook.events[0].status, 'skipped');
  await change(() => hook.current.add([file('saved.txt')], 'root'));
  const dirty = hook.current.entries; const before = hook.events.length;
  await change(() => hook.current.add([file('other.exe')], 'root'));
  assert.equal(hook.current.entries, dirty); assert.equal(hook.current.dirty, true);
  assert.deepEqual(hook.events.slice(before).map(event => event.type), ['upload']);
});

test('skipped event observers cannot alter returned results, later restrictions or completed imports even when they throw', async t => {
  const hook = await mountDraft(t, { upload: { allowedExtensions: ['.txt'], invalidFileBehavior: 'skip' }, onEvent(event) {
    if (event.type !== 'upload') return;
    event.rejections[0].name = 'observer.exe';
    event.rejections[0].reasons[0].allowedExtensions.push('.exe');
    event.rejections.length = 0;
    throw Error('Observer failed');
  } });
  for (let index = 0; index < 2; index++) {
    let result;
    await change(() => { result = hook.current.add([file(`good-${index}.txt`), file('bad.exe')], 'root'); });
    assert.equal(result.addedCount, 1); assert.equal(result.rejections.length, 1);
    assert.equal(result.rejections[0].name, 'bad.exe'); assert.deepEqual(result.rejections[0].reasons[0].allowedExtensions, ['.txt']);
    result.rejections[0].reasons[0].allowedExtensions.push('.exe');
  }
  assert.equal(hook.current.entries.filter(item => item.kind === 'file').length, 2);
});

test('a retained hook add callback uses the latest behavior and restrictions, including restoring reject-batch', async t => {
  const hook = await mountDraft(t, { upload: { allowedExtensions: ['.txt'] } });
  const add = hook.current.add;
  await hook.update({ upload: { allowedExtensions: ['.pdf'], invalidFileBehavior: 'skip' } });
  let result;
  await change(() => { result = add([file('now.pdf'), file('old.txt')], 'root'); });
  assert.equal(result.addedCount, 1); assert.equal(result.rejections[0].name, 'old.txt');
  const before = hook.current.entries;
  await hook.update({ upload: { allowedExtensions: ['.pdf'], invalidFileBehavior: 'reject-batch' } });
  await change(() => rejected(() => add([file('also.pdf'), file('old.txt')], 'root')));
  assert.equal(hook.current.entries, before);
  await hook.update({ upload: undefined });
  await change(() => { result = add([file('unrestricted.exe')], 'root'); });
  assert.deepEqual(result, { attemptedCount: 1, addedCount: 1, overwrittenCount: 0, skippedCount: 0, rejections: [] });
});

test('parent and popup controller imports and external drops use accepted counts and shared skip behavior', async t => {
  const hook = await mountSharedViews(t, { upload: { allowedExtensions: ['.txt'], maxFileSizeBytes: 4, invalidFileBehavior: 'skip' } });
  await change(() => hook.current.child.addLocalFiles([file('good.txt', 1, 'Batch/good.txt'), file('bad.exe', 1, 'Batch/Rejected/bad.exe')], 'folder', 'folder'));
  assert.equal(hook.current.child.entries, hook.current.main.entries);
  assert.deepEqual(hook.current.main.entries.slice(1).map(item => item.name), ['Batch', 'good.txt']);
  assert.match(hook.current.child.notification.message, /1.*追加/);
  assert.match(hook.current.child.notification.message + hook.current.child.notification.description, /1.*(?:除外|スキップ)/);
  await change(() => hook.current.main.drop(dropEvent([file('next.txt'), file('bad.exe'), file('large.txt', 5)]), 'root'));
  assert.match(hook.current.main.notification.message, /1.*追加/);
  assert.match(hook.current.main.notification.message + hook.current.main.notification.description, /2.*(?:除外|スキップ)/);
  const before = hook.current.main.entries;
  await change(() => hook.current.child.addLocalFiles([file('none.exe')]));
  assert.equal(hook.current.main.entries, before);
  assert.notEqual(hook.current.child.notification.kind, 'success');
  assert.match(hook.current.child.notification.message + hook.current.child.notification.description, /1.*(?:除外|スキップ)/);
  assert.deepEqual(hook.events.filter(event => event.type === 'upload').map(event => event.addedCount), [1, 1, 0]);
  assert.equal(hook.events.filter(event => event.type === 'change').length, 2);
  assert.deepEqual(hook.reads, []); assert.deepEqual(hook.saves, []);
});

test('all-skipped or empty imports preserve an existing save error as well as the staged draft', async t => {
  const hook = await mountDraft(t, { upload: { allowedExtensions: ['.txt'], invalidFileBehavior: 'skip' },
    onSave() { throw Error('Storage temporarily unavailable'); } });
  await change(() => hook.current.add([file('good.txt')], 'root'));
  await change(() => hook.current.save());
  assert.equal(hook.current.saveError, 'Storage temporarily unavailable');
  const before = hook.current.entries;
  await change(() => hook.current.add([file('bad.exe')], 'root'));
  await change(() => hook.current.add([], 'root'));
  assert.equal(hook.current.entries, before); assert.equal(hook.current.dirty, true);
  assert.equal(hook.current.saveError, 'Storage temporarily unavailable');
});

test('real Explorer file and folder pickers pass skip results through and reset their native inputs', async t => {
  const events = [];
  const props = { initialEntries: [folder], onSave() {}, onEvent: event => events.push(event),
    upload: { allowedExtensions: ['.txt'], maxFileSizeBytes: 4, invalidFileBehavior: 'skip' } };
  let renderer;
  await change(() => { renderer = create(h(StrictMode, null, h(Explorer, props))); });
  t.after(() => change(() => renderer.unmount()));
  const input = label => renderer.root.findAllByType('input').find(item => item.props['aria-label'] === label);
  const files = { files: [file('good.txt'), file('bad.exe')], value: 'fake-file' };
  await change(() => input('追加するファイル').props.onChange({ target: files }));
  const folders = { files: [file('nested.txt', 1, 'Batch/nested.txt'), file('bad.txt', 5, 'Rejected/bad.txt')], value: 'fake-folder' };
  await change(() => input('追加するフォルダ').props.onChange({ target: folders }));
  assert.equal(files.value, ''); assert.equal(folders.value, '');
  assert.equal(input('追加するファイル').props.accept, '.txt');
  assert.equal(input('追加するフォルダ').props.accept, undefined);
  assert.deepEqual(events.filter(event => event.type === 'upload').map(event => [event.status, event.addedCount]), [['skipped', 1], ['skipped', 1]]);
  assert.equal(events.filter(event => event.type === 'change').length, 2);
});
