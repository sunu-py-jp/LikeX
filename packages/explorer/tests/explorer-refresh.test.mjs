import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
  export { useExplorerDraft } from './src/state/use-explorer-draft.ts';
  export { useExplorerWorkspace } from './src/state/use-explorer-workspace.ts';
  export { useExplorerViewController } from './src/state/use-explorer-controller.ts';
  export { ExplorerProvider } from './src/state/explorer-context.tsx';
  export { ExplorerDomContext } from './src/ui/explorer-dom-context.tsx';
  export { ExplorerDialogs } from './src/ui/explorer-dialogs.tsx';
  export { default as Explorer } from './src/explorer.tsx';
`, resolveDir: packageRoot, sourcefile: 'explorer-refresh-contract.tsx' }, bundle: true, platform: 'node', format: 'esm', write: false,
plugins: [{ name: 'shared-react-and-transparent-overlays', setup(builder) {
  builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'refresh-test' }));
  builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'refresh-test' }));
  builder.onLoad({ filter: /.*/, namespace: 'refresh-test' }, ({ path }) => ({ resolveDir: packageRoot, loader: 'tsx', contents: path === 'portal'
    ? 'export const createPortal = children => children;'
    : `import { createContext, createElement, cloneElement, isValidElement, useContext } from 'react';
      function family(kind) {
        const RootContext = createContext(null);
        return Object.fromEntries(['Root', 'Provider', 'Portal', 'Trigger', 'Content', 'Item', 'Separator', 'ItemIndicator',
          'RadioGroup', 'RadioItem', 'CheckboxItem', 'Title', 'Description', 'Close', 'Overlay', 'Cancel', 'Action'].map(part => [part,
          ({ children, open, asChild, ...props }) => {
            const root = useContext(RootContext);
            if (part === 'Root' && ['dialog', 'alert'].includes(kind) && open === false) return null;
            if (part === 'Root' && ['dialog', 'alert'].includes(kind)) return createElement(RootContext.Provider,
              { value: props }, createElement('mock-' + kind + '-root', { ...props, open }, children));
            if (part === 'Provider' || (part === 'Root' && kind !== 'context')) return children;
            if (['Cancel', 'Close'].includes(part)) {
              const click = props.onClick ?? children?.props?.onClick;
              props.onClick = event => { click?.(event); if (!event?.defaultPrevented) root?.onOpenChange?.(false); };
            }
            if (asChild && isValidElement(children)) return cloneElement(children, props);
            return createElement('mock-' + kind + '-' + part.toLowerCase(), props, children);
          }
        ]));
      }
      export const Tooltip = family('tooltip'), DropdownMenu = family('dropdown'), ContextMenu = family('context'),
        Dialog = family('dialog'), AlertDialog = family('alert');`,
  }));
} }] });
const { useExplorerDraft, useExplorerWorkspace, useExplorerViewController, ExplorerProvider, ExplorerDomContext, ExplorerDialogs, Explorer } = await import(
  `data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=explorer-refresh-contract.mjs').toString('base64')}`
);
const change = async callback => { await act(async () => { await callback(); }); };
const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
const entry = (id, name, parent = 'root', kind = 'file') => ({ id, name, parent, kind, size: kind === 'file' ? 4 : 0,
  mime: kind === 'file' ? 'text/plain' : '', source: kind === 'file' ? { kind: 'existing', id: `body-${id}` } : null,
  createdAt: '2026-09-07T00:00:00.000Z', updatedAt: '2026-09-07T00:00:00.000Z', favorite: 0 });
const initialEntries = () => [entry('alpha', 'Alpha.txt'), entry('folder', 'Folder', 'root', 'folder'), entry('nested', 'Nested.txt', 'folder')];
const rename = { action: 'rename', ids: ['alpha'], name: 'Edited.txt' };
const refreshEvents = hook => hook.events.filter(event => event.type === 'refresh');

async function mount(t, supplied = {}, kind = 'draft') {
  let latest, workspace, second, renderer, closed = false;
  const events = [], saves = [], confirmations = [];
  const ownerDocument = { addEventListener() {}, removeEventListener() {}, defaultView: {
    addEventListener() {}, removeEventListener() {},
    confirm(message) { confirmations.push(message); return true; },
  } };
  const dialogContainer = { ownerDocument, id: 'explorer-pane' };
  let props = { initialEntries: initialEntries(), onSave: payload => { saves.push(payload); }, onEvent: event => events.push(event), ...supplied };
  function Draft({ options }) { latest = useExplorerDraft(options); return null; }
  function Controller({ options }) {
    workspace = useExplorerWorkspace(options);
    latest = useExplorerViewController(options, workspace, 'main', ownerDocument);
    second = useExplorerViewController(options, workspace, 'main', ownerDocument);
    return kind === 'controller-ui' ? h(ExplorerDomContext.Provider, { value: { document: ownerDocument, dialogContainer } },
      h(ExplorerProvider, { value: latest }, h(ExplorerDialogs))) : null;
  }
  const tree = () => h(StrictMode, null, kind === 'ui' ? h(Explorer, props) : h(kind === 'draft' ? Draft : Controller, { options: props }));
  await change(() => { renderer = create(tree()); });
  async function unmount() { if (closed) return; closed = true; await change(() => renderer.unmount()); }
  t.after(unmount);
  return { get current() { return latest; }, get workspace() { return workspace; }, get second() { return second; },
    get root() { return renderer.root; }, events, saves, confirmations, ownerDocument, dialogContainer, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
  };
}

test('refresh is optional, never loads automatically, and works in read-only without edit permission', async t => {
  let calls = 0, permissionCalls = 0;
  const hook = await mount(t, { onSave: undefined, onEditRequest() { permissionCalls++; return false; } });
  assert.equal(hook.current.readOnly, true);
  assert.equal(hook.current.canRefresh, false);
  assert.equal(hook.current.refreshing, false);
  assert.equal(hook.current.refreshError, null);
  await change(async () => assert.equal(await hook.current.refresh(), false));
  assert.deepEqual(refreshEvents(hook), []);
  await hook.update({ onRefresh() { calls++; return [entry('new', 'New.CSV')]; } });
  assert.equal(calls, 0);
  assert.equal(hook.current.canRefresh, true);
  await change(async () => assert.equal(await hook.current.refresh(), true));
  assert.equal(calls, 1);
  assert.equal(permissionCalls, 0);
  assert.equal(hook.current.entries[0].name, 'New.CSV');
  assert.equal(hook.current.entries[0].extension, 'csv');
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.contentRevision, 1);
  assert.deepEqual(refreshEvents(hook).map(event => event.status), ['start', 'success']);
  await hook.update({ onRefresh: undefined });
  assert.equal(hook.current.canRefresh, false);
});

test('refresh normalizes a new baseline and emits metadata without mutating the supplied data', async t => {
  const incoming = [{ ...entry('new', 'New.JSON'), extension: 'wrong' }];
  const hook = await mount(t, { onRefresh: () => incoming });
  await change(() => hook.current.apply(rename));
  await change(async () => assert.equal(await hook.current.refresh(), true));
  assert.equal(hook.current.entries[0].extension, 'json');
  assert.equal(incoming[0].extension, 'wrong');
  const success = refreshEvents(hook).find(event => event.status === 'success');
  assert.equal(success.entries[0].path, '/New.JSON');
  assert.equal(success.entries[0].extension, 'json');
  assert.equal(hook.current.dirty, false);
  await change(() => hook.current.apply({ action: 'rename', ids: ['new'], name: 'Later.JSON' }));
  await change(() => hook.current.discard());
  assert.equal(hook.current.entries[0].name, 'New.JSON');
  assert.equal(hook.current.dirty, false);
  assert.deepEqual(hook.saves, []);
});

test('refresh failures and invalid responses retain dirty local Files, content revision and edit session', async t => {
  for (const response of ['throw', undefined, null, {}, [entry('bad', 'Bad.txt', 'missing')]]) {
    await t.test(String(response), async t => {
      let context;
      const hook = await mount(t, { onEditRequest(_request, value) { context = value; return true; },
        onRefresh() { if (response === 'throw') throw new Error('Server unavailable'); return response; } });
      await change(async () => assert.equal(await hook.current.requestEdit(rename), true));
      const file = new File(['unsaved body'], 'Local.txt');
      await change(() => { hook.current.apply(rename); hook.current.add([file], 'root'); });
      const entries = hook.current.entries, sessionId = hook.current.editRequestId;
      await change(async () => assert.equal(await hook.current.refresh(), false));
      assert.equal(hook.current.entries, entries);
      assert.equal(hook.current.entries.at(-1).source.file, file);
      assert.equal(hook.current.editRequestId, sessionId);
      assert.equal(hook.current.editMode, 'edit');
      assert.equal(context.signal.aborted, false);
      assert.equal(hook.current.dirty, true);
      assert.equal(hook.current.refreshing, false);
      assert.equal(hook.current.contentRevision, 0);
      assert.ok(hook.current.refreshError);
      const statuses = refreshEvents(hook);
      assert.deepEqual(statuses.map(event => event.status), ['start', 'error']);
      assert.equal(statuses[1].message, hook.current.refreshError);
      assert.equal(hook.events.some(event => event.type === 'edit-mode' && event.reason === 'refreshed'), false);
    });
  }
});

test('refresh releases edit permission only after successful replacement', async t => {
  const pending = deferred();
  let context;
  const hook = await mount(t, { onEditRequest(_request, value) { context = value; return true; }, onRefresh: () => pending.promise });
  await change(async () => hook.current.requestEdit(rename));
  await change(() => hook.current.apply(rename));
  const revision = hook.current.editRevision;
  let refreshing;
  await change(() => { refreshing = hook.current.refresh(); });
  assert.equal(context.signal.aborted, false);
  assert.equal(hook.current.editMode, 'edit');
  await change(async () => { pending.resolve([]); assert.equal(await refreshing, true); });
  assert.equal(context.signal.aborted, true);
  assert.equal(context.signal.reason, 'refreshed');
  assert.equal(hook.current.editMode, 'view');
  assert.equal(hook.current.editRequestId, null);
  assert.equal(hook.current.editRevision, revision + 1);
  assert.deepEqual(hook.current.entries, []);
  assert.deepEqual(hook.events.filter(event => event.type === 'edit-mode').map(event => event.reason), ['request', 'granted', 'refreshed']);
});

test('refresh synchronously blocks duplicate refresh, save, prepared edits, uploads, discard and edit requests', async t => {
  const pending = deferred(); let calls = 0;
  const hook = await mount(t, { onRefresh() { calls++; return pending.promise; } });
  await change(() => hook.current.apply(rename));
  const entries = hook.current.entries;
  const retained = hook.current;
  const prepared = retained.prepareAction({ action: 'delete', ids: ['alpha'] });
  const preparedUpload = retained.prepareAdd([new File(['late'], 'Late.txt')], 'root');
  let refreshing;
  await change(async () => {
    refreshing = retained.refresh();
    assert.equal(await retained.refresh(), false);
    assert.equal(await retained.save(), false);
    assert.equal(await retained.requestEdit(rename), false);
    assert.throws(() => retained.apply({ action: 'delete', ids: ['alpha'] }));
    assert.throws(() => retained.add([new File(['late'], 'Another.txt')], 'root'));
    assert.throws(() => retained.discard());
    assert.throws(() => prepared());
    assert.throws(() => preparedUpload.commit());
  });
  assert.equal(calls, 1);
  assert.equal(hook.current.refreshing, true);
  assert.equal(hook.current.entries, entries);
  assert.deepEqual(hook.saves, []);
  await change(async () => { pending.resolve(initialEntries()); await refreshing; });
});

test('saving and pending edit permission refuse refresh before invoking the host', async t => {
  for (const active of ['save', 'permission']) await t.test(active, async t => {
    const pending = deferred(); let calls = 0;
    const hook = await mount(t, { onRefresh() { calls++; return []; },
      ...(active === 'save' ? { onSave: () => pending.promise } : { onEditRequest: () => pending.promise }) });
    let blocked;
    await change(() => {
      if (active === 'save') { hook.current.apply(rename); blocked = hook.current.save(); }
      else blocked = hook.current.requestEdit(rename);
    });
    await change(async () => assert.equal(await hook.current.refresh(), false));
    assert.equal(calls, 0);
    assert.deepEqual(refreshEvents(hook), []);
    await change(async () => { pending.resolve(active === 'save' ? undefined : true); await blocked; });
  });
});

test('refresh retries clear the prior error and use the latest committed callback', async t => {
  const hook = await mount(t, { onRefresh() { throw new Error('First load failed'); } });
  await change(() => hook.current.refresh());
  assert.equal(hook.current.refreshError, 'First load failed');
  const pending = deferred();
  await hook.update({ onRefresh: () => pending.promise });
  let refreshing;
  await change(() => { refreshing = hook.current.refresh(); });
  assert.equal(hook.current.refreshError, null);
  await change(async () => { pending.resolve([]); assert.equal(await refreshing, true); });
  assert.deepEqual(refreshEvents(hook).map(event => event.status), ['start', 'error', 'start', 'success']);
});

test('a refresh response after unmount cannot change retained data or emit completion', async t => {
  const pending = deferred();
  const hook = await mount(t, { onRefresh: () => pending.promise });
  const retained = hook.current, entries = hook.current.entries;
  let refreshing;
  await change(() => { refreshing = retained.refresh(); });
  await hook.unmount();
  await change(async () => { pending.resolve([]); assert.equal(await refreshing, false); });
  assert.equal(retained.getEntries(), entries);
  assert.deepEqual(refreshEvents(hook).map(event => event.status), ['start']);
});

test('dirty refresh opens an Explorer confirmation without calling the host or a native dialog', async t => {
  let calls = 0;
  const hook = await mount(t, { onRefresh() { calls++; return []; } }, 'controller');
  await change(() => hook.current.act('rename', ['alpha'], { name: 'Kept.txt' }));
  const file = new File(['local body'], 'Local.txt');
  await change(() => hook.workspace.draft.add([file], 'root'));
  const entries = hook.current.entries;
  await change(async () => assert.equal(await hook.current.refreshEntries(), false));
  assert.equal(hook.current.modal?.type, 'refresh');
  assert.deepEqual(hook.confirmations, []);
  assert.equal(calls, 0);
  assert.equal(hook.current.entries, entries);
  assert.equal(hook.second.entries, entries);
  assert.equal(hook.current.dirty, true);
  assert.deepEqual(refreshEvents(hook), []);
  await change(() => hook.current.setModal(null));
  assert.equal(hook.current.modal, null);
  assert.equal(hook.current.entries, entries);
  assert.equal(hook.current.entries.at(-1).source.file, file);
  assert.equal(hook.current.dirty, true);
  assert.equal(calls, 0);
  await change(async () => assert.equal(await hook.current.refreshEntries(), false));
  await change(async () => assert.equal(await hook.current.submitModal(), true));
  assert.equal(calls, 1);
  assert.deepEqual(hook.current.entries, []);
  assert.equal(hook.second.entries, hook.current.entries);
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.modal, null);
});

test('a confirmed refresh failure retains shared local Files and the current edit session', async t => {
  let calls = 0, context;
  const pending = deferred();
  const hook = await mount(t, { onEditRequest(_request, value) { context = value; return true; },
    onRefresh() { calls++; return pending.promise; } }, 'controller');
  await change(() => hook.current.act('rename', ['alpha'], { name: 'Kept.txt' }));
  const file = new File(['local body'], 'Local.txt');
  await change(() => hook.workspace.draft.add([file], 'root'));
  const entries = hook.current.entries, sessionId = hook.workspace.draft.editRequestId;
  await change(() => hook.current.refreshEntries());
  assert.equal(hook.current.modal?.type, 'refresh');
  assert.equal(calls, 0);
  let result;
  await change(() => { result = hook.current.submitModal(); });
  assert.equal(calls, 1);
  assert.equal(hook.current.refreshing, true);
  assert.equal(hook.current.entries, entries);
  assert.equal(context.signal.aborted, false);
  await change(async () => { pending.reject(new Error('Refresh unavailable')); assert.equal(await result, false); });
  assert.equal(hook.current.refreshError, 'Refresh unavailable');
  assert.equal(hook.current.entries, entries);
  assert.equal(hook.second.entries, entries);
  assert.equal(hook.current.entries.at(-1).source.file, file);
  assert.equal(hook.workspace.draft.editRequestId, sessionId);
  assert.equal(hook.workspace.draft.editMode, 'edit');
  assert.equal(context.signal.aborted, false);
  assert.equal(hook.current.dirty, true);
});

test('a refresh confirmation expires when another pane saves the shared draft', async t => {
  let calls = 0;
  const hook = await mount(t, { onRefresh() { calls++; return []; } }, 'controller');
  await change(() => hook.current.act('rename', ['alpha'], { name: 'Saved.txt' }));
  await change(() => hook.current.refreshEntries());
  assert.equal(hook.current.modal?.type, 'refresh');
  const submit = hook.current.submitModal;
  await change(() => hook.second.saveChanges());
  assert.equal(hook.current.dirty, false);
  assert.equal(hook.current.modal, null);
  const entries = hook.current.entries;
  await change(async () => assert.equal(await submit(), false));
  assert.equal(calls, 0);
  assert.equal(hook.current.entries, entries);
  assert.equal(hook.current.entries[0].name, 'Saved.txt');
});

test('removing onRefresh invalidates an open confirmation without discarding edits', async t => {
  let calls = 0;
  const hook = await mount(t, { onRefresh() { calls++; return []; } }, 'controller');
  await change(() => hook.current.act('rename', ['alpha'], { name: 'Kept.txt' }));
  await change(() => hook.current.refreshEntries());
  const submit = hook.current.submitModal, entries = hook.current.entries;
  assert.equal(hook.current.modal?.type, 'refresh');
  await hook.update({ onRefresh: undefined });
  assert.equal(hook.current.canRefresh, false);
  assert.equal(hook.current.modal, null);
  await change(async () => assert.equal(await submit(), false));
  assert.equal(calls, 0);
  assert.equal(hook.current.entries, entries);
  assert.equal(hook.current.dirty, true);
});

test('refresh confirmation cannot be submitted or cancelled through the UI while a shared save is pending', async t => {
  const pending = deferred(); let calls = 0;
  const hook = await mount(t, { onSave: () => pending.promise, onRefresh() { calls++; return []; } }, 'controller-ui');
  await change(() => hook.current.act('rename', ['alpha'], { name: 'Saved.txt' }));
  await change(() => hook.current.refreshEntries());
  assert.equal(hook.current.modal?.type, 'refresh');
  let saving;
  await change(() => { saving = hook.second.saveChanges(); });
  const alert = hook.root.findByType('mock-alert-root');
  const cancel = alert.findAllByType('button').find(button => button.children.includes('キャンセル'));
  assert.ok(cancel);
  assert.equal(cancel.props.disabled, true);
  assert.ok(alert.findAllByType('button').every(button => button.props.disabled), 'both decisions are disabled while saving');
  await change(() => alert.props.onOpenChange(false));
  assert.equal(hook.current.modal?.type, 'refresh');
  const overlay = alert.findByType('mock-alert-overlay');
  await change(() => overlay.props.onPointerDown({ button: 0, target: overlay, currentTarget: overlay, preventDefault() {} }));
  assert.equal(hook.current.modal?.type, 'refresh');
  await change(async () => assert.equal(await hook.current.submitModal(), false));
  assert.equal(calls, 0);
  await change(async () => { pending.resolve(); await saving; });
  assert.equal(hook.current.modal, null);
  assert.equal(hook.current.dirty, false);
});

test('unsaved confirmation cancellation through the button, root close or backdrop retains the shared draft', async t => {
  for (const type of ['discard', 'refresh']) {
    for (const dismissal of ['button', 'root-close', 'backdrop']) await t.test(`${type}: ${dismissal}`, async t => {
      let calls = 0;
      const hook = await mount(t, { onRefresh() { calls++; return []; } }, 'controller-ui');
      await change(() => hook.current.act('rename', ['alpha'], { name: 'Kept.txt' }));
      const file = new File(['keep this body'], 'Local.txt');
      await change(() => hook.workspace.draft.add([file], 'root'));
      const entries = hook.current.entries, sessionId = hook.workspace.draft.editRequestId;
      await change(() => type === 'refresh' ? hook.current.refreshEntries() : hook.current.showModal('discard'));
      assert.equal(hook.current.modal?.type, type);
      const alert = hook.root.findByType('mock-alert-root');
      assert.equal(alert.findByType('mock-alert-portal').props.container, hook.dialogContainer, 'the confirmation belongs to the active Explorer pane');
      await change(() => {
        if (dismissal === 'root-close') alert.props.onOpenChange(false);
        else if (dismissal === 'button') {
          const cancel = alert.findAllByType('button').find(button => button.children.includes('キャンセル'));
          cancel.props.onClick({ defaultPrevented: false });
        } else {
          const overlay = alert.findByType('mock-alert-overlay');
          overlay.props.onPointerDown({ button: 0, target: overlay, currentTarget: overlay, preventDefault() {} });
        }
      });
      assert.equal(hook.current.modal, null);
      assert.equal(hook.current.entries, entries);
      assert.equal(hook.second.entries, entries);
      assert.equal(hook.current.entries.at(-1).source.file, file);
      assert.equal(hook.current.dirty, true);
      assert.equal(hook.workspace.draft.editRequestId, sessionId);
      assert.equal(calls, 0);
      assert.deepEqual(refreshEvents(hook), []);
      assert.equal(hook.events.some(event => event.type === 'discard'), false);
    });
  }
});

test('right click and content interactions do not cancel an unsaved confirmation', async t => {
  const hook = await mount(t, { onRefresh: () => [] }, 'controller-ui');
  await change(() => hook.current.act('rename', ['alpha'], { name: 'Kept.txt' }));
  await change(() => hook.current.refreshEntries());
  const overlay = hook.root.findByType('mock-alert-overlay');
  let prevented = 0;
  await change(() => {
    overlay.props.onPointerDown({ button: 2, target: overlay, currentTarget: overlay, preventDefault() { prevented++; } });
    overlay.props.onPointerDown({ button: 0, target: {}, currentTarget: overlay, preventDefault() { prevented++; } });
  });
  assert.equal(prevented, 0);
  assert.equal(hook.current.modal?.type, 'refresh');
  assert.equal(hook.current.dirty, true);
});

test('delete confirmation retains AlertDialog outside-click protection', async t => {
  const hook = await mount(t, {}, 'controller-ui');
  await change(() => hook.current.showModal('delete', ['alpha']));
  const entries = hook.current.entries;
  const overlay = hook.root.findByType('mock-alert-overlay');
  await change(() => overlay.props.onPointerDown({ button: 0, target: overlay, currentTarget: overlay, preventDefault() {} }));
  assert.equal(hook.current.modal?.type, 'delete');
  assert.equal(hook.current.entries, entries);
});

test('controller reports refresh errors while retaining data and returns to root if a loaded folder disappears', async t => {
  const hook = await mount(t, { onRefresh() { throw new Error('Network down'); } }, 'controller');
  await change(() => hook.current.navigate('folder'));
  const entries = hook.current.entries;
  await change(() => hook.current.refreshEntries());
  assert.equal(hook.current.refreshError, 'Network down');
  assert.equal(hook.current.entries, entries);
  assert.equal(hook.current.location, 'folder');
  assert.deepEqual(hook.confirmations, []);
  await hook.update({ onRefresh: () => [entry('new', 'Remote.txt')] });
  await change(() => hook.current.refreshEntries());
  assert.equal(hook.current.location, 'root');
  assert.equal(hook.current.visible[0].name, 'Remote.txt');
});

test('workspace refresh cancels pending imports and invalidates shared content cache only on success', async t => {
  let reads = 0;
  const hook = await mount(t, { readFile: async () => new Blob([String(++reads)]), onRefresh() { throw new Error('Retry'); } }, 'controller');
  const source = hook.current.entries[0].source;
  const readFile = async () => new Blob([String(++reads)]);
  const cached = hook.workspace.mediaCache.acquire(source, readFile);
  const first = await cached.promise; cached.release();
  const pendingImport = new AbortController();
  hook.workspace.registerImport(pendingImport);
  await change(() => hook.current.refreshEntries());
  assert.equal(pendingImport.signal.aborted, true);
  assert.equal(hook.workspace.mediaCache.getRevision(), 0);
  const afterFailure = hook.workspace.mediaCache.acquire(source, readFile);
  assert.equal(await afterFailure.promise, first); afterFailure.release();
  await hook.update({ onRefresh: initialEntries });
  await change(() => hook.current.refreshEntries());
  assert.equal(hook.workspace.mediaCache.getRevision(), 1);
  const afterSuccess = hook.workspace.mediaCache.acquire(source, readFile);
  assert.notEqual(await afterSuccess.promise, first); afterSuccess.release();
});

test('the update button appears only with onRefresh and is disabled while its request is pending', async t => {
  const hook = await mount(t, {}, 'ui');
  const buttons = () => hook.root.findAllByType('button').filter(node => node.props['aria-label'] === '更新' || node.props.title === '更新');
  assert.equal(buttons().length, 0);
  const pending = deferred(); let calls = 0;
  await hook.update({ onSave: undefined, onRefresh() { calls++; return pending.promise; } });
  assert.equal(buttons().length, 1);
  assert.equal(Boolean(buttons()[0].props.disabled), false);
  await change(() => { buttons()[0].props.onClick(); });
  assert.equal(calls, 1);
  assert.equal(buttons()[0].props.disabled, true);
  assert.match(buttons()[0].findByType('svg').props.className, /animate-spin/);
  await change(() => pending.resolve([]));
  assert.equal(Boolean(buttons()[0].props.disabled), false);
  assert.doesNotMatch(buttons()[0].findByType('svg').props.className ?? '', /animate-spin/);
  await hook.update({ onRefresh() { throw new Error('Cannot load the current folder'); } });
  await change(() => { buttons()[0].props.onClick(); });
  const alerts = hook.root.findAll(node => node.props.role === 'alert');
  assert.ok(alerts.some(node => node.children.includes('Cannot load the current folder')));
  await hook.update({ onRefresh: undefined });
  assert.equal(buttons().length, 0);
});
