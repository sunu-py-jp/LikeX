import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: 'export { createWorkbookHistory } from "./src/history/workbook-history";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'workbook-history.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false });
const { createWorkbookHistory } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const workbook = value => ({ sheets: [{ id: 'sheet', name: 'Sheet', rowCount: 10, columnCount: 10, cells: { A1: { value } } }] });

test('each history operation retains its own opaque metadata through repeated Undo and Redo', () => {
  const history = createWorkbookHistory(2), books = ['0', '1', '2', '3'].map(workbook);
  const contexts = [{ id: 'first' }, { id: 'second' }, { id: 'third' }];
  contexts.forEach((context, index) => history.record(books[index], true, context));
  assert.equal(history.getState().undoCount, 2);
  for (let round = 0; round < 3; round++) {
    assert.equal(history.peekMetadata('past'), contexts[2]);
    assert.equal(history.step('past', books[3]), books[2]);
    assert.equal(history.peekMetadata('future'), contexts[2]);
    assert.equal(history.peekMetadata('past'), contexts[1]);
    assert.equal(history.step('past', books[2]), books[1]);
    assert.equal(history.peekMetadata('past'), undefined);
    assert.equal(history.step('past', books[1]), undefined);
    assert.equal(history.peekMetadata('future'), contexts[1]);
    assert.equal(history.step('future', books[1]), books[2]);
    assert.equal(history.step('future', books[2]), books[3]);
    assert.equal(history.peekMetadata('future'), undefined);
  }
  assert.equal(JSON.stringify(books).includes('metadata'), false);
});

test('branch changes, disabled history, clear and a zero limit discard matching metadata with their snapshots', () => {
  const history = createWorkbookHistory(), first = workbook('one'), second = workbook('two');
  history.record(first, true, 'old');
  history.step('past', second);
  history.record(first, true, 'new branch');
  assert.equal(history.peekMetadata('future'), undefined);
  assert.equal(history.peekMetadata('past'), 'new branch');
  history.record(second, false, 'disabled');
  assert.equal(history.peekMetadata('past'), undefined);
  assert.equal(history.peekMetadata('future'), undefined);
  history.record(first, true, 'clear me'); history.clear();
  assert.equal(history.peekMetadata('past'), undefined);
  const disabled = createWorkbookHistory(0);
  disabled.record(first, true, 'unused');
  assert.equal(disabled.peek('past'), undefined); assert.equal(disabled.peekMetadata('past'), undefined);
});

test('headless history works unchanged without any selection metadata', () => {
  const history = createWorkbookHistory(), first = workbook('before'), next = workbook('after');
  history.record(first);
  assert.equal(history.peek('past'), first); assert.equal(history.peekMetadata('past'), undefined);
  assert.equal(history.step('past', next), first);
  assert.equal(history.step('future', first), next);
  assert.equal(history.peekMetadata('past'), undefined);
});
