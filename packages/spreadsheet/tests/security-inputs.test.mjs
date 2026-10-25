import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { build } from 'esbuild';

const bundle = await build({ stdin: { contents: `export * from './src/model-entry';
export * from './src/model/editing/search';
export * from './src/state/clipboard/browser-clipboard';`,
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'security-inputs.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`;
const m = await import(moduleUrl);
const workbook = cells => ({ sheets: [{ id: 's', name: 'Sheet1', rowCount: 3, columnCount: 2, cells }] });

// A separate worker makes the time budget enforceable even if a synchronous
// regular expression blocks its thread. Startup has ample slack; each corrected
// workload completes in milliseconds, while the previous path took >10 seconds.
async function boundedCalculation(source) {
  const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
    import(workerData.moduleUrl).then(async m => { ${source} }).then(result => parentPort.postMessage(result));`,
  { eval: true, workerData: { moduleUrl }, execArgv: [] });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('Input processing exceeded the five-second security budget')), 5000);
      worker.once('message', resolve); worker.once('error', reject);
      worker.once('exit', code => { if (code) reject(new Error(`Security worker exited with ${code}`)); });
    });
  } finally { clearTimeout(timer); await worker.terminate(); }
}

test('TRIM handles maximum-length interior spaces without backtracking outside the formula budget', async () => {
  const result = await boundedCalculation(`
    const workbook = m.normalizeWorkbook({sheets:[{id:'s',name:'Sheet1',rowCount:2,columnCount:1,
      cells:{A1:{value:'x'+' '.repeat(m.SPREADSHEET_LIMITS.cellLength-2)+'x'},A2:{value:'=TRIM(A1)'}}}]});
    return m.calculateWorkbook(workbook).s.A2;
  `);
  assert.equal(result, 'x x');
  const wb = m.normalizeWorkbook(workbook({ A1: { value: '=TRIM("  a  b  ")' }, A2: { value: '=TRIM("  ")' }, B1: { value: '=TRIM(" \t a \u00a0 ")' } }));
  assert.deepEqual({ ...m.calculateWorkbook(wb).s }, { A1: 'a b', A2: '', B1: '\t a \u00a0' });
});

test('autofill handles a maximum-length digit run with a nonnumeric suffix in bounded time', async () => {
  const result = await boundedCalculation(`
    const value='x'+'1'.repeat(m.SPREADSHEET_LIMITS.cellLength-2)+'x';
    const session=m.createSpreadsheetSession({sheets:[{id:'s',name:'Sheet1',rowCount:2,columnCount:1,cells:{A1:{value}}}]});
    const result=session.execute({type:'cells.fill',sheetId:'s',source:{top:0,left:0,bottom:0,right:0},target:{top:0,left:0,bottom:1,right:0}});
    return {ok:result.ok,same:session.getWorkbook().sheets[0].cells.A2.value===value};
  `);
  assert.deepEqual(result, { ok: true, same: true });
});

for (const [label, expected] of [['Item001', 'Item002'], ['Item-2', 'Item-1'], ['Item--2', 'Item--1'], ['Item 09', 'Item 10'], ['a\nb1', 'a\nb1']]) {
  test(`autofill preserves label semantics for ${JSON.stringify(label)}`, () => {
    const session = m.createSpreadsheetSession(workbook({ A1: { value: label } }));
    assert.equal(session.execute({ type: 'cells.fill', sheetId: 's', source: { top: 0, left: 0, bottom: 0, right: 0 },
      target: { top: 0, left: 0, bottom: 1, right: 0 } }).ok, true);
    assert.equal(session.getWorkbook().sheets[0].cells.A2.value, expected);
  });
}

test('replacement expansion is rejected before producing an oversized cell, and rolls back its batch', () => {
  for (const useRegex of [false, true]) {
    assert.throws(() => m.replaceSpreadsheetText('a'.repeat(1000), { text: 'a', useRegex }, 'x'.repeat(1000)), /上限/);
    const session = m.createSpreadsheetSession(workbook({ A1: { value: 'a'.repeat(1000) } })), before = session.getWorkbook();
    const result = session.batch([{ type: 'cells.set', sheetId: 's', values: { B1: 'rollback' } },
      { type: 'cells.replace', sheetId: 's', query: { text: 'a', useRegex, lookIn: 'formulas' }, replacement: 'x'.repeat(1000) }]);
    assert.equal(result.ok, false); assert.match(result.message, /上限/);
    assert.equal(session.getWorkbook(), before); assert.equal(session.undo(), false);
  }
  assert.equal(m.replaceSpreadsheetText('a', { text: 'a' }, 'x'.repeat(m.SPREADSHEET_LIMITS.cellLength)).length, m.SPREADSHEET_LIMITS.cellLength);
});

function clipboard(t, value) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { clipboard: value } });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'navigator', original); else delete globalThis.navigator; });
}

test('oversized clipboard text Blob is rejected before decoding its bytes', async t => {
  let decoded = false;
  clipboard(t, { readText: async () => '', read: async () => [{ types: ['text/plain'], getType: async () => ({
    size: m.SPREADSHEET_LIMITS.clipboardCharacters * 3 + 1, text: async () => { decoded = true; return ''; },
  }) }] });
  await assert.rejects(m.readBrowserClipboard(), /10 Mi文字/);
  assert.equal(decoded, false);
});

test('clipboard HTML reads only a bounded transport header and preserves plain text', async t => {
  let sliced;
  clipboard(t, { readText: async () => '', read: async () => [{ types: ['text/plain', 'text/html'], getType: async type => type === 'text/plain' ? new Blob(['value']) : {
    text: async () => { throw new Error('Full HTML must not be decoded'); },
    slice(start, end) { sliced = [start, end]; return new Blob(['<table data-likex-spreadsheet="abc-123">']); },
  } }] });
  assert.deepEqual(await m.readBrowserClipboard(), { text: 'value', token: 'abc-123', hasText: true });
  assert.deepEqual(sliced, [0, 64 * 1024]);
  assert.equal(m.clipboardTokenFromHtml(' '.repeat(64 * 1024) + '<table data-likex-spreadsheet="abc-123">'), '');
  assert.equal(m.clipboardTokenFromHtml(`<table data-likex-spreadsheet="${'x'.repeat(201)}">`), '');
});

test('clipboard character limits apply to the Blob and readText-only browser paths', async t => {
  const oversized = 'x'.repeat(m.SPREADSHEET_LIMITS.clipboardCharacters + 1);
  clipboard(t, { readText: async () => oversized });
  await assert.rejects(m.readBrowserClipboard(), /10 Mi文字/);
  navigator.clipboard.read = async () => [{ types: ['text/plain'], getType: async () => new Blob([oversized]) }];
  await assert.rejects(m.readBrowserClipboard(), /10 Mi文字/);
});
