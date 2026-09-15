import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export * from './src/state/import-progress.ts';
  export { prepareFilesWithProgress, createDraftSnapshot, addFilesWithResult } from './src/model/draft.ts';
`, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false });
const { describeImportProgress, createImportProgress, prepareImport, prepareFilesWithProgress, createDraftSnapshot } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('unknown directory totals stay indeterminate and known counts describe local work', () => {
  const discovering = describeImportProgress({ phase: 'discovering', completed: 35 });
  assert.equal(discovering.kind, 'progress');
  assert.equal(discovering.progress, undefined);
  assert.equal(discovering.description, '35ファイルを検出');
  const preparing = describeImportProgress({ phase: 'preparing', completed: 35, total: 100 });
  assert.equal(preparing.progress, 35);
  assert.equal(preparing.description, '35 / 100ファイル');
  assert.equal(describeImportProgress({ phase: 'discovering', completed: 0, total: 0 }).progress, undefined);
});

test('large preparation yields to other tasks, throttles updates and keeps the candidate private', async () => {
  const snapshot = createDraftSnapshot([]), progress = [];
  const files = Array.from({ length: 1000 }, (_, i) => new File(['body'], `${i}.txt`));
  let otherTaskRan = false;
  const pending = prepareImport(prepareFilesWithProgress(snapshot, files, 'root'), new AbortController().signal,
    value => { progress.push(value); assert.equal(snapshot.entries.length, 0); });
  assert.deepEqual(progress[0], { phase: 'checking', completed: 0, total: 1000 });
  setTimeout(() => { otherTaskRan = true; }, 0);
  const result = await pending;
  assert.equal(otherTaskRan, true);
  assert.equal(result.snapshot.entries.length, 1000);
  assert.equal(snapshot.entries.length, 0);
  assert.ok(progress.some(value => value.phase === 'preparing' && value.total === 1000));
  assert.deepEqual(progress.at(-1), { phase: 'preparing', completed: 1000, total: 1000 });
  assert.ok(progress.length < 40, 'progress updates must not mirror every file');
});

test('task-boundary cancellation stops preparation before completion and suppresses pending updates', async () => {
  const controller = new AbortController(), progress = [];
  let visited = 0;
  function* operation() {
    for (; visited < 1000; visited++) yield { phase: 'checking', completed: visited, total: 1000 };
    throw Error('A cancelled generator must never complete');
  }
  const pending = prepareImport(operation(), controller.signal, value => progress.push(value));
  const rejected = assert.rejects(pending, error => error.name === 'AbortError');
  setTimeout(() => controller.abort(), 0);
  await rejected;
  assert.ok(visited < 1000);
  const finalCount = progress.length;
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(progress.length, finalCount);
});

test('a throttled discovery count is published even while the next native callback is waiting', async () => {
  const updates = [], controller = new AbortController();
  const checkpoint = createImportProgress(value => updates.push(value), controller.signal);
  checkpoint({ phase: 'discovering', completed: 0 });
  checkpoint({ phase: 'discovering', completed: 37 });
  assert.equal(updates.length, 1);
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.deepEqual(updates.at(-1), { phase: 'discovering', completed: 37 });
  await checkpoint({ phase: 'discovering', completed: 38 });
  controller.abort();
  await new Promise(resolve => setTimeout(resolve, 90));
  assert.equal(updates.at(-1).completed, 37);
  checkpoint.dispose();
});

test('background timer delays do not consume the next processing slice', async t => {
  let now = 0;
  t.mock.method(performance, 'now', () => now);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const checkpoint = createImportProgress();
  t.after(() => checkpoint.dispose());
  const progress = completed => ({ phase: 'checking', completed, total: 1000 });
  for (let index = 1; index < 200; index++) assert.equal(checkpoint(progress(index)), undefined);
  const firstPause = checkpoint(progress(200));
  assert.ok(firstPause instanceof Promise, '200 steps yield even when the CPU clock has not advanced');

  // Hidden tabs can leave a zero-delay task suspended for seconds. That idle
  // interval must not force one more timer after every subsequently read file.
  now = 30000;
  t.mock.timers.tick(30000);
  await firstPause;
  for (let index = 201; index < 400; index++) {
    assert.equal(checkpoint(progress(index)), undefined, `file ${index} belongs to the resumed CPU slice`);
  }
  const secondPause = checkpoint(progress(400));
  assert.ok(secondPause instanceof Promise);
  now = 60000;
  t.mock.timers.tick(30000);
  await secondPause;

  now += 11;
  assert.equal(checkpoint(progress(401)), undefined);
  now += 1;
  const cpuPause = checkpoint(progress(402));
  assert.ok(cpuPause instanceof Promise, '12 ms of actual resumed work still yields before 200 steps');
  t.mock.timers.tick(0);
  await cpuPause;
});
