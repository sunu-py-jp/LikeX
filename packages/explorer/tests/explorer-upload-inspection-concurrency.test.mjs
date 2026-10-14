import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const {
  createExplorerUploadSession, inspectUploadCandidates, resolveUploadOptions, validateUploadFiles,
  ExplorerUploadInspectionRequiredError, ExplorerUploadValidationError,
} = await importTypeScript('../src/model/upload.ts');
const { prepareImport } = await importTypeScript('../src/state/import-progress.ts');

const candidate = name => ({ file: new File(['metadata'], name), name, relativePath: name });
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
async function until(predicate) {
  for (let index = 0; index < 100 && !predicate(); index++) await tick();
  assert.ok(predicate(), 'the expected inspection state must become available');
}
function metadata(kind) {
  return kind === 'pdf' ? { kind, pages: 2 } : kind === 'presentation' ? { kind, slides: 2 } : { kind, durationSeconds: 2 };
}
function controlledInspector() {
  const calls = new Map(), active = { media: 0, document: 0 }, maximum = { media: 0, document: 0 };
  let finished = 0;
  return {
    calls, active, maximum, get finished() { return finished; },
    inspectFile(request) {
      const group = request.kind === 'video' || request.kind === 'audio' ? 'media' : 'document';
      active[group]++;
      maximum[group] = Math.max(maximum[group], active[group]);
      const gate = deferred();
      calls.set(request.file.name, { ...gate, request, finish() { gate.resolve(metadata(request.kind)); } });
      return gate.promise.finally(() => { active[group]--; finished++; });
    },
  };
}
function policy(inspectFile, additional = {}) {
  return resolveUploadOptions({
    contentLimitsByExtension: { '.mp3': { maxDurationSeconds: 60 }, '.pdf': { maxPages: 20 }, '.pptx': { maxSlides: 20 } },
    inspectFile, ...additional,
  });
}

test('six media files share four slots, PDF files stay serial, and progress reports completed work including unchecked text', async () => {
  const files = ['1.mp4', '2.mp3', '3.mp4', '4.mp3', '5.mp4', '6.mp3', 'a.pdf', 'b.pdf', 'notes.txt'].map(candidate);
  const inspector = controlledInspector(), options = policy(inspector.inspectFile), session = createExplorerUploadSession();
  const progress = [];
  const finished = (async () => {
    for await (const event of inspectUploadCandidates(files, options, session, new AbortController().signal)) {
      assert.ok(event.completed <= inspector.finished + 1, 'queued files cannot count as complete');
      progress.push(event);
    }
  })();
  await until(() => inspector.calls.size === 5 && progress.length > 1);
  assert.deepEqual(progress.at(-1), { phase: 'inspecting', completed: 1, total: 9 });
  assert.deepEqual([...inspector.calls.keys()], ['1.mp4', '2.mp3', '3.mp4', '4.mp3', 'a.pdf']);
  inspector.calls.get('4.mp3').finish();
  await until(() => inspector.calls.has('5.mp4') && progress.at(-1).completed === 2);
  inspector.calls.get('a.pdf').finish();
  await until(() => inspector.calls.has('b.pdf') && progress.at(-1).completed === 3);
  inspector.calls.get('2.mp3').finish();
  await until(() => inspector.calls.has('6.mp3') && progress.at(-1).completed === 4);
  for (const name of ['6.mp3', '1.mp4', 'b.pdf', '5.mp4', '3.mp4']) inspector.calls.get(name).finish();
  await finished;
  assert.deepEqual(inspector.maximum, { media: 4, document: 1 });
  assert.deepEqual(inspector.active, { media: 0, document: 0 });
  assert.deepEqual(progress.at(-1), { phase: 'inspecting', completed: 9, total: 9 });
  assert.ok(progress.every((event, index) => index === 0 || event.completed > progress[index - 1].completed));
  assert.equal(validateUploadFiles(files, options, session).accepted.length, 9, 'all metadata must be cached before the generator completes');
});

test('PDF and PPTX share one document slot while media can proceed independently', async () => {
  const files = ['a.pdf', 'b.pptx', 'c.pdf', 'clip.mp4'].map(candidate);
  const inspector = controlledInspector(), options = policy(inspector.inspectFile);
  const pending = (async () => {
    for await (const event of inspectUploadCandidates(files, options, createExplorerUploadSession(), new AbortController().signal)) assert.equal(event.phase, 'inspecting');
  })();
  await until(() => inspector.calls.size === 2);
  assert.deepEqual([...inspector.calls.keys()], ['clip.mp4', 'a.pdf']);
  inspector.calls.get('a.pdf').finish();
  await until(() => inspector.calls.has('b.pptx'));
  assert.equal(inspector.calls.has('c.pdf'), false);
  inspector.calls.get('b.pptx').finish();
  await until(() => inspector.calls.has('c.pdf'));
  inspector.calls.get('c.pdf').finish();
  inspector.calls.get('clip.mp4').finish();
  await pending;
  assert.equal(inspector.maximum.document, 1);
});

test('failed custom readers remain cached rejections and every other inspection finishes before validation', async () => {
  const files = ['bad.mp4', 'good.mp4', 'notes.txt'].map(candidate), session = createExplorerUploadSession();
  const inspector = controlledInspector(), options = policy(inspector.inspectFile, { invalidFileBehavior: 'skip' });
  const pending = (async () => {
    for await (const event of inspectUploadCandidates(files, options, session, new AbortController().signal)) assert.equal(event.phase, 'inspecting');
  })();
  await until(() => inspector.calls.size === 2);
  inspector.calls.get('bad.mp4').reject(new Error('metadata failed'));
  await tick();
  assert.throws(() => validateUploadFiles(files, options, session), ExplorerUploadInspectionRequiredError);
  inspector.calls.get('good.mp4').finish();
  await pending;
  const result = validateUploadFiles(files, options, session);
  assert.deepEqual(result.accepted.map(value => value.name), ['good.mp4', 'notes.txt']);
  assert.match(result.rejections[0].reasons[0].message, /metadata failed/);
  assert.throws(() => validateUploadFiles(files, { ...options, invalidFileBehavior: 'reject-batch' }, session), ExplorerUploadValidationError);
});

for (const action of ['abort', 'return', 'throw']) test(`${action} stops queued work, signals every active reader, and ignores late success or rejection`, async () => {
  const files = ['1.mp4', '2.mp3', '3.mp4', '4.mp3', '5.mp4', '6.mp3', 'a.pdf', 'b.pdf', 'notes.txt'].map(candidate);
  const inspector = controlledInspector(), options = policy(inspector.inspectFile), session = createExplorerUploadSession();
  const controller = new AbortController();
  const operation = inspectUploadCandidates(files, options, session, controller.signal);
  assert.equal((await operation.next()).value.completed, 0);
  assert.equal((await operation.next()).value.completed, 1);
  assert.equal(inspector.calls.size, 5);
  if (action === 'abort') {
    const next = operation.next();
    const rejected = assert.rejects(next, { name: 'AbortError' });
    controller.abort();
    await rejected;
  } else if (action === 'return') assert.equal((await operation.return()).done, true);
  else await assert.rejects(operation.throw(new Error('observer failed')), /observer failed/);
  assert.ok([...inspector.calls.values()].every(call => call.request.signal.aborted));
  let index = 0;
  for (const call of inspector.calls.values()) {
    if (index++ % 2) call.reject(new Error('late failure')); else call.finish();
  }
  await tick(); await tick();
  assert.equal(inspector.calls.size, 5, 'cancelled queued candidates must never start');
  assert.throws(() => validateUploadFiles([files[0]], options, session), ExplorerUploadInspectionRequiredError);
});

test('repeated File references share in-flight metadata without double-counting progress', async () => {
  const first = candidate('same.mp4'), files = [first, { ...first, relativePath: 'other/same.mp4' }];
  const inspector = controlledInspector(), options = policy(inspector.inspectFile), session = createExplorerUploadSession();
  let last;
  const pending = (async () => {
    for await (const event of inspectUploadCandidates(files, options, session, new AbortController().signal)) last = event;
  })();
  await until(() => inspector.calls.size === 1);
  assert.equal(inspector.active.media, 1);
  inspector.calls.get('same.mp4').finish();
  await pending;
  assert.equal(last.completed, 2);
  assert.equal(validateUploadFiles(files, options, session).accepted.length, 2);
});

test('empty and cheaply rejected candidates finish without starting a reader', async () => {
  const empty = { ...candidate('empty.mp4'), file: new File([], 'empty.mp4') };
  const files = [empty, candidate('forbidden.mp3'), candidate('large.mp4'), candidate('notes.txt')];
  const options = policy(() => assert.fail('cheap rejections cannot read content'), {
    allowedExtensions: ['.mp4', '.txt'], maxFileSizeBytes: 2, invalidFileBehavior: 'skip',
  });
  const session = createExplorerUploadSession(), progress = [];
  for await (const event of inspectUploadCandidates(files, options, session, new AbortController().signal)) progress.push(event);
  assert.equal(progress.at(-1).completed, 4);
  assert.equal(validateUploadFiles(files, options, session).rejections.length, 4);
});

test('a queued built-in media reader receives its own full thirty-second timeout after taking a slot', async t => {
  const elements = [], revoked = [];
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: { createElement(kind) {
    const listeners = new Map();
    const element = { kind, duration: NaN, source: '',
      addEventListener(type, listener) { listeners.set(type, listener); },
      removeEventListener(type) { listeners.delete(type); },
      set src(value) { this.source = value; },
      removeAttribute() { this.source = ''; },
      load() {}, emit(type) { listeners.get(type)?.(); },
    };
    elements.push(element);
    return element;
  } } });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous); else delete globalThis.document;
  });
  t.mock.method(URL, 'createObjectURL', file => `blob:${file.name}`);
  t.mock.method(URL, 'revokeObjectURL', url => revoked.push(url));
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const files = ['1.mp4', '2.mp4', '3.mp4', '4.mp4', '5.mp4'].map(candidate);
  const options = resolveUploadOptions({ invalidFileBehavior: 'skip' }), session = createExplorerUploadSession();
  let last;
  const pending = (async () => {
    for await (const event of inspectUploadCandidates(files, options, session, new AbortController().signal)) last = event;
  })();
  await until(() => elements.length === 4);
  t.mock.timers.tick(29_000);
  elements[0].duration = 2;
  elements[0].emit('loadedmetadata');
  await until(() => elements.length === 5);
  assert.equal(last.completed, 1);
  t.mock.timers.tick(1_000);
  await until(() => last.completed === 4);
  assert.equal(elements[4].source, 'blob:5.mp4', 'queued time must not consume the fifth file’s timeout');
  t.mock.timers.tick(29_000);
  await pending;
  assert.equal(last.completed, 5);
  assert.equal(revoked.length, 5);
  const result = validateUploadFiles(files, options, session);
  assert.deepEqual(result.accepted.map(value => value.name), ['1.mp4']);
  assert.equal(result.rejections.length, 4);
  assert.ok(result.rejections.every(value => value.reasons[0].message.includes('タイムアウト')));
});

test('a suspended progress consumer bounds classification and does not allow synchronous readers to drain the queue', async () => {
  const classified = new Set();
  const files = Array.from({ length: 1_200 }, (_, index) => {
    const value = candidate(`${index}.mp4`);
    return { ...value, get name() { classified.add(index); return value.name; } };
  });
  let reads = 0;
  const options = policy(request => { reads++; return metadata(request.kind); });
  const operation = inspectUploadCandidates(files, options, createExplorerUploadSession(), new AbortController().signal);
  assert.equal((await operation.next()).value.completed, 0);
  const checkpoint = await operation.next();
  assert.equal(checkpoint.value.completed, 0, 'queued files are not completed work');
  await tick();
  assert.equal(classified.size, 32, 'classification waits for the consumer after a bounded chunk');
  assert.equal(reads, 4, 'only the active lane slots may finish while the consumer is paused');
  await operation.return();
  await tick();
  assert.equal(reads, 4);
});

for (const cached of [false, true]) test(`${cached ? 'cached' : 'synchronous'} inspections let the task queue run before a 1,200-file batch completes`, async t => {
  // Use the deterministic step budget, rather than depending on CPU speed to
  // trigger the elapsed-time checkpoint in prepareImport.
  t.mock.method(performance, 'now', () => 0);
  const files = Array.from({ length: 1_200 }, (_, index) => candidate(`${index}.mp4`));
  const session = createExplorerUploadSession();
  let reads = 0;
  const options = policy(request => { reads++; return metadata(request.kind); });
  if (cached) {
    for await (const event of inspectUploadCandidates(files, options, session, new AbortController().signal)) assert.equal(event.phase, 'inspecting');
    assert.equal(reads, files.length);
    reads = 0;
  }
  let completed = 0, taskCompleted, scheduled = false;
  const controller = new AbortController();
  async function* observed() {
    for await (const event of inspectUploadCandidates(files, options, session, controller.signal)) {
      assert.ok(event.completed >= completed, 'completion counts never go backwards');
      completed = event.completed;
      if (completed > 0 && !scheduled) {
        scheduled = true;
        setTimeout(() => { taskCompleted = completed; }, 0);
      }
      yield event;
    }
  }
  await prepareImport(observed(), controller.signal, () => {});
  assert.ok(taskCompleted > 0 && taskCompleted < files.length, 'a rendering/cancellation task gets a turn before all inspections finish');
  assert.equal(completed, files.length);
  assert.equal(reads, cached ? 0 : files.length);
  assert.equal(validateUploadFiles(files, options, session).accepted.length, files.length);
});
