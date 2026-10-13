import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h } from 'react';
import { create } from 'react-test-renderer';
import { renderToStaticMarkup } from 'react-dom/server';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
async function bundle(mockTooltip) {
  const output = await build({ absWorkingDir: packageRoot, stdin: { contents: `
    export { ExplorerPreviewError } from './src/ui/explorer-preview-error.tsx';
    export { ExplorerPreviewContent } from './src/ui/explorer-preview-content.tsx';
    export { ExplorerDomContext } from './src/ui/explorer-dom-context.tsx';
    export { ExplorerThemeContext } from './src/ui/explorer-theme.tsx';
  `, resolveDir: packageRoot }, bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-and-controlled-tooltip', setup(builder) {
    builder.onResolve({ filter: /^(react|react-dom|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^radix-ui$/ }, () => mockTooltip
      ? { path: 'radix', namespace: 'preview-error-test' }
      : { path: import.meta.resolve('radix-ui'), external: true });
    builder.onLoad({ filter: /.*/, namespace: 'preview-error-test' }, () => ({ loader: 'tsx', resolveDir: packageRoot, contents: `
      import { createContext, createElement as h, cloneElement, useContext } from 'react';
      const Context = createContext(null);
      export const Tooltip = {
        Provider: ({ children }) => children,
        Root: ({ children, ...props }) => h(Context.Provider, { value: props }, h('test-tooltip-root', props, children)),
        Trigger: ({ children, asChild, ...props }) => cloneElement(children, props),
        Portal: ({ children, ...props }) => h('test-tooltip-portal', props, children),
        Content: ({ children, ...props }) => useContext(Context).open ? h('div', { ...props, role: 'tooltip' }, children) : null,
      };
    ` }));
  } }] });
  return import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
}
const { ExplorerPreviewError, ExplorerPreviewContent, ExplorerDomContext, ExplorerThemeContext } = await bundle(true);
const real = await bundle(false);
const change = async callback => { await act(async () => { await callback(); }); };
const text = node => typeof node === 'string' ? node : node.children.map(text).join('');
function documentFor() {
  const document = new EventTarget();
  document.defaultView = new EventTarget();
  document.body = { ownerDocument: document };
  return document;
}
async function mount(t, props, { ownerDocument = documentFor(), contextDocument, portalContainer, theme } = {}) {
  const nodes = {};
  let renderer;
  const tree = props => {
    const component = h(ExplorerPreviewError, props);
    const element = theme ? h(ExplorerThemeContext.Provider, { value: theme }, component) : component;
    return contextDocument ? h(ExplorerDomContext.Provider, { value: { document: contextDocument, portalContainer } }, element) : element;
  };
  await change(() => { renderer = create(tree(props), { createNodeMock: element => {
    const node = { ownerDocument, contains: target => target === node };
    if (element.type === 'button') nodes.trigger = node;
    if (element.props.role === 'tooltip') nodes.content = node;
    return node;
  } }); });
  t.after(() => change(() => renderer.unmount()));
  return {
    get root() { return renderer.root; }, get trigger() { return renderer.root.findByType('button'); },
    get tooltip() { return renderer.root.findByType('test-tooltip-root'); },
    get details() { return renderer.root.findAllByProps({ role: 'tooltip' }); },
    nodes, ownerDocument,
    click: () => change(() => renderer.root.findByType('button').props.onClick()),
    requestOpen: open => change(() => renderer.root.findByType('test-tooltip-root').props.onOpenChange(open)),
    update: props => change(() => renderer.update(tree(props))),
  };
}

test('standalone preview errors render with their own provider, scoped styles, and an accessible icon after the message', () => {
  const html = renderToStaticMarkup(h(real.ExplorerPreviewError, { error: new Error('private diagnostic'), message: '表示できません。', className: 'host-error' }));
  assert.match(html, /role="alert"/);
  assert.match(html, /data-likex-explorer=""/);
  assert.match(html, /--explorer-background:/);
  assert.match(html, /host-error/);
  assert.match(html, /表示できません。<\/p><button[^>]+aria-label="エラーの詳細"/);
  assert.match(html, /aria-expanded="false"/);
  assert.equal(html.includes('private diagnostic'), false);
});

test('hover/focus requests reveal only the escaped exception message and long details can wrap, scroll, and be copied', async t => {
  const message = '<img src=x onerror=alert(1)>\n' + 'diagnostic'.repeat(300);
  const error = new Error(message);
  error.stack = 'SECRET STACK';
  error.cause = { token: 'SECRET OBJECT' };
  const app = await mount(t, { error });
  assert.equal(app.details.length, 0);
  await app.requestOpen(true);
  assert.equal(text(app.details[0]), message);
  assert.equal(app.trigger.props['aria-expanded'], true);
  assert.match(app.details[0].props.className, /overflow-y-auto/);
  assert.match(app.details[0].props.className, /whitespace-pre-wrap/);
  assert.match(app.details[0].props.className, /wrap-anywhere/);
  assert.match(app.details[0].props.className, /select-text/);
  assert.equal(app.details[0].props.tabIndex, 0);
  const html = renderToStaticMarkup(h('div', null, app.details[0].props.children));
  assert.match(html, /&lt;img/);
  assert.equal(html.includes('<img'), false);
  assert.equal(html.includes('SECRET'), false);
  await app.requestOpen(false);
  assert.equal(app.details.length, 0);
});

test('strings are preserved and empty or unknown thrown values do not stringify objects or expose their properties', async t => {
  const inaccessible = new Error();
  Object.defineProperty(inaccessible, 'message', { get() { throw Error('do not leak'); } });
  for (const error of ['string failure', '', '  ', new Error(''), null, undefined, 42, { message: 'not an Error', token: 'secret', toString() { throw Error('must not run'); } }, inaccessible]) {
    const app = await mount(t, { error });
    await app.click();
    assert.equal(text(app.details[0]), error === 'string failure' ? error : 'エラーの詳細を取得できませんでした。');
  }
});

test('click pins details across hover/focus changes and the next click closes them', async t => {
  const app = await mount(t, { error: 'diagnostic' });
  await app.requestOpen(true);
  await app.click();
  await app.requestOpen(false);
  assert.equal(app.details.length, 1);
  await app.click();
  assert.equal(app.details.length, 0);
  await app.requestOpen(true);
  assert.equal(app.details.length, 1);
});

test('the trigger document owns the portal and dismissal listeners even without an Explorer provider', async t => {
  const ownerDocument = documentFor();
  const app = await mount(t, { error: 'diagnostic' }, { ownerDocument });
  await app.click();
  assert.equal(app.root.findByType('test-tooltip-portal').props.container, ownerDocument.body);
  const pointer = target => {
    const event = new Event('pointerdown');
    Object.defineProperty(event, 'target', { value: target });
    return event;
  };
  await change(() => ownerDocument.dispatchEvent(pointer(app.nodes.content)));
  assert.equal(app.details.length, 1, 'selecting/copying inside the details leaves them pinned');
  await change(() => ownerDocument.dispatchEvent(pointer(app.nodes.trigger)));
  assert.equal(app.details.length, 1);
  await change(() => ownerDocument.dispatchEvent(pointer({})));
  assert.equal(app.details.length, 0);
  await app.click();
  await change(() => ownerDocument.defaultView.dispatchEvent(new Event('blur')));
  assert.equal(app.details.length, 0);
});

test('detached documents open details on focus and do not portal into an unrelated provider document', async t => {
  const mainDocument = documentFor(), detachedDocument = documentFor();
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'document');
  Object.defineProperty(globalThis, 'document', { configurable: true, value: mainDocument });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, 'document', previous);
    else delete globalThis.document;
  });
  const app = await mount(t, { error: 'detached diagnostic' }, {
    ownerDocument: detachedDocument, contextDocument: mainDocument, portalContainer: mainDocument.body,
  });
  assert.equal(app.tooltip.props.disableHoverableContent, true);
  await change(() => app.trigger.props.onFocus());
  assert.equal(app.details.length, 1);
  assert.equal(app.root.findByType('test-tooltip-portal').props.container, detachedDocument.body);
  const portalContainer = { ownerDocument: detachedDocument };
  const provided = await mount(t, { error: 'same document' }, {
    ownerDocument: detachedDocument, contextDocument: detachedDocument, portalContainer,
  });
  assert.equal(provided.root.findByType('test-tooltip-portal').props.container, portalContainer);
});

test('Escape is consumed on owner-window capture before parent preview handlers and resets pinning', async t => {
  const app = await mount(t, { error: 'diagnostic' });
  await app.click();
  let parentEscapes = 0;
  const parent = () => { parentEscapes++; };
  app.ownerDocument.defaultView.addEventListener('keydown', parent);
  const escape = new Event('keydown', { cancelable: true });
  Object.defineProperty(escape, 'key', { value: 'Escape' });
  await change(() => app.ownerDocument.defaultView.dispatchEvent(escape));
  assert.equal(escape.defaultPrevented, true);
  assert.equal(parentEscapes, 0);
  assert.equal(app.details.length, 0);
  await app.requestOpen(true);
  await app.requestOpen(false);
  assert.equal(app.details.length, 0, 'Escape releases the pin');
  const next = new Event('keydown');
  Object.defineProperty(next, 'key', { value: 'Escape' });
  await change(() => app.ownerDocument.defaultView.dispatchEvent(next));
  assert.equal(parentEscapes, 1, 'the next Escape is available to the preview');
});

test('a changed diagnostic closes stale details, and inherited themes apply to both surfaces', async t => {
  const theme = { '--explorer-danger': '#c00' };
  const app = await mount(t, { error: 'old' }, { theme });
  await app.click();
  await app.update({ error: 'new' });
  assert.equal(app.details.length, 0);
  await app.click();
  assert.equal(text(app.details[0]), 'new');
  assert.equal(app.root.findByProps({ role: 'alert' }).props.style, theme);
  assert.equal(app.details[0].props.style, theme);
});

test('synchronous host rendering failures keep the actual exception for the reusable details display', async t => {
  const error = new Error('host preview failure');
  const entry = { id: 'file', parent: 'root', kind: 'file', name: 'file.xlsx', size: 10, mime: '', favorite: 0, source: null, createdAt: '', updatedAt: '' };
  let renderer;
  await change(() => { renderer = create(h(ExplorerPreviewContent, {
    entries: [entry], entry, processing: false, allowDownload: true,
    renderPreview: () => { throw error; },
  })); });
  t.after(() => change(() => renderer.unmount()));
  assert.equal(renderer.root.findByType(ExplorerPreviewError).props.error, error);
  assert.equal(renderer.root.findAllByProps({ role: 'alert' }).length, 1);
});
