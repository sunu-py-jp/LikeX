import { packageRoot } from './test-paths.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { act, createElement as h, StrictMode } from 'react';
import { renderToString } from 'react-dom/server';
import { create } from 'react-test-renderer';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const output = await build({ absWorkingDir: packageRoot,
  stdin: {
    contents: "export * from './src/ui/explorer-theme.tsx'; export * from './src/ui/explorer-classnames.ts';",
    resolveDir: packageRoot,
    sourcefile: 'theme-class-contract.tsx',
  },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'shared-react-instance', setup(builder) {
    builder.onResolve({ filter: /^react(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const {
  defaultExplorerTheme, lightExplorerTheme, darkExplorerTheme, explorerThemeStyle, useExplorerColorScheme,
  mergeExplorerClasses, mergeExplorerRootClasses,
} = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

const variable = name => `--explorer-${name.replace(/[A-Z]/g, character => `-${character.toLowerCase()}`)}`;
const change = async callback => { await act(async () => { await callback(); }); };

test('prefixed utilities merge within Explorer while root overrides preserve host class names', () => {
  assert.equal(mergeExplorerClasses('lxe:size-8 lxe:hover:bg-red-500', 'lxe:size-6 lxe:hover:bg-blue-500'),
    'lxe:size-6 lxe:hover:bg-blue-500');
  assert.equal(mergeExplorerClasses('lxe:[&>svg]:size-4 lxe:@[720px]/explorer:flex',
    'lxe:[&>svg]:size-5 lxe:@[720px]/explorer:hidden'),
    'lxe:[&>svg]:size-5 lxe:@[720px]/explorer:hidden');
  const base = 'lxe:flex lxe:rounded-lg lxe:border lxe:border-[var(--explorer-border)] lxe:hover:bg-red-500';
  assert.equal(mergeExplorerRootClasses(base, 'rounded-none border-0 hover:bg-blue-500 custom-frame'),
    'lxe:flex lxe:border-[var(--explorer-border)] rounded-none border-0 hover:bg-blue-500 custom-frame');
  assert.equal(mergeExplorerRootClasses('lxe:rounded-lg lxe:flex', 'lxe:rounded-none'), 'lxe:flex lxe:rounded-none');
  assert.equal(mergeExplorerRootClasses('lxe:p-2 lxe:p-3'), 'lxe:p-3');
  assert.equal(mergeExplorerRootClasses('lxe:p-2', '  host-shell  host-shell '), 'lxe:p-2 host-shell host-shell');
});

test('the default light palette preserves existing colors and emits the complete CSS token contract', () => {
  assert.deepEqual(defaultExplorerTheme, lightExplorerTheme);
  assert.equal(defaultExplorerTheme.background, '#ffffff');
  assert.equal(defaultExplorerTheme.foreground, '#252525');
  assert.equal(defaultExplorerTheme.accent, '#0067c0');
  assert.equal(defaultExplorerTheme.colorScheme, 'light');
  const style = explorerThemeStyle();
  for (const [name, value] of Object.entries(defaultExplorerTheme)) {
    assert.equal(style[variable(name)], value, name);
  }
  assert.equal(style.colorScheme, 'light');
  assert.equal(style.fontFamily, defaultExplorerTheme.fontFamily);
});

test('dark mode selects the full dark preset rather than changing only the browser color scheme', () => {
  const style = explorerThemeStyle({}, 'dark');
  assert.equal(style.colorScheme, 'dark');
  assert.equal(style['--explorer-color-scheme'], 'dark');
  for (const [name, value] of Object.entries(darkExplorerTheme)) {
    assert.equal(style[variable(name)], value, name);
  }
  for (const token of ['background', 'foreground', 'panel', 'border', 'selection', 'hover']) {
    assert.notEqual(darkExplorerTheme[token], lightExplorerTheme[token], token);
  }
});

test('legacy theme.colorScheme stays supported while an explicit resolved scheme takes priority', () => {
  assert.equal(explorerThemeStyle({ colorScheme: 'dark' }).colorScheme, 'dark');
  const style = explorerThemeStyle({ colorScheme: 'dark', accent: '#123456' }, 'light');
  assert.equal(style.colorScheme, 'light');
  assert.equal(style['--explorer-color-scheme'], 'light');
  assert.equal(style['--explorer-background'], lightExplorerTheme.background);
  assert.equal(style['--explorer-accent'], '#123456');
});

test('baseColor generates related surfaces for the active mode while retaining readable preset text', () => {
  for (const scheme of ['light', 'dark']) {
    const preset = scheme === 'light' ? lightExplorerTheme : darkExplorerTheme;
    const style = explorerThemeStyle({ baseColor: '#abc123' }, scheme);
    assert.equal(style['--explorer-background'], '#abc123');
    assert.equal(style['--explorer-foreground'], preset.foreground);
    for (const token of ['panel', 'border', 'hover']) {
      assert.match(style[variable(token)], /^color-mix\(in srgb,/);
      assert.ok(style[variable(token)].includes('#abc123'), token);
      assert.ok(style[variable(token)].includes(preset.foreground), token);
    }
    assert.match(style['--explorer-selection'], /^color-mix\(in srgb,/);
    assert.ok(style['--explorer-selection'].includes('#abc123'));
    assert.ok(style['--explorer-selection'].includes(preset.accent));
  }
});

test('mode base colors override the common base while explicit tokens override generated colors', () => {
  const theme = {
    baseColor: '#101010', background: '#abcdef', panel: '#fedcba', accent: '#008080',
    light: { baseColor: '#fef8e7', panel: '#ffffee' },
    dark: { baseColor: '#102030', foreground: '#eeeeee', accent: '#55ddff' },
  };
  const original = structuredClone(theme);
  const light = explorerThemeStyle(theme, 'light');
  const dark = explorerThemeStyle(theme, 'dark');
  assert.equal(light['--explorer-background'], '#abcdef');
  assert.equal(dark['--explorer-background'], '#abcdef');
  assert.equal(light['--explorer-panel'], '#ffffee');
  assert.equal(dark['--explorer-panel'], '#fedcba');
  assert.equal(light['--explorer-accent'], '#008080');
  assert.equal(dark['--explorer-accent'], '#55ddff');
  assert.ok(light['--explorer-hover'].includes('#fef8e7'));
  assert.ok(dark['--explorer-hover'].includes('#102030'));
  assert.equal(dark['--explorer-foreground'], '#eeeeee');
  assert.deepEqual(theme, original, 'resolving both modes does not mutate caller options');
});

test('mode overrides and baseColor configuration never become invalid object-valued CSS variables', () => {
  const style = explorerThemeStyle({
    baseColor: '#eeeeee', fontFamily: 'Example Sans',
    light: { fontFamily: 'Light Sans', border: '#ccddee' },
    dark: { baseColor: '#111111', fontFamily: 'Dark Sans' },
  }, 'dark');
  assert.equal(style.fontFamily, 'Dark Sans');
  assert.equal(style['--explorer-font-family'], 'Dark Sans');
  for (const forbidden of ['--explorer-base-color', '--explorer-light', '--explorer-dark']) {
    assert.equal(Object.hasOwn(style, forbidden), false);
  }
  assert.ok(Object.values(style).every(value => typeof value === 'string'));
});

test('undefined mode overrides preserve common tokens and use the preset for unset common tokens', () => {
  const style = explorerThemeStyle({
    baseColor: '#aabbcc', foreground: undefined, accent: '#112233',
    dark: { baseColor: undefined, accent: undefined },
  }, 'dark');
  assert.equal(style['--explorer-background'], '#aabbcc');
  assert.equal(style['--explorer-accent'], '#112233');
  assert.equal(style['--explorer-foreground'], darkExplorerTheme.foreground);
  assert.ok(style['--explorer-selection'].includes('#112233'));
});

function mockStyle() {
  const values = new Map();
  return {
    getPropertyValue(name) { return values.get(name)?.value ?? ''; },
    getPropertyPriority(name) { return values.get(name)?.priority ?? ''; },
    setProperty(name, value, priority = '') { values.set(name, { value, priority }); },
    removeProperty(name) { const previous = this.getPropertyValue(name); values.delete(name); return previous; },
  };
}

function mockDocument(dark = false, { unsupported = false, throws = false } = {}) {
  const listeners = new Set();
  const calls = [];
  const media = {
    matches: dark, media: '(prefers-color-scheme: dark)',
    addEventListener(type, listener) { assert.equal(type, 'change'); listeners.add(listener); },
    removeEventListener(type, listener) { assert.equal(type, 'change'); listeners.delete(listener); },
  };
  const document = { body: { style: mockStyle() }, defaultView: {} };
  if (!unsupported) document.defaultView.matchMedia = function (query) {
    calls.push({ query, source: this });
    if (throws) throw new Error('Media queries are unavailable');
    return media;
  };
  return { document, media, calls, listeners,
    dispatch(dark) {
      media.matches = dark;
      for (const listener of [...listeners]) listener({ matches: dark, media: media.media });
    },
  };
}

async function mountScheme(t, initial = {}) {
  let latest;
  let props = initial;
  let renderer;
  let unmounted = false;
  function Probe({ options }) {
    latest = useExplorerColorScheme(options.colorMode, options.theme, options.ownerDocument ?? null);
    return h('output', null, latest);
  }
  const tree = () => h(StrictMode, null, h(Probe, { options: props }));
  const unmount = async () => {
    if (unmounted) return;
    unmounted = true;
    await change(() => renderer.unmount());
  };
  t.after(unmount);
  await change(() => { renderer = create(tree()); });
  return {
    get scheme() { return latest; }, unmount,
    async update(patch) { props = { ...props, ...patch }; await change(() => renderer.update(tree())); },
  };
}

test('fixed color modes and legacy theme.colorScheme never subscribe to system preference changes', async t => {
  const owner = mockDocument(true);
  const hook = await mountScheme(t, { ownerDocument: owner.document });
  assert.equal(hook.scheme, 'light');
  await hook.update({ theme: { colorScheme: 'dark' } });
  assert.equal(hook.scheme, 'dark');
  await hook.update({ colorMode: 'light' });
  assert.equal(hook.scheme, 'light');
  await hook.update({ colorMode: 'dark', theme: { colorScheme: 'light' } });
  assert.equal(hook.scheme, 'dark');
  assert.deepEqual(owner.calls, []);
  assert.equal(owner.listeners.size, 0);
});

test('system mode reads and follows the owning window with one active listener under StrictMode', async t => {
  const owner = mockDocument(true);
  const hook = await mountScheme(t, { colorMode: 'system', theme: { colorScheme: 'light' }, ownerDocument: owner.document });
  assert.equal(hook.scheme, 'dark');
  assert.equal(owner.listeners.size, 1);
  assert.ok(owner.calls.every(call => call.query === '(prefers-color-scheme: dark)' && call.source === owner.document.defaultView));
  await change(() => owner.dispatch(false));
  assert.equal(hook.scheme, 'light');
  await change(() => owner.dispatch(true));
  assert.equal(hook.scheme, 'dark');
  await hook.unmount();
  assert.equal(owner.listeners.size, 0);
});

test('switching system mode to a fixed mode removes its listener and ignores later media changes', async t => {
  const owner = mockDocument(true);
  const hook = await mountScheme(t, { colorMode: 'system', ownerDocument: owner.document });
  assert.equal(hook.scheme, 'dark');
  await hook.update({ colorMode: 'light' });
  assert.equal(hook.scheme, 'light');
  assert.equal(owner.listeners.size, 0);
  await change(() => owner.dispatch(true));
  assert.equal(hook.scheme, 'light');
  await hook.update({ colorMode: 'system' });
  assert.equal(hook.scheme, 'dark');
  assert.equal(owner.listeners.size, 1);
  await hook.update({ colorMode: undefined, theme: { colorScheme: 'dark' } });
  assert.equal(hook.scheme, 'dark');
  assert.equal(owner.listeners.size, 0);
});

test('moving a pane to another document switches media sources and releases the old listener', async t => {
  const main = mockDocument(true);
  const child = mockDocument(false);
  const hook = await mountScheme(t, { colorMode: 'system', ownerDocument: main.document });
  assert.equal(hook.scheme, 'dark');
  await hook.update({ ownerDocument: child.document });
  assert.equal(hook.scheme, 'light');
  assert.equal(main.listeners.size, 0);
  assert.equal(child.listeners.size, 1);
  await change(() => main.dispatch(true));
  assert.equal(hook.scheme, 'light');
  await change(() => child.dispatch(true));
  assert.equal(hook.scheme, 'dark');
  await hook.unmount();
  assert.equal(child.listeners.size, 0);
});

test('system mode falls back to light without an accessible matchMedia implementation', async t => {
  for (const ownerDocument of [null, {}, { defaultView: null }, mockDocument(true, { unsupported: true }).document,
    mockDocument(true, { throws: true }).document]) {
    const hook = await mountScheme(t, { colorMode: 'system', ownerDocument });
    assert.equal(hook.scheme, 'light');
    await hook.unmount();
  }
});

test('SSR produces deterministic light system mode and honors explicit dark mode', () => {
  function Probe({ colorMode, theme }) {
    return h('output', null, useExplorerColorScheme(colorMode, theme, null));
  }
  assert.equal(renderToString(h(Probe, { colorMode: 'system' })), '<output>light</output>');
  assert.equal(renderToString(h(Probe, { colorMode: 'dark' })), '<output>dark</output>');
  assert.equal(renderToString(h(Probe, { theme: { colorScheme: 'dark' } })), '<output>dark</output>');
});

// Keep the actual ExplorerPane and its theme/environment providers. Lightweight
// child probes stand in for file operations and DOM portals so this test focuses
// on applying one resolved theme to each pane and its floating surfaces.
const paneOutput = await build({ absWorkingDir: packageRoot,
  stdin: { contents: `export { ExplorerWorkspaceView } from './src/explorer.tsx';`,
    resolveDir: packageRoot, sourcefile: 'test-explorer-theme-pane.tsx' },
  bundle: true, platform: 'node', format: 'esm', write: false,
  plugins: [{ name: 'theme-pane-probes', setup(builder) {
    builder.onResolve({ filter: /^(react|lucide-react)(\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^react-dom$/ }, () => ({ path: 'portal', namespace: 'theme-test' }));
    builder.onResolve({ filter: /^radix-ui$/ }, () => ({ path: 'radix', namespace: 'theme-test' }));
    builder.onResolve({ filter: /^\.\/state\/use-explorer-controller$/ }, () => ({ path: 'controller', namespace: 'theme-test' }));
    builder.onResolve({ filter: /^\.\/ui\/explorer-(sidebar|header|status-bar|file-list|dialogs)$/ }, () => ({ path: 'ui', namespace: 'theme-test' }));
    builder.onLoad({ filter: /.*/, namespace: 'theme-test' }, ({ path }) => ({
      resolveDir: packageRoot, loader: 'tsx', contents: {
        portal: 'import { cloneElement } from "react"; export const createPortal = (children, container, key) => cloneElement(children, { key });',
        radix: 'export const Tooltip = { Provider: ({ children }) => children };',
        controller: `
          import { useId, useRef } from 'react';
          export function useExplorerViewController() {
            return { instanceId: useId(), workspaceRef: useRef(null), fileInput: useRef(null), folderInput: useRef(null),
              title: 'ファイル', features: {}, uiOptions: {}, notification: null };
          }
        `,
        ui: `
          import { createElement } from 'react';
          import { useExplorerTheme } from './src/ui/explorer-theme.tsx';
          export const ExplorerSidebar = () => null;
          export const ExplorerHeader = () => null;
          export const ExplorerStatusBar = () => null;
          export const ExplorerFileList = () => null;
          export function ExplorerDialogs() {
            return createElement('output', { 'data-overlay-theme': true, style: useExplorerTheme() });
          }
        `,
      }[path],
    }));
  } }],
});
const { ExplorerWorkspaceView } = await import(
  `data:text/javascript;base64,${Buffer.from(paneOutput.outputFiles[0].text + '\n//# sourceURL=explorer-theme-test-pane.mjs').toString('base64')}`
);

test('actual Explorer panes resolve each owner window preference and propagate the theme to floating UI', async t => {
  const main = mockDocument(false);
  const child = mockDocument(true);
  const mainBody = main.document.body.style;
  const childBody = child.document.body.style;
  mainBody.setProperty('background-color', '#dddddd');
  childBody.setProperty('background-color', '#999999', 'important');
  const workspace = {
    windows: [{ id: 'child', container: { ownerDocument: child.document } }],
    notifications: { messages: [], dismiss() {}, clear() {} },
  };
  let props = {
    initialEntries: [], onSave() {}, colorMode: 'system',
    theme: { accent: '#226688', light: { baseColor: '#f7f4ee' }, dark: { baseColor: '#17212b' } },
    style: { '--explorer-border': '#aabbcc', width: '100%' },
  };
  let renderer;
  const tree = () => h(StrictMode, null, h(ExplorerWorkspaceView, { props, workspace, ownerDocument: main.document }));
  t.after(async () => {
    await change(() => renderer.unmount());
    assert.equal(main.listeners.size, 0);
    assert.equal(child.listeners.size, 0);
    assert.equal(mainBody.getPropertyValue('background-color'), '#dddddd');
    assert.equal(childBody.getPropertyValue('background-color'), '#999999');
    assert.equal(childBody.getPropertyPriority('background-color'), 'important');
    assert.equal(childBody.getPropertyValue('overflow'), 'hidden');
  });
  await change(() => { renderer = create(tree()); });
  const roots = () => renderer.root.findAllByProps({ role: 'region' });
  const overlays = () => renderer.root.findAllByProps({ 'data-overlay-theme': true });
  assert.deepEqual(roots().map(root => root.props.style.colorScheme), ['light', 'dark']);
  assert.deepEqual(roots().map(root => root.props.style['--explorer-background']), ['#f7f4ee', '#17212b']);
  assert.equal(main.listeners.size, 1);
  assert.equal(child.listeners.size, 1);
  assert.equal(mainBody.getPropertyValue('background-color'), '#dddddd', 'embedded panes leave the host body unchanged');
  assert.equal(mainBody.getPropertyValue('color-scheme'), '');
  assert.equal(childBody.getPropertyValue('color-scheme'), 'dark');
  assert.equal(childBody.getPropertyValue('--explorer-background'), '#17212b');
  childBody.setProperty('overflow', 'hidden');
  for (let index = 0; index < 2; index++) {
    const style = overlays()[index].props.style;
    assert.equal(style.colorScheme, roots()[index].props.style.colorScheme);
    assert.equal(style['--explorer-background'], roots()[index].props.style['--explorer-background']);
    assert.equal(style['--explorer-accent'], '#226688');
    assert.equal(style['--explorer-border'], '#aabbcc');
    assert.equal(style.width, undefined, 'layout-only styles are not copied to floating surfaces');
  }
  await change(() => child.dispatch(false));
  assert.deepEqual(roots().map(root => root.props.style.colorScheme), ['light', 'light']);
  assert.deepEqual(overlays().map(overlay => overlay.props.style['--explorer-background']), ['#f7f4ee', '#f7f4ee']);
  assert.equal(childBody.getPropertyValue('color-scheme'), 'light');
  assert.equal(childBody.getPropertyValue('overflow'), 'hidden', 'theme updates preserve dialog scroll locking');
  props = { ...props, colorMode: 'dark', theme: { ...props.theme, accent: '#55ddff' } };
  await change(() => renderer.update(tree()));
  assert.deepEqual(roots().map(root => root.props.style.colorScheme), ['dark', 'dark']);
  assert.deepEqual(overlays().map(overlay => overlay.props.style['--explorer-accent']), ['#55ddff', '#55ddff']);
  assert.equal(main.listeners.size, 0);
  assert.equal(child.listeners.size, 0);
});
