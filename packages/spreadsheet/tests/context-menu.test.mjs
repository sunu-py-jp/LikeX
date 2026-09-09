import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement, createRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const bundle = await build({ entryPoints: [new URL('../src/index.ts', import.meta.url).pathname],
  bundle: true, platform: 'node', format: 'esm', write: false, jsx: 'automatic',
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^react(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { default: Spreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
const initialWorkbook = { sheets: [{ id: 'main', name: 'Main', rowCount: 10, columnCount: 5,
  cells: { A1: { value: '1' }, A2: { value: '2' }, A3: { value: '3' } } }] };
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const command = (address, value) => ({ type: 'cells.set', sheetId: 'main', values: { [address]: value } });
const result = value => ({ change: [command('B3', value)] });

async function mount(t, overrides = {}) {
  let renderer;
  const ref = createRef(), events = [];
  const view = { addEventListener() {}, removeEventListener() {} };
  let props = { ref, initialWorkbook, onSave() {}, onEvent: event => events.push(event), ...overrides };
  await act(async () => { renderer = create(createElement(Spreadsheet, props), {
    createNodeMock: element => element.type === 'section' ? { ownerDocument: { defaultView: view } } : null,
  }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  return { ref, events, get root() { return renderer.root; },
    value(address) { return ref.current.getWorkbook().sheets[0].cells[address]?.value; },
    async update(patch) { props = { ...props, ...patch }; await act(async () => renderer.update(createElement(Spreadsheet, props))); },
    async open(row = 2, column = 1) {
      let prevented = false;
      const cell = { dataset: { lxsRow: String(row), lxsColumn: String(column) }, closest: selector => selector.startsWith('[data-lxs-row]') ? cell : null };
      await act(async () => renderer.root.findByType('section').props.onContextMenu({ target: cell, clientX: 100, clientY: 100, preventDefault() { prevented = true; } }));
      return prevented;
    },
    async run() { await this.open(); await act(async () => renderer.root.findByProps({ role: 'menuitem' }).props.onClick()); },
    async confirm() { await act(async () => renderer.root.findByProps({ className: 'lxs-dialog-confirm' }).props.onClick()); },
    async cancel() { const controller = renderer.root.findAll(node => node.props.controller?.state?.phase && node.props.controller?.cancel)[0].props.controller;
      await act(async () => controller.cancel()); },
    async selectRange() {
      const cell = renderer.root.findByProps({ 'data-lxs-row': 2, 'data-lxs-column': 0 });
      await act(async () => cell.props.onPointerDown({ button: 0, pointerId: 1, shiftKey: true, preventDefault() {},
        currentTarget: { ownerDocument: { activeElement: null }, closest() { return null; } } }));
    },
  };
}

test('block preserves selected ranges and applies a prepared result at the independent right-click target in one undo step', async t => {
  const pending = deferred(); let captured, operation;
  const ui = await mount(t, { onRefresh: () => initialWorkbook, getContextMenuItems: context => {
    captured = context;
    return [{ id: 'sum', label: '合計を挿入', onSelect(_context, request) { operation = request; return pending.promise; } }];
  } });
  await ui.selectRange();
  await ui.run();
  assert.equal(captured.target.address, 'B3');
  assert.deepEqual(captured.selection.ranges[0], { anchor: { row: 0, column: 0 }, focus: { row: 2, column: 0 } });
  let attempted;
  await act(async () => { attempted = ui.ref.current.execute(command('C1', 'forbidden')); });
  assert.equal(attempted.code, 'BUSY');
  assert.equal(await ui.ref.current.save(), false);
  assert.equal(await ui.ref.current.refresh({ discardChanges: true }), false);
  assert.equal(ui.ref.current.discard({ discardChanges: true }), false);
  assert.equal(ui.root.findByProps({ 'aria-label': 'A3の値' }).props.readOnly, true);
  await act(async () => pending.resolve(result('=SUM(A1:A3)')));
  assert.equal(ui.value('B3'), '=SUM(A1:A3)');
  assert.equal(operation.signal.aborted, true);
  assert.ok(ui.events.some(event => event.type === 'context-menu' && event.status === 'success'));
  const undo = ui.root.findAll(node => node.props.controller?.undo)[0].props.controller.undo;
  await act(async () => undo());
  assert.equal(ui.value('B3'), undefined);
  assert.equal(ui.value('A1'), '1');
});

test('confirm permits edits, always asks before applying, and isolates the proposed command payload', async t => {
  const pending = deferred();
  const ui = await mount(t, { contextMenuExecutionMode: 'confirm', getContextMenuItems: () => [
    { id: 'sum', label: '合計を挿入', onSelect: () => pending.promise },
  ] });
  await ui.run();
  await act(async () => ui.ref.current.execute(command('C1', 'allowed')));
  assert.equal(ui.value('C1'), 'allowed');
  const proposed = result('=SUM(A1:A3)');
  await act(async () => pending.resolve(proposed));
  assert.equal(ui.value('B3'), undefined);
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 1);
  proposed.change[0].values.B3 = 'mutated by host';
  await ui.confirm();
  assert.equal(ui.value('B3'), '=SUM(A1:A3)');
  assert.equal(ui.value('C1'), 'allowed');
});

test('reject-if-changed leaves a concurrent edit intact and never publishes the prepared result', async t => {
  const pending = deferred();
  const ui = await mount(t, { contextMenuExecutionMode: 'reject-if-changed', getContextMenuItems: () => [
    { id: 'sum', label: '合計を挿入', onSelect: () => pending.promise },
  ] });
  await ui.run();
  await act(async () => ui.ref.current.execute(command('A1', '99')));
  await act(async () => pending.resolve(result('=SUM(A1:A3)')));
  assert.equal(ui.value('A1'), '99');
  assert.equal(ui.value('B3'), undefined);
  assert.ok(ui.events.some(event => event.type === 'context-menu' && event.status === 'error'));
});

test('confirm rejects shifted coordinates even when insert/delete restores the original sheet dimensions', async t => {
  const pending = deferred();
  const ui = await mount(t, { contextMenuExecutionMode: 'confirm', getContextMenuItems: () => [
    { id: 'sum', label: '合計を挿入', onSelect: () => pending.promise },
  ] });
  await ui.run();
  await act(async () => ui.ref.current.execute({ type: 'rows.insert', sheetId: 'main', index: 0 }));
  await act(async () => ui.ref.current.execute({ type: 'rows.delete', sheetId: 'main', index: 0 }));
  await act(async () => pending.resolve(result('wrong location')));
  assert.equal(ui.value('B3'), undefined);
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 0);
  assert.ok(ui.events.some(event => event.type === 'context-menu' && event.status === 'error'));
});

test('cancellation unblocks immediately and ignores a late handler that does not honor the signal', async t => {
  const pending = deferred(); let signal;
  const ui = await mount(t, { getContextMenuItems: () => [
    { id: 'sum', label: '合計を挿入', onSelect(_context, operation) { signal = operation.signal; return pending.promise; } },
  ] });
  await ui.run();
  await ui.cancel();
  assert.equal(signal.aborted, true);
  await act(async () => ui.ref.current.execute(command('C1', 'after cancel')));
  await act(async () => pending.resolve(result('late')));
  assert.equal(ui.value('B3'), undefined);
  assert.equal(ui.value('C1'), 'after cancel');
});

test('result application waits for the edit lease and cancelling also releases the pending lease', async t => {
  const permission = deferred(); let request;
  const ui = await mount(t, { onEditRequest(_intent, context) { request = context; return permission.promise; },
    getContextMenuItems: () => [{ id: 'sum', label: '合計を挿入', onSelect: () => result('=SUM(A1:A3)') }] });
  await ui.run();
  assert.ok(request);
  assert.equal(ui.value('B3'), undefined);
  await ui.cancel();
  assert.equal(request.signal.aborted, true);
  await act(async () => permission.resolve(true));
  assert.equal(ui.value('B3'), undefined);
  assert.equal(ui.ref.current.getEditState().mode, 'view');
});

test('a fresh permission baseline invalidates a previously captured target before committing', async t => {
  const ui = await mount(t, { onEditRequest: () => ({ allowed: true, workbook: { sheets: [{ ...initialWorkbook.sheets[0], rowCount: 11 }] } }),
    getContextMenuItems: () => [{ id: 'sum', label: '合計を挿入', onSelect: () => result('=SUM(A1:A3)') }] });
  await ui.run();
  assert.equal(ui.ref.current.getWorkbook().sheets[0].rowCount, 11);
  assert.equal(ui.value('B3'), undefined);
  assert.ok(ui.events.some(event => event.type === 'context-menu' && event.status === 'error'));
});

test('feature changes are enforced at result application; unfinished cell editing keeps its native menu', async t => {
  const pending = deferred(); let calls = 0;
  const ui = await mount(t, { getContextMenuItems: () => { calls++; return [
    { id: 'sum', label: '合計を挿入', onSelect: () => pending.promise },
  ]; } });
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onChange({ target: { value: 'pending' } }));
  assert.equal(await ui.open(), false);
  assert.equal(calls, 0);
  await act(async () => ui.root.findByProps({ 'aria-label': 'A1の値' }).props.onKeyDown({ key: 'Escape', nativeEvent: {}, preventDefault() {} }));
  await ui.run();
  await ui.update({ features: { formulas: false } });
  await act(async () => pending.resolve(result('=SUM(A1:A3)')));
  assert.equal(ui.value('B3'), undefined);
  assert.ok(ui.events.some(event => event.type === 'context-menu' && event.status === 'error'));
});
