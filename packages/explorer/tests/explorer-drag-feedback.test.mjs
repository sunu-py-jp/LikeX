import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { packageRoot } from './test-paths.mjs';

const output = await build({ absWorkingDir: packageRoot, entryPoints: ['src/ui/explorer-drag-feedback.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const { createExplorerDragPreview, createExplorerViewportScroller, installExplorerDragAutoScroll } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

function environment() {
  let sequence = 0, time = 0;
  const frames = new Map(), timers = new Map(), listeners = new Map(), windowListeners = new Map(), children = [];
  const add = (map, type, fn) => { if (!map.has(type)) map.set(type, new Set()); map.get(type).add(fn); };
  const view = { innerWidth: 800, innerHeight: 600,
    requestAnimationFrame(fn) { frames.set(++sequence, fn); return sequence; }, cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(fn) { timers.set(++sequence, fn); return sequence; }, clearTimeout(id) { timers.delete(id); },
    getComputedStyle() { return { getPropertyValue: name => name === '--explorer-panel' ? '#172554' : '#fff' }; },
    addEventListener: (type, fn) => add(windowListeners, type, fn), removeEventListener: (type, fn) => windowListeners.get(type)?.delete(fn),
  };
  const document = { defaultView: view, documentElement: {},
    body: { append(element) { children.push(element); } },
    addEventListener: (type, fn) => add(listeners, type, fn), removeEventListener: (type, fn) => listeners.get(type)?.delete(fn),
    createElement(tagName) { return { tagName, dataset: {}, attributes: {}, children: [], style: { setProperty(name, value) { this[name] = value; } }, append(child) { this.children.push(child); }, setAttribute(name, value) { this.attributes[name] = value; }, remove() { const index = children.indexOf(this); if (index >= 0) children.splice(index, 1); } }; },
  };
  const hosts = new Set();
  const root = { ownerDocument: document, contains: host => hosts.has(host) };
  function host(axes = 'both', bounds = { left: 100, top: 100, right: 500, bottom: 500 }) {
    let left = 100, top = 100;
    const result = { ownerDocument: document, isConnected: true, dataset: { explorerDragScroll: axes }, closest: () => result, getBoundingClientRect: () => bounds,
      get scrollLeft() { return left; }, set scrollLeft(value) { left = Math.min(1000, Math.max(0, value)); },
      get scrollTop() { return top; }, set scrollTop(value) { top = Math.min(1000, Math.max(0, value)); },
    }; hosts.add(result); return result;
  }
  return { view, document, root, children, timers, frames, listeners, host,
    frame(elapsed = 16) { time += elapsed; for (const [id, fn] of [...frames]) { frames.delete(id); fn(time); } },
    dispatch(type, event) { for (const fn of [...listeners.get(type) ?? []]) fn(event); },
    blur() { for (const fn of [...windowListeners.get('blur') ?? []]) fn(); },
    timersNow() { for (const [id, fn] of [...timers]) { timers.delete(id); fn(); } },
  };
}

test('native preview contains one bounded title and a count, inherits source colors and is promptly removed', () => {
  const env = environment(), source = env.host(), captured = [];
  const cleanup = createExplorerDragPreview(source, { setDragImage: (...args) => captured.push(args) }, 'Long file '.repeat(30), 4);
  assert.equal(captured.length, 1); assert.deepEqual(captured[0].slice(1), [16, 16]);
  const element = captured[0][0];
  assert.equal(element.className, 'lxe:drag-preview'); assert.equal(element.attributes['aria-hidden'], 'true');
  assert.equal(element.children[0].textContent.length, 120); assert.equal(element.children[1].textContent, '+3');
  assert.equal(element.style['--explorer-panel'], '#172554'); assert.equal(env.children.length, 1);
  env.timersNow(); assert.equal(env.children.length, 0); cleanup(); assert.equal(env.timers.size, 0);
});

test('missing native drag-image support and failed snapshots leave no transient elements', () => {
  const env = environment();
  createExplorerDragPreview(undefined, {}, 'File', 1)();
  createExplorerDragPreview(env.host(), {}, 'File', 1)();
  createExplorerDragPreview(env.host(), { setDragImage() { throw new Error('Unsupported drag snapshot'); } }, 'File', 1)();
  assert.equal(env.children.length, 0); assert.equal(env.timers.size, 0);
});

test('viewport scrolling continues while held near or outside an edge and reverses with the pointer', () => {
  const env = environment(), host = env.host(), scroll = createExplorerViewportScroller(host);
  scroll.update({ x: 490, y: 490 }); env.frame();
  assert.ok(host.scrollLeft > 100); assert.ok(host.scrollTop > 100);
  const previous = host.scrollTop; env.frame(); assert.ok(host.scrollTop > previous, 'no additional pointer event required');
  scroll.update({ x: 550, y: 550 }); const outside = host.scrollTop; env.frame(); assert.ok(host.scrollTop > outside);
  scroll.update({ x: 50, y: 50 }); const beforeReverse = host.scrollTop; env.frame(); assert.ok(host.scrollTop < beforeReverse);
  scroll.update({ x: 300, y: 300 }); env.frame(); assert.equal(env.frames.size, 0);
  scroll.update({ x: 490, y: 490 }); scroll.stop(); assert.equal(env.frames.size, 0);
});

test('axis restrictions, visible browser clipping and disconnected targets keep scrolling scoped', () => {
  const env = environment(), tree = env.host('y', { left: 100, top: 100, right: 300, bottom: 1200 });
  const scroll = createExplorerViewportScroller(tree, 'y');
  scroll.update({ x: 900, y: 590 }); env.frame();
  assert.equal(tree.scrollLeft, 100); assert.ok(tree.scrollTop > 100, 'visible window bottom is used when the content extends below it');
  tree.isConnected = false; env.frame(); assert.equal(env.frames.size, 0);
  const tabs = env.host('x'), horizontal = createExplorerViewportScroller(tabs, 'x');
  horizontal.update({ x: 550, y: 550 }); env.frame(); assert.ok(tabs.scrollLeft > 100); assert.equal(tabs.scrollTop, 100); horizontal.stop();
});

test('native drag sessions switch between opted-in panes, retain outside direction and stop on drop', () => {
  const env = environment(), files = env.host(), tree = env.host('y');
  const cleanup = installExplorerDragAutoScroll(env.root);
  const event = (target, x, y, types = ['application/x-explorer']) => ({ target, clientX: x, clientY: y, dataTransfer: { types } });
  env.dispatch('dragover', event(files, 490, 490, ['text/plain'])); assert.equal(env.frames.size, 0);
  env.dispatch('dragover', event(files, 490, 490)); env.frame(); const previousFiles = files.scrollTop;
  env.dispatch('dragover', event(tree, 490, 490, ['Files'])); env.frame();
  assert.equal(files.scrollTop, previousFiles); assert.ok(tree.scrollTop > 100); assert.equal(tree.scrollLeft, 100);
  const previousTree = tree.scrollTop; env.dispatch('dragover', event({ closest: () => null }, 50, 50)); env.frame(); assert.ok(tree.scrollTop < previousTree);
  env.dispatch('drop', {}); assert.equal(env.frames.size, 0);
  cleanup(); assert.ok([...env.listeners.values()].every(set => set.size === 0));
});

test('Escape, browser leave, blur and cleanup stop native autoscroll without mutating data', () => {
  for (const end of ['Escape', 'leave', 'blur', 'cleanup']) {
    const env = environment(), files = env.host(), cleanup = installExplorerDragAutoScroll(env.root);
    env.dispatch('dragover', { target: files, clientX: 490, clientY: 490, dataTransfer: { types: ['Files'] } }); env.frame();
    if (end === 'Escape') env.dispatch('keydown', { key: 'Escape' });
    else if (end === 'leave') env.dispatch('dragleave', { target: env.document.documentElement, relatedTarget: null });
    else if (end === 'blur') env.blur(); else cleanup();
    assert.equal(env.frames.size, 0, end); cleanup();
  }
});
