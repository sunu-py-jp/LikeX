import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { packageRoot } from './test-paths.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ absWorkingDir: packageRoot,
  stdin: { resolveDir: packageRoot, contents: `
    export * from './src/model-entry.ts';
    export { resolveUploadOptions } from './src/model/upload.ts';
    export { useExplorerDraft } from './src/state/use-explorer-draft.ts';
  ` }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { createDraftSnapshot, addFilesWithResult, addFilesWithResultAsync, createExplorerUploadSession,
  ExplorerUploadValidationError, ExplorerUploadInspectionRequiredError, inspectExplorerUploadFile,
  EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS: defaults, resolveUploadOptions, useExplorerDraft,
} = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const pageRule = { '.pdf': { maxPages: 10 } };
const incoming = () => new File(['host-inspected PDF'], 'paper.pdf');
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const add = (file, options, session = createExplorerUploadSession()) =>
  addFilesWithResultAsync(createDraftSnapshot([]), [file], 'root', options, [], session);
const syncAdd = (file, options, session) => addFilesWithResult(createDraftSnapshot([]), [file], 'root', options, [], session);
const pdfOptions = (inspectFile, pdfInspectionLimits) => ({ contentLimitsByExtension: pageRule, inspectFile,
  ...(pdfInspectionLimits === undefined ? {} : { pdfInspectionLimits }) });

// A small independent classic-xref fixture exercises the public built-in reader.
function simplePdf() {
  let text = '%PDF-1.7\n'; const offsets = [0];
  for (const [index, body] of ['<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Count 1 /Kids [3 0 R] >>', '<< /Type /Page /Parent 2 0 R >>'].entries()) {
    offsets.push(text.length); text += `${index + 1} 0 obj\n${body}\nendobj\n`;
  }
  const xref = text.length;
  text += 'xref\n0 4\n0000000000 65535 f \n';
  for (const offset of offsets.slice(1)) text += `${String(offset).padStart(10, '0')} 00000 n \n`;
  text += `trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new File([text], 'ordinary.pdf', { type: 'application/pdf' });
}

test('public defaults and upload snapshots are frozen, detached and preserve existing default option shape', () => {
  assert.ok(Object.isFrozen(defaults));
  assert.equal(defaults.inputBytes, 100 * 1024 * 1024);
  assert.equal(typeof inspectExplorerUploadFile, 'function');
  assert.deepEqual(resolveUploadOptions(), { allowedExtensions: undefined, maxFileSizeBytes: undefined,
    accept: undefined, invalidFileBehavior: 'reject-batch' });
  const supplied = { objects: 123 }, options = resolveUploadOptions({ pdfInspectionLimits: supplied });
  supplied.objects = 456;
  assert.deepEqual(options.pdfInspectionLimits, { ...defaults, objects: 123 });
  assert.ok(Object.isFrozen(options.pdfInspectionLimits));
});

test('invalid public upload and direct-reader settings fail before host callbacks or file I/O', async () => {
  const file = incoming(); let calls = 0;
  file.arrayBuffer = () => { calls++; throw Error('unexpected I/O'); };
  const inspectFile = () => { calls++; return { kind: 'pdf', pages: 1 }; };
  for (const limits of [null, [], { unsupported: 1 }, { objects: 0 }, { objects: -1 }, { objects: 1.5 },
    { objects: Infinity }, { objects: Number.MAX_SAFE_INTEGER + 1 }, { timeoutMs: 2 ** 31 }, { [Symbol('hidden')]: 1 }]) {
    await assert.rejects(add(file, pdfOptions(inspectFile, limits)), /pdfInspectionLimits/);
    await assert.rejects(inspectExplorerUploadFile({ file, extension: '.pdf', kind: 'pdf',
      signal: new AbortController().signal, pdfInspectionLimits: limits }), /pdfInspectionLimits/);
  }
  assert.equal(calls, 0);
});

test('PDF cache equality is by normalized value and each tighter or looser budget invalidates it', async () => {
  const file = incoming(), session = createExplorerUploadSession(); let calls = 0;
  const inspectFile = request => { calls++; assert.deepEqual(Object.keys(request.pdfInspectionLimits).sort(), Object.keys(defaults).sort());
    assert.ok(Object.isFrozen(request.pdfInspectionLimits)); return { kind: 'pdf', pages: 1 }; };
  await add(file, pdfOptions(inspectFile), session);
  for (const equivalent of [{}, { ...defaults }, { objects: undefined }]) {
    assert.equal(syncAdd(file, pdfOptions(inspectFile, equivalent), session).result.addedCount, 1);
    await add(file, pdfOptions(inspectFile, equivalent), session);
  }
  assert.equal(calls, 1);
  for (const [key, value] of Object.entries(defaults)) {
    for (const amount of [value - 1, value + 1, value]) {
      const options = pdfOptions(inspectFile, { [key]: amount });
      assert.throws(() => syncAdd(file, options, session), ExplorerUploadInspectionRequiredError);
      await add(file, options, session);
    }
  }
  assert.equal(calls, 1 + Object.keys(defaults).length * 3);
});

test('failed PDF evidence is reusable only under equivalent settings and cannot bypass changed budgets', async () => {
  const file = incoming(), session = createExplorerUploadSession(); let calls = 0;
  const inspectFile = ({ pdfInspectionLimits }) => {
    calls++;
    if (pdfInspectionLimits.objects === 100) throw Error('host could not inspect under this budget');
    return { kind: 'pdf', pages: 1 };
  };
  for (const limits of [{ objects: 100 }, { ...defaults, objects: 100 }]) {
    await assert.rejects(add(file, pdfOptions(inspectFile, limits), session), ExplorerUploadValidationError);
  }
  assert.equal(calls, 1);
  const loosened = pdfOptions(inspectFile, { objects: 101 });
  assert.throws(() => syncAdd(file, loosened, session), ExplorerUploadInspectionRequiredError);
  await add(file, loosened, session);
  assert.equal(calls, 2);
  await assert.rejects(add(file, pdfOptions(inspectFile, { objects: 100 }), session), ExplorerUploadValidationError);
  assert.equal(calls, 3, 'changing back does not revive historical evidence');
});

test('mutating caller settings during an async import cannot change its request or cache policy', async () => {
  const file = incoming(), session = createExplorerUploadSession(), started = deferred(), metadata = deferred();
  const supplied = { objects: 100 }; let captured, calls = 0;
  const inspectFile = request => { captured = request; calls++; started.resolve(); return metadata.promise; };
  const options = pdfOptions(inspectFile, supplied), pending = add(file, options, session);
  await started.promise;
  supplied.objects = 200;
  assert.equal(captured.pdfInspectionLimits.objects, 100);
  assert.ok(Object.isFrozen(captured));
  metadata.resolve({ kind: 'pdf', pages: 1 });
  assert.equal((await pending).result.addedCount, 1);
  assert.equal(syncAdd(file, pdfOptions(inspectFile, { objects: 100 }), session).result.addedCount, 1);
  assert.throws(() => syncAdd(file, options, session), ExplorerUploadInspectionRequiredError);
  await add(file, options, session);
  assert.equal(calls, 2);
  assert.equal(captured.pdfInspectionLimits.objects, 200);
});

test('PDF settings changes do not invalidate media inspection evidence', async () => {
  const file = new File(['host-inspected video'], 'clip.mp4'), session = createExplorerUploadSession(); let calls = 0;
  const inspectFile = request => { calls++; assert.equal(request.pdfInspectionLimits, undefined); return { kind: 'video', durationSeconds: 1 }; };
  await add(file, { inspectFile, pdfInspectionLimits: { objects: 100 } }, session);
  await add(file, { inspectFile, pdfInspectionLimits: { objects: 200 } }, session);
  assert.equal(calls, 1);
});

test('standalone public inspection and custom fallback enforce byte budgets before reading and retry changed limits', async () => {
  const file = simplePdf(), session = createExplorerUploadSession(); let reads = 0, calls = 0;
  const arrayBuffer = file.arrayBuffer.bind(file);
  file.arrayBuffer = () => { reads++; return arrayBuffer(); };
  const request = { file, extension: '.pdf', kind: 'pdf', signal: new AbortController().signal };
  await assert.rejects(inspectExplorerUploadFile({ ...request, pdfInspectionLimits: { inputBytes: file.size - 1 } }), /PDF/);
  assert.equal(reads, 0);
  assert.deepEqual(await inspectExplorerUploadFile({ ...request, pdfInspectionLimits: { inputBytes: file.size } }), { kind: 'pdf', pages: 1 });
  reads = 0;
  const inspectFile = ({ pdfInspectionLimits }) => { calls++; assert.ok(Object.isFrozen(pdfInspectionLimits)); return undefined; };
  await assert.rejects(add(file, pdfOptions(inspectFile, { inputBytes: file.size - 1 }), session), ExplorerUploadValidationError);
  assert.equal(reads, 0);
  assert.equal((await add(file, pdfOptions(inspectFile, { inputBytes: file.size }), session)).result.addedCount, 1);
  assert.equal(reads, 1); assert.equal(calls, 2);
});

const change = async callback => { await act(async () => { await callback(); }); };
async function mountDraft(t, upload) {
  let latest, renderer, props = { initialEntries: [], onSave() {}, upload };
  function Probe({ options }) { latest = useExplorerDraft(options); return null; }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  await change(() => { renderer = create(tree()); });
  t.after(() => change(() => renderer.unmount()));
  return { get current() { return latest; }, async update(upload) {
    props = { ...props, upload }; await change(() => renderer.update(tree()));
  } };
}

test('GUI pending imports reinspect changed PDF settings before committing any entries', async t => {
  for (const outcome of ['accepted', 'rejected']) await t.test(outcome, async t => {
    const first = deferred(), second = deferred(), firstStarted = deferred(), secondStarted = deferred(), policies = [];
    const inspectFile = request => {
      policies.push(request.pdfInspectionLimits.objects);
      if (policies.length === 1) { firstStarted.resolve(); return first.promise; }
      secondStarted.resolve(); return second.promise;
    };
    const hook = await mountDraft(t, pdfOptions(inspectFile, { objects: 100 }));
    let pending;
    await change(() => { pending = hook.current.addAsync([incoming()], 'root').then(value => ({ value }), error => ({ error })); });
    await change(() => firstStarted.promise);
    await hook.update(pdfOptions(inspectFile, { objects: 50 }));
    await change(() => first.resolve({ kind: 'pdf', pages: 1 }));
    await change(() => secondStarted.promise);
    assert.deepEqual(policies, [100, 50]);
    assert.deepEqual(hook.current.entries, []);
    assert.equal(hook.current.dirty, false);
    await change(() => second.resolve(outcome === 'accepted' ? { kind: 'pdf', pages: 1 } : { kind: 'pdf', pages: 100 }));
    let result; await change(async () => { result = await pending; });
    if (outcome === 'accepted') { assert.equal(result.value.addedCount, 1); assert.equal(hook.current.entries.length, 1); }
    else { assert.ok(result.error instanceof ExplorerUploadValidationError); assert.deepEqual(hook.current.entries, []); assert.equal(hook.current.dirty, false); }
  });
});
