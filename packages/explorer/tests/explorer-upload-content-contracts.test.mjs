import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const {
  EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS, normalizeUploadContentLimits, getUploadContentRule,
  compareUploadContentMetadata,
  createExplorerUploadInspectionContext, readUploadContentInspection, ensureUploadContentInspection,
} = await importTypeScript('../src/model/upload-content.ts');
const video = name => new File(['video bytes'], name ?? 'clip.mp4');
const options = (extra = {}) => ({ context: createExplorerUploadInspectionContext(), file: video(),
  rule: getUploadContentRule('clip.mp4'), signal: new AbortController().signal, ...extra });

test('all known video suffixes default to four hours while audio, PDF and PPTX are opt in', () => {
  assert.equal(EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS, 14400);
  for (const extension of ['mp4', 'webm', 'm4v', 'mov', 'mkv', 'avi', 'wmv', 'mpg', 'mpeg', 'ogv', '3gp'])
    assert.deepEqual(getUploadContentRule(`CLIP.${extension.toUpperCase()}`), {
      extension: `.${extension}`, kind: 'video', maxDurationSeconds: 14400,
    });
  for (const name of ['audio.mp3', 'audio.wav', 'audio.m4a', 'audio.aac', 'audio.ogg', 'audio.flac',
    'document.pdf', 'deck.pptx', 'old.ppt', 'macro.pptm', 'file.txt', '.mp4', 'clip.mp4.exe'])
    assert.equal(getUploadContentRule(name), undefined);
});

test('only false disables defaults; empty and undefined entries inherit them', () => {
  for (const entry of [undefined, {}, { maxDurationSeconds: undefined }]) {
    const limits = normalizeUploadContentLimits({ '.mp4': entry, '.pdf': undefined });
    assert.deepEqual(limits, {});
    assert.equal(getUploadContentRule('clip.mp4', limits).maxDurationSeconds, 14400);
  }
  assert.equal(getUploadContentRule('clip.mp4', normalizeUploadContentLimits({ '.mp4': false })), undefined);
  assert.equal(getUploadContentRule('clip.mp4', normalizeUploadContentLimits({ '.mp4': { maxDurationSeconds: 0 } })).maxDurationSeconds, 0);
  assert.equal(getUploadContentRule('track.mp3', normalizeUploadContentLimits({ '.mp3': { maxDurationSeconds: 1.5 } })).maxDurationSeconds, 1.5);
  assert.equal(getUploadContentRule('file.pdf', normalizeUploadContentLimits({ '.pdf': { maxPages: 0 } })).maxPages, 0);
  assert.equal(getUploadContentRule('deck.pptx', normalizeUploadContentLimits({ '.pptx': { maxSlides: 0 } })).maxSlides, 0);
});

test('normalization rejects unsupported metrics/extensions and invalid numbers, including runtime-only input', () => {
  for (const limits of [null, [], false, 3, new Date(), { [Symbol('mp4')]: false },
    { '.ppt': { maxSlides: 1 } }, { '.pptm': false }, { '.tar.mp4': false }, { 'mp4': false },
    { '.mp4': { maxPages: 1 } }, { '.pdf': { maxSlides: 1 } }, { '.pptx': { maxDurationSeconds: 1 } },
    { '.mp3': { maxDurationSeconds: 1, extra: true } }, { '.mp4': true }, { '.mp4': null }, { '.mp4': [] },
    { '.mp4': { [Symbol('metric')]: 1 } }]) assert.throws(() => normalizeUploadContentLimits(limits));
  for (const value of [-1, NaN, Infinity, -Infinity, '1', true, null])
    assert.throws(() => normalizeUploadContentLimits({ '.mp4': { maxDurationSeconds: value } }));
  for (const value of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '1', null]) {
    assert.throws(() => normalizeUploadContentLimits({ '.pdf': { maxPages: value } }));
    assert.throws(() => normalizeUploadContentLimits({ '.pptx': { maxSlides: value } }));
  }
});

test('normalization is detached and detects conflicting normalized duplicate suffixes', () => {
  const source = { ' .MP4 ': { maxDurationSeconds: 7.5 }, '.mp4': { maxDurationSeconds: 7.5 } };
  const limits = normalizeUploadContentLimits(source);
  source[' .MP4 '].maxDurationSeconds = 100;
  assert.deepEqual(limits, { '.mp4': { maxDurationSeconds: 7.5 } });
  assert.ok(Object.isFrozen(limits)); assert.ok(Object.isFrozen(limits['.mp4']));
  for (const entry of [false, undefined, {}, { maxDurationSeconds: 8 }])
    assert.throws(() => normalizeUploadContentLimits({ '.mp4': { maxDurationSeconds: 7 }, ' .MP4 ': entry }), /重複/);
  assert.deepEqual(normalizeUploadContentLimits({ '.mp4': undefined, ' .MP4 ': {} }), {});
  assert.deepEqual(normalizeUploadContentLimits(Object.assign(Object.create(null), { '.mp4': false })), { '.mp4': false });
});

test('comparisons accept equality and report concrete duration/page/slide limits', () => {
  const cases = [
    ['clip.mp4', { maxDurationSeconds: 10.5 }, { kind: 'video', durationSeconds: 10.5 }, 'durationSeconds', 'duration-exceeded'],
    ['track.mp3', { maxDurationSeconds: 0 }, { kind: 'audio', durationSeconds: 0 }, 'durationSeconds', 'duration-exceeded'],
    ['doc.pdf', { maxPages: 5 }, { kind: 'pdf', pages: 5 }, 'pages', 'page-count-exceeded'],
    ['deck.pptx', { maxSlides: 2 }, { kind: 'presentation', slides: 2 }, 'slides', 'slide-count-exceeded'],
  ];
  for (const [name, limit, metadata, field, code] of cases) {
    const extension = name.slice(name.lastIndexOf('.'));
    const rule = getUploadContentRule(name, normalizeUploadContentLimits({ [extension]: limit }));
    assert.equal(compareUploadContentMetadata(rule, metadata), undefined);
    const rejection = compareUploadContentMetadata(rule, { ...metadata, [field]: metadata[field] + 1 });
    assert.equal(rejection.code, code); assert.equal(rejection[field], metadata[field] + 1);
    assert.equal(compareUploadContentMetadata(rule, undefined).code, 'content-inspection-failed');
  }
});

test('metadata kind mismatches and nonfinite/negative/fractional counts fail closed', () => {
  const rule = getUploadContentRule('clip.mp4');
  for (const metadata of [undefined, null, {}, [], { kind: 'audio', durationSeconds: 1 },
    { kind: 'video', durationSeconds: -1 }, { kind: 'video', durationSeconds: Infinity },
    { kind: 'video', durationSeconds: NaN }, { kind: 'video', durationSeconds: '1' }])
    assert.equal(compareUploadContentMetadata(rule, metadata).code, 'content-inspection-failed');
  for (const [name, limit, kind, field] of [['doc.pdf', { maxPages: 3 }, 'pdf', 'pages'],
    ['deck.pptx', { maxSlides: 3 }, 'presentation', 'slides']]) {
    const target = getUploadContentRule(name, normalizeUploadContentLimits({ [name.slice(name.lastIndexOf('.'))]: limit }));
    for (const value of [-1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])
      assert.equal(compareUploadContentMetadata(target, { kind, [field]: value }).code, 'content-inspection-failed');
  }
});

test('duration messages use hours and minutes without changing numerical metadata', () => {
  const reason = compareUploadContentMetadata(getUploadContentRule('clip.mp4'), { kind: 'video', durationSeconds: 15300 });
  assert.equal(reason.message, '再生時間4時間15分は上限4時間を超えています');
  assert.equal(reason.durationSeconds, 15300); assert.equal(reason.maxDurationSeconds, 14400);
  const shortRule = getUploadContentRule('clip.mp4', { '.mp4': { maxDurationSeconds: 0.5 } });
  assert.equal(compareUploadContentMetadata(shortRule, { kind: 'video', durationSeconds: 61.1 }).message,
    '再生時間1分1.1秒は上限0.5秒を超えています');
});

test('inspection caches detached immutable metadata and compares the latest threshold on every call', async () => {
  let calls = 0;
  const metadata = { kind: 'video', durationSeconds: 20 };
  const input = options({ inspectFile: async request => {
    calls++; assert.equal(request.file, input.file); assert.equal(request.extension, '.mp4');
    assert.equal(request.kind, 'video'); assert.equal(request.signal, input.signal); return metadata;
  } });
  assert.equal(readUploadContentInspection(input), undefined);
  assert.equal(await ensureUploadContentInspection(input), undefined);
  metadata.durationSeconds = 0;
  const outcome = readUploadContentInspection(input);
  assert.deepEqual(outcome, { status: 'completed', metadata: { kind: 'video', durationSeconds: 20 } });
  assert.ok(Object.isFrozen(outcome)); assert.ok(Object.isFrozen(outcome.metadata));
  assert.equal((await ensureUploadContentInspection({ ...input, rule: { ...input.rule, maxDurationSeconds: 10 } })).code, 'duration-exceeded');
  assert.equal(calls, 1);
});

test('inspection evidence is scoped to File identity, extension, context and both inspector identities', async () => {
  const inspectFile = async () => ({ kind: 'video', durationSeconds: 1 });
  const builtinInspector = async () => ({ kind: 'video', durationSeconds: 2 });
  const input = options({ inspectFile, builtinInspector });
  await ensureUploadContentInspection(input);
  for (const patch of [{ context: createExplorerUploadInspectionContext() }, { context: {} },
    { file: video() }, { inspectFile: async () => ({ kind: 'video', durationSeconds: 1 }) },
    { builtinInspector: async () => ({ kind: 'video', durationSeconds: 2 }) },
    { rule: getUploadContentRule('clip.webm') }])
    assert.equal(readUploadContentInspection({ ...input, ...patch }), undefined);
  await assert.rejects(ensureUploadContentInspection({ ...input, context: {} }), /createExplorerUploadInspectionContext/);
});

test('undefined custom results delegate to builtin but invalid custom metadata cannot bypass validation', async () => {
  let calls = 0;
  const builtinInspector = async () => { calls++; return { kind: 'video', durationSeconds: 1 }; };
  assert.equal(await ensureUploadContentInspection(options({ inspectFile: async () => undefined, builtinInspector })), undefined);
  assert.equal(calls, 1);
  assert.equal((await ensureUploadContentInspection(options({ inspectFile: async () => ({ kind: 'video', durationSeconds: Infinity }), builtinInspector }))).code, 'content-inspection-failed');
  assert.equal(calls, 1);
});

test('failed inspections are retained only for the same session and inspector identity', async () => {
  let calls = 0;
  const inspectFile = async () => { calls++; throw new Error('reader failed'); };
  const input = options({ inspectFile });
  assert.equal((await ensureUploadContentInspection(input)).code, 'content-inspection-failed');
  const failed = readUploadContentInspection(input);
  assert.equal(failed.status, 'failed'); assert.equal(failed.reason.code, 'content-inspection-failed');
  assert.ok(Object.isFrozen(failed)); assert.ok(Object.isFrozen(failed.reason));
  await ensureUploadContentInspection(input); assert.equal(calls, 1);
  await ensureUploadContentInspection({ ...input, context: createExplorerUploadInspectionContext() }); assert.equal(calls, 2);
});

test('reader errors preserve bounded useful explanations without mutable Errors or stack traces', async () => {
  for (const message of ['暗号化されたPDFには対応していません', 'ブラウザーがこの動画形式に対応していません', '内容の確認がタイムアウトしました']) {
    const error = new Error(message);
    error.stack = 'private stack with paths';
    const input = options({ inspectFile: async () => { throw error; } });
    const reason = await ensureUploadContentInspection(input);
    error.message = 'changed later';
    assert.equal(reason.message, `ファイルの内容を確認できないため、追加できません（${message}）`);
    assert.equal(readUploadContentInspection(input).reason.message, reason.message);
    assert.ok(!reason.message.includes('private stack'));
    assert.ok(Object.isFrozen(reason));
  }
  const long = await ensureUploadContentInspection(options({ inspectFile: async () => { throw new Error(`\n${'x'.repeat(600)}\u0000`); } }));
  assert.ok(long.message.endsWith(`${'x'.repeat(500)}）`));
  assert.ok(!/[\n\u0000]/.test(long.message));
  const nonError = await ensureUploadContentInspection(options({ inspectFile: async () => { throw { message: 'untrusted thrown object' }; } }));
  assert.equal(nonError.message, 'ファイルの内容を確認できないため、追加できません');
});

test('abort rejects immediately and late metadata never creates cached evidence', async () => {
  const controller = new AbortController();
  let resolve;
  const input = options({ signal: controller.signal, inspectFile: () => new Promise(done => { resolve = done; }) });
  const pending = ensureUploadContentInspection(input);
  controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  resolve({ kind: 'video', durationSeconds: 1 });
  await Promise.resolve(); await Promise.resolve();
  assert.equal(readUploadContentInspection(input), undefined);
  await assert.rejects(ensureUploadContentInspection(input), { name: 'AbortError' });
});

test('abort during metadata access cannot turn canceled work into successful evidence', async () => {
  const controller = new AbortController();
  const input = options({ signal: controller.signal, inspectFile: async () => ({ kind: 'video',
    get durationSeconds() { controller.abort(); return 1; },
  }) });
  await assert.rejects(ensureUploadContentInspection(input), { name: 'AbortError' });
  assert.equal(readUploadContentInspection(input), undefined);
});
