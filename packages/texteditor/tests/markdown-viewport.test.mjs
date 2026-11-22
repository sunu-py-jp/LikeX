import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from './helpers/build.mjs';

const output = await build({ stdin: { contents: `export * from './src/ui/markdown-viewport';
export { parseMarkdownDocument, markdownSchema } from './src/markdown/index';
export { EditorState, TextSelection, AllSelection } from 'prosemirror-state';`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const api = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
const { createMarkdownViewport, markdownViewportActive, markdownViewportUnits, estimateMarkdownBlockHeight, visibleRange,
  parseMarkdownDocument: parse, markdownSchema: schema, EditorState, TextSelection, AllSelection } = api;

const frames = [];
globalThis.requestAnimationFrame = callback => frames.push(callback);
globalThis.cancelAnimationFrame = id => { frames[id - 1] = null; };
const flushFrames = () => { for (const callback of frames.splice(0)) callback?.(); };
const paragraphs = (count, text = index => `段落 ${index}`) => Array.from({ length: count }, (_, index) => text(index)).join('\n\n');
const isList = node => node.type.name === 'bullet_list' || node.type.name === 'ordered_list';

// A stand-in for the browser: one element per block stacked top to bottom, at fixed heights for
// rendered blocks and at the styled height for placeholders. It follows ProseMirror's contract for
// node views: `update` decides whether an element is kept, otherwise the constructor runs again.
const REAL = { paragraph: 40, heading: 60, code_block: 80, horizontal_rule: 20, blockquote: 50, list_item: 30 };
class FakeElement {
  constructor(tag, owner) { this.nodeName = tag.toUpperCase(); this.nodeType = 1; this.ownerDocument = owner; this.children = []; this.attributes = {}; this.style = {}; this.className = ''; this.top = 0; }
  get classList() { return { contains: name => this.className.split(' ').includes(name) }; }
  setAttribute(name, value) { this.attributes[name] = value; if (name === 'class') this.className = value; }
  hasAttribute(name) { return name in this.attributes; }
  appendChild(child) { this.children.push(child); return child; }
  addEventListener() {} removeEventListener() {}
  get placeholder() { return this.classList.contains('lxte-rich-placeholder'); }
  get height() { return this.placeholder ? parseFloat(this.style.height) : this.items ? this.items.reduce((sum, item) => sum + item.height, 0) : REAL[this.block] ?? 40; }
  getBoundingClientRect() { this.page.layout(); return { top: this.top, bottom: this.top + this.height, height: this.height, width: 700 }; }
}
function createPage(source, { scrollerHeight = 600 } = {}) {
  const listeners = {}, calls = [];
  const fakeWindow = { innerHeight: scrollerHeight, addEventListener(type, handler) { listeners[type] = handler; }, removeEventListener(type) { delete listeners[type]; },
    getComputedStyle: () => ({ fontSize: '16px', lineHeight: '29.6px' }) };
  const owner = { defaultView: fakeWindow, createElement: tag => new FakeElement(tag, owner), createTextNode: text => ({ nodeType: 3, text }), activeElement: null, getSelection: () => domSelection };
  let domSelection = null;
  const scroller = { clientHeight: scrollerHeight, scrollTop: 0, hidden: false,
    getBoundingClientRect: () => scroller.hidden ? { top: 0, bottom: 0, width: 0, height: 0 } : { top: 0, bottom: scrollerHeight, width: 800, height: scrollerHeight } };
  const root = new FakeElement('div', owner); root.clientWidth = 700; root.contains = () => true; owner.activeElement = root;
  const viewport = createMarkdownViewport(() => scroller);
  let descs = [];
  const page = {
    layout() {
      let top = 48 - scroller.scrollTop;
      for (const element of root.children) {
        element.top = top;
        if (element.items) { let inner = top; for (const item of element.items) { item.top = inner; inner += item.height; } }
        top += element.height;
      }
    },
  };
  const create = (constructor, node, position, decorations) => {
    const spec = constructor ? constructor(node, view, () => position, decorations) : null, dom = spec?.dom ?? new FakeElement('div', owner);
    dom.page = page; dom.block = node.type.name;
    return { node, spec, dom, items: [] };
  };
  const view = {
    state: EditorState.create({ doc: parse(source) }), dom: root, composing: false, nodeViews: {},
    updateState(state) { this.state = state; this.render(); },
    dispatch(transaction) { viewport.updateState(this.state.apply(transaction)); },
    // The stand-in page selection names a document position directly.
    posAtDOM(node) { return node.position; }, coordsAtPos() { return { top: 100, bottom: 120 }; },
    setProps(props) { calls.push(Object.keys(props)); if (props.state) this.state = props.state; if (props.nodeViews && props.nodeViews !== this.nodeViews) { this.nodeViews = props.nodeViews; descs = []; } this.render(); },
    render() {
      const doc = this.state.doc, set = viewport.decorations(this.state, []), next = [];
      const exact = (from, to) => set.find(from, to).filter(decoration => decoration.from === from && decoration.to === to);
      const place = (previous, node, position, to) => {
        const decorations = exact(position, to), reuse = previous && previous.node.type === node.type && (previous.spec?.update ? previous.spec.update(node, decorations) : previous.node === node);
        const desc = reuse ? previous : create(this.nodeViews[node.type.name], node, position, decorations);
        desc.node = node; return desc;
      };
      doc.forEach((node, offset, index) => {
        const desc = place(descs[index], node, offset, offset + node.nodeSize);
        if (isList(node) && !desc.dom.placeholder) {
          const items = [];
          node.forEach((item, inner, itemIndex) => items.push(place(desc.items[itemIndex], item, offset + 1 + inner, offset + 1 + inner + item.nodeSize)));
          desc.items = items; desc.dom.children = items.map(item => item.dom); desc.dom.items = desc.dom.children;
        }
        next.push(desc);
      });
      descs = next; root.children = next.map(desc => desc.dom);
    },
  };
  view.nodeViews = viewport.nodeViews(view.state.doc); view.render(); viewport.attach(view);
  return {
    view, viewport, scroller, root, listeners, calls,
    pageCaret(position) { domSelection = position === null ? null : { focusNode: { position }, anchorNode: { position }, focusOffset: 0, anchorOffset: 0, isCollapsed: true }; },
    real: (elements = root.children) => elements.flatMap((element, index) => element.placeholder ? [] : [index]),
    scrollTo(top) { scroller.scrollTop = top; listeners.scroll({ target: scroller }); },
    select(position) { viewport.updateState(view.state.apply(view.state.tr.setSelection(TextSelection.create(view.state.doc, position)))); flushFrames(); },
    positionOf(index) { let position = 0; for (let child = 0; child < index; child++) position += view.state.doc.child(child).nodeSize; return position; },
  };
}

test('small documents render every block and keep their decorations untouched', () => {
  const page = createPage(paragraphs(50));
  assert.equal(page.viewport.isActive(), false);
  assert.deepEqual(page.view.nodeViews, {});
  assert.equal(page.viewport.decorations(page.view.state, []).find().length, 0);
  assert.equal(page.real().length, 50);
  assert.equal(markdownViewportActive(parse(paragraphs(399))), false);
  assert.equal(markdownViewportActive(parse(paragraphs(400))), true);
  assert.equal(markdownViewportActive(parse(paragraphs(250)), true), true, 'a windowed document stays windowed until it is clearly small');
  assert.equal(markdownViewportActive(parse(paragraphs(199)), true), false);
  assert.equal(markdownViewportActive(parse(paragraphs(40, () => 'x'.repeat(6000)))), true, 'few but very long blocks count by size');
});

test('a large document renders only the blocks near the viewport and follows scrolling', () => {
  const page = createPage(paragraphs(3000));
  assert.equal(page.viewport.isActive(), true);
  let real = page.real();
  assert.equal(page.root.children.length, 3000, 'every block keeps one element, so positions map one to one');
  assert.ok(real.length >= 15 && real.length < 80, `${real.length} blocks rendered`);
  assert.equal(real[0], 0);
  assert.ok(real.at(-1) >= 29, 'the screen and the overscan below it are rendered');

  page.scrollTo(40000);
  real = page.real();
  assert.ok(real.length < 80, `${real.length} blocks rendered after scrolling`);
  const first = page.root.children[real[0]].getBoundingClientRect(), last = page.root.children[real.at(-1)].getBoundingClientRect();
  assert.ok(first.top <= -300 && last.bottom >= 900, 'rendered blocks cover the screen with a margin on both sides');
  assert.equal(page.root.children[5].placeholder, true);
  assert.equal(page.root.children[5].style.height, '40px', 'a block that was rendered keeps its measured height');
  assert.equal(page.root.children[5].attributes['aria-hidden'], 'true');

  const before = page.calls.length;
  page.scrollTo(40100);
  assert.equal(page.calls.length, before, 'a small scroll inside the rendered margin changes nothing');
  page.scrollTo(0);
  assert.equal(page.real()[0], 0);
});

test('the caret block and its neighbours are always rendered, also far from the viewport', () => {
  const page = createPage(paragraphs(3000));
  page.select(page.positionOf(2500) + 1);
  const real = page.real();
  for (const index of [2499, 2500, 2501]) assert.ok(real.includes(index), `block ${index} is rendered`);
  assert.equal(page.root.children[2498].placeholder, true);
  assert.ok(real.includes(0), 'the viewport is still rendered');

  const all = EditorState.create({ doc: page.view.state.doc, selection: new AllSelection(page.view.state.doc) });
  const units = markdownViewportUnits(all.doc, all.selection, { top: [10, 12], lists: [] });
  assert.deepEqual([...units.keys()].sort((a, b) => a - b), [0, 1, 10, 11, 12, 2998, 2999]);
});

test('a very long list renders only the items near the viewport', () => {
  const source = `# Title\n\n${Array.from({ length: 5000 }, (_, index) => `- item ${index}`).join('\n')}\n\nAfter the list`;
  const page = createPage(source);
  assert.equal(page.viewport.isActive(), true);
  const list = page.root.children[1];
  assert.equal(list.placeholder, false);
  assert.equal(list.children.length, 5000);
  let items = page.real(list.children);
  assert.ok(items.length > 20 && items.length < 100, `${items.length} items rendered`);
  assert.equal(list.children[4000].nodeName, 'LI', 'item placeholders stay list items so numbering and markup remain valid');

  page.scrollTo(90000);
  items = page.real(list.children);
  // Item 0 stays rendered: the caret is in the heading right before it.
  assert.equal(items[0], 0);
  assert.ok(items.length < 100 && items[1] > 1000, `items ${items[1]}..${items.at(-1)} rendered`);
  assert.ok(list.children[items[1]].getBoundingClientRect().top <= -300 && list.children[items.at(-1)].getBoundingClientRect().bottom >= 900);
  assert.equal(list.children[10].style.height, '30px', 'an item that was rendered keeps its measured height');

  const doc = page.view.state.doc, inside = TextSelection.create(doc, page.positionOf(1) + 1 + 4 * doc.child(1).child(0).nodeSize + 3);
  const units = markdownViewportUnits(doc, inside, { top: [0, 0], lists: [] });
  assert.deepEqual([...units.get(1)].sort(), [3, 4, 5], 'the item with the caret and the items around it');
  const edge = markdownViewportUnits(doc, TextSelection.create(doc, 3), { top: [2, 2], lists: [] });
  assert.deepEqual([...edge.get(1)], [0], 'the block after a heading is the first list item');
});

test('windowing switches on and off with the document being shown', () => {
  const page = createPage(paragraphs(20));
  const large = EditorState.create({ doc: parse(paragraphs(2000)) });
  page.viewport.updateState(large); flushFrames();
  assert.equal(page.viewport.isActive(), true);
  assert.ok(page.real().length < 80);
  assert.ok(page.calls.some(keys => keys.includes('state') && keys.includes('nodeViews')), 'the mode and the document change in one update');
  page.viewport.updateState(EditorState.create({ doc: parse(paragraphs(30)) })); flushFrames();
  assert.equal(page.viewport.isActive(), false);
  assert.equal(page.real().length, 30);
});

test('printing, hidden views and an unexpected page structure never leave content unrendered', () => {
  const page = createPage(paragraphs(1000));
  page.listeners.beforeprint();
  assert.equal(page.real().length, 1000, 'everything is rendered for printing');
  page.listeners.afterprint();
  assert.ok(page.real().length < 80);
  assert.equal(page.root.children[900].style.height, '40px', 'heights measured while everything was rendered are kept');

  page.scroller.hidden = true;
  const before = page.calls.length;
  page.scrollTo(20000);
  assert.equal(page.calls.length, before, 'a view that is not displayed keeps what it has');
  page.scroller.hidden = false;

  page.view.composing = true;
  page.scrollTo(21000);
  assert.equal(page.calls.length, before, 'no rebuild during an IME composition');
  page.view.composing = false;
  page.scrollTo(21000);
  assert.ok(page.calls.length > before);

  page.root.children = page.root.children.slice(1);
  page.scrollTo(0);
  assert.equal(page.viewport.isActive(), false);
  assert.equal(page.real().length, 1000);
  page.viewport.destroy();
});

test('height estimates grow with text and full-width characters; visibleRange finds the on-screen children', () => {
  const short = schema.nodes.paragraph.create(null, schema.text('short')), long = schema.nodes.paragraph.create(null, schema.text('word '.repeat(400)));
  const wide = schema.nodes.paragraph.create(null, schema.text('全角の文章'.repeat(400)));
  assert.ok(estimateMarkdownBlockHeight(short) < estimateMarkdownBlockHeight(long));
  assert.ok(estimateMarkdownBlockHeight(long) < estimateMarkdownBlockHeight(wide));
  assert.ok(estimateMarkdownBlockHeight(long, 350) > estimateMarkdownBlockHeight(long, 700));
  assert.ok(estimateMarkdownBlockHeight(schema.nodes.code_block.create(null, schema.text('a\nb\nc\nd'))) > estimateMarkdownBlockHeight(schema.nodes.code_block.create(null, schema.text('a'))));
  const rect = index => ({ top: index * 10, bottom: index * 10 + 10 });
  assert.deepEqual(visibleRange(100, rect, 95, 205), [9, 20]);
  assert.deepEqual(visibleRange(100, rect, -50, 5), [0, 0]);
  assert.deepEqual(visibleRange(100, rect, 5000, 6000), [99, 99], 'past the end falls back to the last child');
  assert.deepEqual(visibleRange(1, rect, -100, -50), [0, 0]);
});

test('a caret key first takes over the caret the page has and renders the blocks around it', () => {
  const page = createPage(paragraphs(3000));
  assert.equal(page.view.state.selection.head, 1);
  // The browser already moved the caret into block 20; the editor state has not heard of it yet.
  page.pageCaret(page.positionOf(20) + 3);
  page.viewport.prepareNavigation(false);
  assert.equal(page.view.state.selection.head, page.positionOf(20) + 3, 'a rebuild must not put the older selection back');
  for (const index of [19, 20, 21]) assert.equal(page.root.children[index].placeholder, false);

  // A caret left between unrendered blocks resolves to the text of the next block, which is then rendered.
  assert.equal(page.root.children[1500].placeholder, true);
  page.pageCaret(page.positionOf(1500));
  page.viewport.prepareNavigation(false);
  assert.equal(page.view.state.selection.head, page.positionOf(1500) + 1);
  for (const index of [1499, 1500, 1501]) assert.equal(page.root.children[index].placeholder, false);

  // Without a page selection, or outside a windowed document, nothing happens.
  page.pageCaret(null);
  const before = page.calls.length;
  page.viewport.prepareNavigation(true);
  assert.equal(page.calls.length, before);
  const small = createPage(paragraphs(10));
  small.pageCaret(5);
  small.viewport.prepareNavigation(false);
  assert.equal(small.view.state.selection.head, 1);
});
