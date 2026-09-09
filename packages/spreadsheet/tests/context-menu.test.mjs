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
const multipleSheets = { sheets: [...initialWorkbook.sheets, { id: 'other', name: 'Other', rowCount: 10, columnCount: 5, cells: {} }] };
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
    async openSheet(sheetId = 'other', keyboard = false) {
      let prevented = false, stopped = false;
      const tab = { dataset: { lxsSheetId: sheetId }, closest: selector => selector === '[data-lxs-sheet-id]' ? tab : null,
        getBoundingClientRect: () => ({ left: 40, bottom: 100, width: 80 }) };
      const event = { target: tab, button: 2, clientX: 100, clientY: 100, key: 'F10', shiftKey: true, nativeEvent: {},
        preventDefault() { prevented = true; }, stopPropagation() { stopped = true; } };
      await act(async () => {
        const section = renderer.root.findByType('section');
        section.props.onPointerDownCapture(event);
        assert.equal(prevented, true, 'right mouse down preserves focus and selection');
        prevented = false;
        section.props[keyboard ? 'onKeyDownCapture' : 'onContextMenu'](event);
      });
      assert.equal(prevented, true);
      if (keyboard) assert.equal(stopped, true);
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

test('sheet tabs offer only delete without a provider and delete the right-clicked inactive sheet through the undoable command pipeline', async t => {
  const ui = await mount(t, { initialWorkbook: multipleSheets });
  await ui.selectRange();
  assert.equal(await ui.open(), false, 'cells keep their native menu without a provider');
  assert.equal(ui.root.findAllByType('select').some(select => select.props['aria-label'] === 'シートの操作'), false);
  await ui.openSheet();
  const menu = ui.root.findByProps({ role: 'menu' });
  assert.equal(menu.props['aria-label'], 'シートの操作');
  const item = ui.root.findByProps({ role: 'menuitem' });
  assert.deepEqual(item.children, ['削除']);
  assert.equal(item.props.disabled, false);
  assert.equal(ui.root.findByProps({ role: 'grid' }).props['aria-label'], 'Main');
  const selection = ui.root.findAll(node => node.props.controller?.selection)[0].props.controller.selection;
  assert.deepEqual(selection.ranges[0], { anchor: { row: 0, column: 0 }, focus: { row: 2, column: 0 } });
  await act(async () => item.props.onClick());
  assert.deepEqual(ui.ref.current.getWorkbook().sheets.map(sheet => sheet.id), ['main']);
  assert.equal(ui.root.findByProps({ role: 'grid' }).props['aria-label'], 'Main');
  const undo = ui.root.findAll(node => node.props.controller?.undo)[0].props.controller.undo;
  await act(async () => undo());
  assert.deepEqual(ui.ref.current.getWorkbook().sheets.map(sheet => sheet.id), ['main', 'other']);
});

test('sheet custom entries precede delete and capture the clicked tab independently of active cell selection', async t => {
  let captured;
  const ui = await mount(t, { initialWorkbook: multipleSheets, getContextMenuItems: context => {
    captured = context;
    return context.target.kind === 'sheet' ? [{ id: 'sheet-inspect', label: 'シートを確認', onSelect() {} }] : [];
  } });
  await ui.selectRange();
  await ui.openSheet('other', true);
  assert.deepEqual(captured.target, { kind: 'sheet', sheetId: 'other', name: 'Other', index: 1 });
  assert.equal(captured.selection.sheetId, 'main');
  assert.deepEqual(captured.selection.ranges[0], { anchor: { row: 0, column: 0 }, focus: { row: 2, column: 0 } });
  const items = ui.root.findAllByProps({ role: 'menuitem' });
  assert.deepEqual(items[0].findByType('span').children, ['シートを確認']);
  assert.deepEqual(items[1].children, ['削除']);
  assert.equal(ui.root.findByProps({ className: 'lxs-context-menu-separator' }).props.role, 'separator');
  await act(async () => items[0].props.onClick());
  assert.ok(ui.events.some(event => event.type === 'context-menu' && event.status === 'success'));
});

test('sheet delete is disabled for the last sheet and hidden for readonly or a disabled feature', async t => {
  const ui = await mount(t);
  await ui.openSheet('main');
  assert.equal(ui.root.findByProps({ role: 'menuitem' }).props.disabled, true);
  await ui.update({ features: { deleteSheet: false } });
  await ui.openSheet('main');
  assert.equal(ui.root.findAllByProps({ role: 'menuitem' }).length, 0);
  await ui.update({ features: {}, onSave: undefined, getContextMenuItems: () => [{ id: 'view', label: '表示', onSelect() {} }] });
  await ui.openSheet('main');
  assert.equal(ui.root.findAllByProps({ role: 'menuitem' }).length, 1);
  assert.deepEqual(ui.root.findByProps({ role: 'menuitem' }).findByType('span').children, ['表示']);
});

test('sheet deletion requests editing permission for the clicked sheet and preserves it after denial', async t => {
  let request;
  const ui = await mount(t, { initialWorkbook: multipleSheets, contextMenuExecutionMode: 'confirm',
    onEditRequest: intent => { request = intent; return false; } });
  await ui.openSheet();
  await act(async () => ui.root.findByProps({ role: 'menuitem' }).props.onClick());
  assert.equal(request.action, 'sheets.delete');
  assert.equal(request.sheetId, 'other');
  assert.deepEqual(ui.ref.current.getWorkbook().sheets.map(sheet => sheet.id), ['main', 'other']);
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 0, 'custom confirmation mode does not change the built-in action');
});

test('confirmed sheet results follow the captured ID after reordering and reject a removed sheet', async t => {
  const pending = deferred();
  const ui = await mount(t, { initialWorkbook: multipleSheets, contextMenuExecutionMode: 'confirm', getContextMenuItems: () => [
    { id: 'rename', label: '名前を生成', onSelect: () => pending.promise },
  ] });
  await ui.openSheet();
  await act(async () => ui.root.findAllByProps({ role: 'menuitem' })[0].props.onClick());
  await act(async () => ui.ref.current.execute({ type: 'sheets.move', sheetId: 'other', index: 0 }));
  await act(async () => pending.resolve({ change: [{ type: 'sheets.rename', sheetId: 'other', name: 'Generated' }] }));
  await ui.confirm();
  assert.deepEqual(ui.ref.current.getWorkbook().sheets.map(sheet => [sheet.id, sheet.name]), [['other', 'Generated'], ['main', 'Main']]);

  const removed = deferred();
  await ui.update({ getContextMenuItems: () => [{ id: 'rename', label: '名前を生成', onSelect: () => removed.promise }] });
  await ui.openSheet();
  await act(async () => ui.root.findAllByProps({ role: 'menuitem' })[0].props.onClick());
  await act(async () => ui.ref.current.execute({ type: 'sheets.delete', sheetId: 'other' }));
  await act(async () => removed.resolve({ change: [{ type: 'sheets.rename', sheetId: 'other', name: 'Late' }] }));
  assert.deepEqual(ui.ref.current.getWorkbook().sheets.map(sheet => sheet.id), ['main']);
  assert.equal(ui.root.findAllByProps({ role: 'alertdialog' }).length, 0);
  assert.ok(ui.events.some(event => event.type === 'context-menu' && event.status === 'error'));
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
