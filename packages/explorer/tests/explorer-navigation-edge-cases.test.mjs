import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, createRef, useRef } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({
  absWorkingDir: packageRoot,
  stdin: { contents: `
    export { useExplorerVirtualList } from './src/state/use-explorer-virtual-list.ts';
    export { explorerListCell } from './src/model/virtual-list.ts';
    export { useExplorerController } from './src/state/use-explorer-controller.ts';
  `, resolveDir: packageRoot, sourcefile: 'navigation-edge-cases.ts' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { useExplorerVirtualList, explorerListCell, useExplorerController } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`,
);
const change = async callback => { await act(async () => { await callback(); }); };
const entry = (id, parent = 'root', name = `${id}.txt`, kind = 'file') => ({
  id, parent, name, kind, size: 0, mime: kind === 'file' ? 'text/plain' : '',
  createdAt: '2026-09-17T00:00:00Z', updatedAt: '2026-09-17T00:00:00Z', favorite: 0,
  source: kind === 'file' ? { kind: 'existing', id } : null,
});

for (const view of ['details', 'extra-large', 'large', 'medium', 'small', 'list', 'tiles', 'content']) {
  test(`${view}: the first host reveal after virtualization uses the measured viewport`, async t => {
    let current, renderer;
    const focused = [];
    const owner = {
      getComputedStyle: () => ({ lineHeight: '28px' }),
      addEventListener() {}, removeEventListener() {},
    };
    const scroll = {
      clientWidth: 400, clientHeight: view === 'details' ? 100 : 280,
      scrollTop: 0, scrollLeft: 0, ownerDocument: { defaultView: owner },
      addEventListener() {}, removeEventListener() {},
      querySelectorAll: () => [{ dataset: { explorerEntryId: 'file-400' }, focus: () => focused.push('file-400') }],
    };
    function Probe({ entries, request }) {
      const focus = useRef(null);
      current = useExplorerVirtualList(entries, view, false, false, false,
        String(entries.length), null, focus, request);
      current.scrollRef.current = scroll;
      return null;
    }
    const entries = Array.from({ length: 500 }, (_, index) => entry(`file-${index}`));
    await change(() => { renderer = create(h(Probe, { entries: entries.slice(0, 1) })); });
    t.after(async () => { await change(() => renderer.unmount()); });
    assert.equal(current.enabled, false);
    await change(() => renderer.update(h(Probe, {
      entries, request: { id: 'file-400', tabId: 'tab-1' },
    })));
    const cell = explorerListCell(current.layout, 400);
    if (current.layout.axis === 'horizontal') {
      assert.ok(cell.left >= scroll.scrollLeft, 'the requested column begins inside the viewport');
      assert.ok(cell.left + cell.width <= scroll.scrollLeft + scroll.clientWidth,
        'the requested column ends inside the viewport');
    } else {
      assert.ok(cell.top >= scroll.scrollTop + current.layout.header,
        'the requested row is below the sticky header');
      assert.ok(cell.top + cell.height <= scroll.scrollTop + scroll.clientHeight,
        'the requested row ends inside the actual viewport');
    }
    assert.ok(current.items.some(item => item.entry.id === 'file-400'), 'the requested entry is rendered');
    assert.deepEqual(focused, [], 'revealing a file must not steal preview dialog focus');
  });
}

for (const external of [false, true]) {
  for (const nextId of ['a', 'b']) {
    test(`${external ? 'host' : 'built-in'} preview cannot resume after an event observer shows ${nextId === 'a' ? 'the same' : 'another'} file`, async t => {
      let current, renderer;
      const ref = createRef(), previewRequests = [], previewEvents = [];
      const props = {
        ref,
        initialEntries: [entry('folder-a', 'root', 'A', 'folder'), entry('folder-b', 'root', 'B', 'folder'),
          entry('a', 'folder-a'), entry('b', 'folder-b')],
        ...(external ? { onPreviewRequest: request => { previewRequests.push(request); } } : {}),
        onEvent(event) {
          if (event.type !== 'preview') return;
          previewEvents.push(event);
          assert.deepEqual(ref.current.showFile({ id: nextId }), { ok: true });
        },
      };
      function Probe() { current = useExplorerController(props); return null; }
      await change(() => { renderer = create(h(Probe)); });
      t.after(async () => { await change(() => renderer.unmount()); });
      await change(() => { assert.deepEqual(ref.current.showFile({ id: 'a' }, { mode: 'preview' }), { ok: true }); });
      assert.equal(current.location, nextId === 'a' ? 'folder-a' : 'folder-b');
      assert.deepEqual(current.selected, [nextId]);
      assert.equal(current.preview, undefined, 'the later select-only operation cancels the earlier preview');
      assert.deepEqual(previewRequests, [], 'the superseded host request must not be dispatched');
      assert.equal(previewEvents.length, 1, 'the original request is observed once');
    });
  }
}

test('a GUI navigation triggered by a preview observer also prevents the stale viewer from opening', async t => {
  let current, renderer;
  const ref = createRef();
  const props = {
    ref, initialEntries: [entry('folder-a', 'root', 'A', 'folder'), entry('folder-b', 'root', 'B', 'folder'), entry('a', 'folder-a')],
    onEvent(event) { if (event.type === 'preview') current.navigate('folder-b'); },
  };
  function Probe() { current = useExplorerController(props); return null; }
  await change(() => { renderer = create(h(Probe)); });
  t.after(async () => { await change(() => renderer.unmount()); });
  await change(() => { assert.deepEqual(ref.current.showFile({ id: 'a' }, { mode: 'preview' }), { ok: true }); });
  assert.equal(current.location, 'folder-b');
  assert.equal(current.preview, undefined);
});

test('a newer host command issued during edit cancellation wins over the original navigation', async t => {
  let current, renderer, pendingRename;
  const ref = createRef(), previewRequests = [];
  const props = {
    ref, initialEntries: [entry('folder-a', 'root', 'A', 'folder'), entry('folder-b', 'root', 'B', 'folder'),
      entry('a', 'folder-a'), entry('b', 'folder-b')],
    onSave: async () => {},
    onEditRequest: () => new Promise(() => {}),
    onPreviewRequest: request => { previewRequests.push(request); },
    onEvent(event) {
      if (event.type === 'edit-mode' && event.reason === 'cancelled')
        assert.deepEqual(ref.current.showFile({ id: 'b' }), { ok: true });
    },
  };
  function Probe() { current = useExplorerController(props); return null; }
  await change(() => { renderer = create(h(Probe)); });
  t.after(async () => { await change(() => renderer.unmount()); });
  await change(() => { pendingRename = current.act('rename', ['a'], { name: 'Renamed.txt' }); });
  assert.equal(current.editMode, 'requesting');
  await change(() => { ref.current.showFile({ id: 'a' }, { mode: 'preview' }); });
  assert.equal(await pendingRename, false);
  assert.equal(current.location, 'folder-b');
  assert.deepEqual(current.selected, ['b']);
  assert.deepEqual(previewRequests, [], 'the superseded command must not request a preview');
  assert.equal(current.entries.find(item => item.id === 'a').name, 'a.txt');
});
