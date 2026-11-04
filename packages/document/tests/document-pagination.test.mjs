import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `export * from './src/ui/document-pagination';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { calculateDocumentPagination, createDocumentPagination, createPageBreakNodeView } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);

test('stored boundaries provide paper margins and gaps without inventing breaks', () => {
  const plan = calculateDocumentPagination([200, 400], 600, 1000, 75, 75);
  assert.deepEqual(plan.papers, [{ top: 0, height: 1000 }, { top: 1024, height: 1000 }, { top: 2048, height: 1000 }]);
  assert.deepEqual(plan.spacers, [899, 824]);
  assert.equal(plan.height, 3048);
  assert.deepEqual(calculateDocumentPagination([], 2500, 1000, 75, 75).papers, [{ top: 0, height: 2500 }], 'long content without a boundary stays on one expanding paper');
  assert.deepEqual(calculateDocumentPagination([1800], 2200, 1000, 75, 75), {
    papers: [{ top: 0, height: 1875 }, { top: 1899, height: 1000 }], spacers: [174], height: 2899,
  });
});

test('consecutive boundaries keep empty pages and long last pages can shrink again', () => {
  assert.deepEqual(calculateDocumentPagination([75, 75], 150, 1000, 75, 75), {
    papers: [{ top: 0, height: 1000 }, { top: 1024, height: 1000 }, { top: 2048, height: 1000 }], spacers: [1024, 1024], height: 3048,
  });
  assert.equal(calculateDocumentPagination([200], 2500, 1000, 75, 75).papers[1].height, 2375);
  assert.equal(calculateDocumentPagination([200], 300, 1000, 75, 75).papers[1].height, 1000);
});

class Element extends EventTarget {
  attributes = new Map();
  children = [];
  style = { minHeight: '', height: '', top: '', removeProperty(name) { delete this[name]; } };
  isConnected = true;
  constructor(doc) { super(); this.ownerDocument = doc; }
  setAttribute(name, value) { this.attributes.set(name, value); }
  removeAttribute(name) { this.attributes.delete(name); }
  hasAttribute(name) { return this.attributes.has(name); }
  appendChild(child) { this.children.push(child); child.parentElement = this; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(child => child !== this); }
}

function fixture({ offsets = [200], height = 400, scale = 1, table = false } = {}) {
  const win = new EventTarget(), frames = new Map(), observers = [], attributeObservers = [];
  let serial = 0, measured = 0, completed = 0, naturalHeight = height, zoom = scale;
  let maxScroll = 0, scrollTop = 0, scrollLeft = 0, clamped = 0;
  const scrollAtLayout = [];
  const viewport = {
    get scrollTop() { return scrollTop; }, set scrollTop(value) { scrollTop = Math.max(0, Math.min(maxScroll, value)); },
    get scrollLeft() { return scrollLeft; }, set scrollLeft(value) { scrollLeft = Math.max(0, Math.min(1000, value)); },
  };
  Object.assign(win, {
    requestAnimationFrame(callback) { const id = ++serial; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    getComputedStyle() { return { width: '800' }; },
    ResizeObserver: class {
      targets = new Set();
      constructor(callback) { this.callback = callback; observers.push(this); }
      observe(element) { this.targets.add(element); }
      unobserve(element) { this.targets.delete(element); }
      disconnect() { this.targets.clear(); }
    },
    MutationObserver: class {
      targets = new Set();
      constructor(callback) { this.callback = callback; attributeObservers.push(this); }
      observe(element) { this.targets.add(element); }
      disconnect() { this.targets.clear(); }
    },
  });
  const fonts = new EventTarget(); fonts.ready = new Promise(() => {});
  const doc = { defaultView: win, fonts, createElement() { return new Element(doc); } };
  const root = new Element(doc), layer = new Element(doc), container = new Element(doc), block = new Element(doc);
  container.setAttribute('data-likex-document', ''); container.appendChild(root); root.appendChild(block);
  let model = {};
  const view = { dom: root, get state() { return { doc: model }; } };
  const page = { width: 800 * 25.4 / 96, height: 1000 * 25.4 / 96, margins: { top: 75 * 25.4 / 96, right: 75 * 25.4 / 96, bottom: 75 * 25.4 / 96, left: 75 * 25.4 / 96 } };
  const markers = offsets.map((offset, index) => {
    const element = new Element(doc); element.inTable = table && index === offsets.length - 1;
    element.closest = () => element.inTable ? {} : null;
    element.getBoundingClientRect = () => ({ top: 50 - scrollTop + zoom * (offset + markers.slice(0, index).reduce((sum, marker) => sum + (marker.inTable ? 0 : parseFloat(marker.style.height) || 0), 0)) });
    return element;
  });
  const added = () => markers.reduce((sum, marker) => sum + (marker.inTable ? 0 : parseFloat(marker.style.height) || 0), 0);
  root.closest = () => viewport;
  root.querySelectorAll = () => markers;
  root.getBoundingClientRect = () => {
    measured++;
    const height = Math.max(parseFloat(root.style.minHeight) || 0, naturalHeight + added()) * zoom;
    maxScroll = Math.max(0, height - 400);
    if (scrollTop > maxScroll) { scrollTop = maxScroll; clamped++; }
    return { top: 50 - scrollTop, width: 800 * zoom, height };
  };
  block.getBoundingClientRect = () => ({ width: 650 * zoom, height: (naturalHeight + added() - 150) * zoom });
  layer.getBoundingClientRect = () => ({ top: 50 - scrollTop });
  const pagination = createDocumentPagination(view, layer, () => page, () => { completed++; scrollAtLayout.push({ top: scrollTop, left: scrollLeft }); });
  return { root, layer, markers, frames, observers, attributeObservers, win, fonts, pagination, viewport, scrollAtLayout,
    get clamped() { return clamped; },
    get measured() { return measured; }, get completed() { return completed; },
    replace(nextHeight) { naturalHeight = nextHeight; model = {}; },
    reflow(nextHeight) { naturalHeight = nextHeight; },
    zoom(value) { zoom = value; attributeObservers[0].callback(); },
    notifyResize() { for (const observer of observers) observer.callback([...observer.targets].map(target => ({ target }))); },
  };
}

test('DOM layout compensates zoom, skips table markers and never edits the model', () => {
  const f = fixture({ offsets: [200, 300], scale: 1.5, table: true });
  f.pagination.update();
  assert.equal(f.layer.children.length, 2);
  assert.equal(f.layer.children[0].style.height, '1000px');
  assert.equal(f.layer.children[1].style.top, '1024px');
  assert.equal(f.markers[0].style.height, '899px');
  assert.equal(f.markers[1].attributes.get('data-lxd-page-boundary-in-table'), 'true');
  assert.equal(f.markers[1].style.height, undefined);
  assert.equal(f.root.style.minHeight, '2024px');
  f.zoom(.5); f.pagination.update();
  assert.equal(f.markers[0].style.height, '899px');
  assert.equal(f.layer.children[1].style.top, '1024px');
  f.pagination.destroy();
});

test('selection-only updates and own resize notifications do not cause layout loops', () => {
  const f = fixture(); f.pagination.update();
  const measured = f.measured, completed = f.completed;
  f.pagination.update();
  assert.equal(f.measured, measured); assert.equal(f.completed, completed);
  f.notifyResize(); assert.equal(f.frames.size, 0);
  f.reflow(450); f.notifyResize(); assert.equal(f.frames.size, 1, 'content dimensions, even below paper min-height, trigger layout');
  f.pagination.update(); assert.equal(f.frames.size, 0); assert.equal(f.completed, completed + 1);
  f.notifyResize(); assert.equal(f.frames.size, 0);
  f.root.dispatchEvent(new Event('load')); f.win.dispatchEvent(new Event('resize')); f.fonts.dispatchEvent(new Event('loadingdone'));
  assert.equal(f.frames.size, 1, 'independent changes share one animation frame');
  f.pagination.destroy(); assert.equal(f.frames.size, 0);
  assert.equal(f.root.style.minHeight, ''); assert.equal(f.layer.children.length, 0);
  assert.equal(f.observers[0].targets.size, 0); assert.equal(f.attributeObservers[0].targets.size, 0);
  f.win.dispatchEvent(new Event('resize')); f.root.dispatchEvent(new Event('load')); f.fonts.dispatchEvent(new Event('loadingdone'));
  assert.equal(f.frames.size, 0);
});

test('DOM measurement discards old min-height so deleting content shrinks the paper', () => {
  const f = fixture({ height: 2500 }); f.pagination.update();
  assert.equal(f.layer.children[1].style.height, '2375px');
  f.replace(300); f.pagination.update();
  assert.equal(f.layer.children[1].style.height, '1000px'); assert.equal(f.root.style.minHeight, '2024px');
  f.pagination.destroy();
});

test('temporary measurement clamping does not move the viewport, while a real shrink clamps naturally', () => {
  const f = fixture({ height: 2500 }); f.pagination.update();
  f.viewport.scrollTop = 2500; f.viewport.scrollLeft = 120;
  f.replace(2400); f.pagination.update();
  assert.ok(f.clamped > 0, 'the mock viewport actually clamped while spacers were collapsed');
  assert.equal(f.viewport.scrollTop, 2500); assert.equal(f.viewport.scrollLeft, 120);
  assert.deepEqual(f.scrollAtLayout.at(-1), { top: 2500, left: 120 }, 'caller reveals run only after restoring the viewport');
  f.replace(300); f.pagination.update();
  assert.equal(f.viewport.scrollTop, 1624, 'the final 2024px document clamps to its real 400px viewport');
  assert.equal(f.viewport.scrollLeft, 120);
  assert.deepEqual(f.scrollAtLayout.at(-1), { top: 1624, left: 120 });
  f.pagination.destroy();
});

test('boundary node views isolate layout mutations but preserve selection handling and IDs', () => {
  const doc = { createElement() { return new Element(doc); } }, view = { dom: { ownerDocument: doc } };
  for (const name of ['page_break', 'rendered_page_break']) {
    const type = { name }, node = { type, attrs: { id: name === 'page_break' ? 'manual' : null } };
    const nodeView = createPageBreakNodeView(node, view, () => 1, [], {});
    assert.equal(nodeView.dom.attributes.get('contenteditable'), 'false');
    assert.equal(nodeView.dom.attributes.get('data-lxd-page-boundary'), name === 'page_break' ? 'explicit' : 'rendered');
    assert.equal(nodeView.ignoreMutation({ type: 'attributes', target: nodeView.dom }), true);
    assert.equal(nodeView.ignoreMutation({ type: 'selection', target: nodeView.dom }), false);
    assert.equal(nodeView.update({ type, attrs: { id: 'updated' } }), true);
    assert.equal(nodeView.dom.attributes.get('data-document-id'), 'updated');
    assert.equal(nodeView.update({ type: { name: 'paragraph' }, attrs: {} }), false);
  }
});
