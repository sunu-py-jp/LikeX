import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ stdin: { contents: 'export { default as Spreadsheet } from "./src/spreadsheet";',
  resolveDir: new URL('../', import.meta.url).pathname, sourcefile: 'merged-clipboard-grid.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) { builder.onResolve({ filter: /^react(?:-dom)?(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true })); } }],
});
const { Spreadsheet } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const sourceMerge = { top: 1, left: 1, bottom: 2, right: 2 };
const targetMerge = { top: 1, left: 4, bottom: 2, right: 5 };
const pointerEvent = target => ({ button: 0, buttons: 1, pointerId: 1, shiftKey: false, ctrlKey: false, metaKey: false, altKey: false,
  nativeEvent: {}, currentTarget: target, preventDefault() {}, stopPropagation() {} });
const clipboardEvent = (target, values = {}) => {
  const data = new Map(Object.entries(values));
  return { target, preventDefault() {}, clipboardData: {
    getData: type => data.get(type) ?? '', setData: (type, value) => data.set(type, value), get types() { return [...data.keys()]; },
  } };
};
async function mount(t, targetMerged = false, props = {}) {
  let renderer, input;
  const listeners = new Map(), nodes = new WeakMap();
  const doc = { activeElement: null, addEventListener: (name, callback) => listeners.set(name, callback), removeEventListener: name => listeners.delete(name),
    defaultView: { addEventListener() {}, removeEventListener() {} } };
  const node = element => {
    if (nodes.has(element.props)) return nodes.get(element.props);
    const result = { ownerDocument: doc, addEventListener() {}, removeEventListener() {}, style: {}, scrollHeight: 18, scrollTop: 0, scrollLeft: 0, clientHeight: 480, clientWidth: 1000,
      classList: { contains: name => name === element.props.className },
      focus() { doc.activeElement = this; }, select() {}, setSelectionRange() {}, contains: target => target?.ownerDocument === doc,
      closest: selector => selector.startsWith('input,') ? (element.type === 'textarea' ? result : null) : null,
      querySelector: selector => selector === '.lxs-cell-input' ? input : null, querySelectorAll: () => [],
    };
    if (element.props.className === 'lxs-cell-input') input = result;
    nodes.set(element.props, result); return result;
  };
  await act(async () => { renderer = create(createElement(Spreadsheet, { onSave() {}, ...props, initialWorkbook: { sheets: [{
    id: 'one', name: 'One', rowCount: 12, columnCount: 10,
    cells: { B2: { value: 'Merged value', format: { bold: true, backgroundColor: '#ffeecc' } }, E2: { value: 'old' } },
    comments: { B2: { id: 'source-comment', text: 'Copied comment' } },
    merges: targetMerged ? [sourceMerge, targetMerge] : [sourceMerge],
  }] } }), { createNodeMock: node }); });
  t.after(async () => { await act(async () => renderer.unmount()); });
  const controller = () => renderer.root.findAll(item => item.props.controller?.selectRangeInSheet)[0].props.controller;
  const root = () => renderer.root.findByType('section');
  const cell = address => renderer.root.findAllByProps({ role: 'gridcell' }).find(item => item.props['aria-label'].split(' ')[0] === address);
  const inputElement = () => renderer.root.findAllByType('textarea').find(item => item.props.className === 'lxs-cell-input');
  return { get c() { return controller(); }, cell,
    assertInputFocused() { assert.equal(doc.activeElement, input, 'the replacement cell input must retain focus'); },
    focusOutside() { const outside = { ownerDocument: doc }; doc.activeElement = outside; return () => assert.equal(doc.activeElement, outside); },
    async click(address) {
      await act(async () => cell(address).props.onPointerDown(pointerEvent(input)));
      await act(async () => listeners.get('pointerup')?.({ pointerId: 1, buttons: 0 }));
    },
    async copy() {
      const event = clipboardEvent(input);
      await act(async () => inputElement().props.onKeyDown({ ...pointerEvent(input), key: 'c', ctrlKey: true }));
      await act(async () => root().props.onCopy(event)); return event;
    },
    async paste(copied, transform = text => text, htmlOnly = false) {
      const event = clipboardEvent(input, { 'text/plain': transform(copied.clipboardData.getData('text/plain')),
        'text/html': copied.clipboardData.getData('text/html'),
        ...(htmlOnly ? {} : { 'application/x-likex-spreadsheet': copied.clipboardData.getData('application/x-likex-spreadsheet') }) });
      await act(async () => inputElement().props.onKeyDown({ ...pointerEvent(input), key: 'v', ctrlKey: true }));
      await act(async () => root().props.onPaste(event));
    },
  };
}

for (const targetMerged of [false, true]) test(`native copy/paste preserves a clicked merge into ${targetMerged ? 'an existing merged cell' : 'a normal cell'}`, async t => {
  const ui = await mount(t, targetMerged);
  await ui.click('B2'); const copied = await ui.copy();
  assert.equal(ui.c.error, null);
  await ui.click('E2'); await ui.paste(copied);
  assert.equal(ui.c.error, null);
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge, targetMerge]);
  assert.equal(ui.c.activeSheet.cells.E2.value, 'Merged value');
  assert.deepEqual(ui.c.activeSheet.cells.E2.format, ui.c.activeSheet.cells.B2.format);
  assert.equal(ui.c.activeSheet.comments.E2.text, 'Copied comment');
  assert.notEqual(ui.c.activeSheet.comments.E2.id, 'source-comment');
  assert.equal(ui.cell('E2').props['aria-colspan'], 2);
  assert.equal(ui.cell('F3'), undefined);
  assert.deepEqual(ui.c.selection.focus, { row: 1, column: 4 });
  ui.assertInputFocused();
});

for (const targetMerged of [false, true]) test(`native clipboard line-ending normalization retains merge metadata for ${targetMerged ? 'merged' : 'normal'} destinations`, async t => {
  const ui = await mount(t, targetMerged);
  await ui.click('B2'); const copied = await ui.copy();
  assert.ok(copied.clipboardData.getData('text/plain').includes('\r\n'));
  await ui.click('E2'); await ui.paste(copied, text => text.replaceAll('\r\n', '\n'), true);
  assert.equal(ui.c.error, null);
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge, targetMerge]);
  assert.equal(ui.c.activeSheet.cells.E2.value, 'Merged value');
  assert.equal(ui.c.activeSheet.cells.E2.format.bold, true);
  ui.assertInputFocused();
});

test('a valid clipboard token cannot restore an old merge when the clipboard content changed', async t => {
  const ui = await mount(t);
  await ui.click('B2'); const copied = await ui.copy();
  await ui.click('E2'); await ui.paste(copied, text => text.replace('Merged value', 'Different content'), true);
  assert.equal(ui.c.error, null);
  assert.equal(ui.c.activeSheet.cells.E2.value, 'Different content');
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge]);
  assert.equal(ui.c.activeSheet.comments.E2, undefined);
});

for (const moveFocusOutside of [false, true]) test(`an asynchronously allowed merged paste ${moveFocusOutside ? 'does not steal external focus' : 'restores the replaced input focus'}`, async t => {
  let allow;
  const permission = new Promise(resolve => { allow = resolve; });
  const ui = await mount(t, false, { onEditRequest: () => permission });
  await ui.click('B2'); const copied = await ui.copy();
  await ui.click('E2'); ui.assertInputFocused();
  await ui.paste(copied);
  assert.equal(ui.c.requesting, true);
  const assertOutside = moveFocusOutside ? ui.focusOutside() : null;
  await act(async () => allow(true));
  assert.equal(ui.c.error, null);
  assert.deepEqual(ui.c.activeSheet.merges, [sourceMerge, targetMerge]);
  if (assertOutside) assertOutside(); else ui.assertInputFocused();
});
