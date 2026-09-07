import test from 'node:test';
import assert from 'node:assert/strict';
import { importTypeScript } from './import-typescript.mjs';

const { prepareDetachedDocument } = await importTypeScript('../src/state/detached-document.ts');

// Model just the public DOM operations used to mirror styles. Mutation records
// are delivered explicitly so changes can be checked independently of timers.
function documentHarness() {
  const observers = [];
  const document = { baseURI: 'https://example.test/app/', title: '', queries: 0, clones: 0 };
  class Node {
    constructor(tagName, nodeType = 1, text = '') {
      this.tagName = tagName.toUpperCase(); this.nodeType = nodeType; this.textContent = text;
      this.ownerDocument = document; this.parentNode = null; this.childNodes = [];
      this.attributes = {}; this.style = {};
    }
    get parentElement() { return this.parentNode?.nodeType === 1 ? this.parentNode : null; }
    get nextSibling() { return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null; }
    get isConnected() { return this === this.ownerDocument.documentElement || Boolean(this.parentNode?.isConnected); }
    get className() { return this.attributes.class ?? ''; }
    set className(value) { this.attributes.class = value; }
    get href() { return new URL(this.attributes.href ?? '', this.ownerDocument.baseURI).href; }
    set href(value) { this.attributes.href = value; }
    setAttribute(name, value) { this.attributes[name] = value; }
    appendChild(node) { return this.insertBefore(node, null); }
    insertBefore(node, next) {
      if (next === node) return node;
      if (next && next.parentNode !== this) throw Error('Reference is not a child');
      node.remove();
      const index = next ? this.childNodes.indexOf(next) : this.childNodes.length;
      this.childNodes.splice(index, 0, node); node.parentNode = this;
      const adopt = current => { current.ownerDocument = this.ownerDocument; current.childNodes.forEach(adopt); };
      adopt(node);
      return node;
    }
    remove() {
      if (this.parentNode) this.parentNode.childNodes.splice(this.parentNode.childNodes.indexOf(this), 1);
      this.parentNode = null;
    }
    replaceWith(node) { this.parentNode.insertBefore(node, this); this.remove(); }
    matches(selector) {
      return this.nodeType === 1 && selector.split(',').some(part => {
        const value = part.trim();
        return value === 'style' && this.tagName === 'STYLE' ||
          value === 'link' && this.tagName === 'LINK' ||
          value === 'link[rel="stylesheet"]' && this.tagName === 'LINK' && this.attributes.rel === 'stylesheet';
      });
    }
    closest(selector) { return this.matches(selector) ? this : this.parentElement?.closest(selector) ?? null; }
    querySelectorAll(selector) {
      return this.childNodes.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]);
    }
    querySelector(selector) { return this.querySelectorAll(selector)[0] ?? null; }
    cloneNode(deep) {
      this.ownerDocument.clones++;
      const clone = new Node(this.tagName, this.nodeType, this.textContent);
      clone.attributes = { ...this.attributes }; clone.style = { ...this.style };
      if (deep) this.childNodes.forEach(child => clone.appendChild(child.cloneNode(true)));
      return clone;
    }
    isEqualNode(other) {
      const snapshot = node => ({ tag: node.tagName, type: node.nodeType, text: node.textContent,
        attributes: node.attributes, children: node.childNodes.map(snapshot) });
      return JSON.stringify(snapshot(this)) === JSON.stringify(snapshot(other));
    }
  }
  document.createElement = tag => new Node(tag);
  document.createComment = text => new Node('#comment', 8, text);
  document.documentElement = new Node('html');
  document.head = document.documentElement.appendChild(new Node('head'));
  document.body = document.documentElement.appendChild(new Node('body'));
  document.querySelectorAll = selector => { document.queries++; return document.documentElement.querySelectorAll(selector); };
  document.defaultView = { MutationObserver: class {
    constructor(callback) { this.callback = callback; this.observed = []; this.disconnected = false; this.pending = []; observers.push(this); }
    observe(target, options) { this.observed.push({ target, options }); }
    disconnect() { this.disconnected = true; }
    takeRecords() { const records = this.pending; this.pending = []; return records; }
  } };
  const style = (id, parent = document.head) => {
    const node = document.createElement('style'); node.setAttribute('id', id); node.textContent = `.${id} { color: red; }`;
    parent.appendChild(node); return node;
  };
  return { document, observers, style,
    mutate(record) { for (const observer of observers) if (!observer.disconnected) observer.callback([record]); },
  };
}

const childList = (target, addedNodes = [], removedNodes = []) => ({ type: 'childList', target, addedNodes, removedNodes });
const attribute = (target, attributeName) => ({ type: 'attributes', target, attributeName });
const styles = document => document.head.querySelectorAll('style, link[rel="stylesheet"]');
const styleIds = document => styles(document).map(node => node.attributes.id);

test('detached documents inherit ordered CSS, absolute stylesheet URLs, language and theme classes', () => {
  const source = documentHarness(); const target = documentHarness();
  source.document.documentElement.lang = 'ja';
  source.document.documentElement.className = 'dark'; source.document.body.className = 'font-host';
  source.style('head');
  const link = source.document.createElement('link'); link.setAttribute('rel', 'stylesheet');
  link.setAttribute('id', 'linked'); link.setAttribute('href', './compiled.css'); source.document.head.appendChild(link);
  source.style('body', source.document.body);
  const result = prepareDetachedDocument(source.document, target.document);
  assert.deepEqual(styleIds(target.document), ['head', 'linked', 'body']);
  assert.equal(styles(target.document)[1].attributes.href, 'https://example.test/app/compiled.css');
  assert.equal(target.document.head.childNodes[0].tagName, 'BASE');
  assert.equal(target.document.head.childNodes[0].href, source.document.baseURI);
  assert.equal(target.document.documentElement.lang, 'ja');
  assert.equal(target.document.documentElement.className, 'dark');
  assert.equal(target.document.body.className, 'font-host');
  assert.equal(result.container.ownerDocument, target.document);
  assert.equal(result.container.isConnected, true); assert.equal(result.container.style.height, '100dvh');
  assert.equal(target.document.body.style.margin, '0');
  result.dispose(); assert.equal(source.observers[0].disconnected, true);
});

test('inserting, reordering and removing host styles preserves cascade order before child-owned styles', () => {
  const source = documentHarness(); const target = documentHarness();
  const a = source.style('A'); const b = source.style('B');
  const prepared = prepareDetachedDocument(source.document, target.document);
  const originalCopies = styles(target.document);
  const local = target.style('child-owned');
  const c = source.style('C'); source.document.head.insertBefore(c, b);
  source.mutate(childList(source.document.head, [c]));
  assert.deepEqual(styleIds(target.document), ['A', 'C', 'B', 'child-owned']);
  assert.equal(styles(target.document)[0], originalCopies[0]);
  assert.equal(styles(target.document)[2], originalCopies[1]);
  source.document.head.insertBefore(b, a);
  source.mutate(childList(source.document.head, [b], [b]));
  assert.deepEqual(styleIds(target.document), ['B', 'A', 'C', 'child-owned']);
  assert.equal(styles(target.document)[0], originalCopies[1]);
  a.remove(); source.mutate(childList(source.document.head, [], [a]));
  assert.deepEqual(styleIds(target.document), ['B', 'C', 'child-owned']);
  assert.equal(originalCopies[0].isConnected, false);
  assert.equal(target.document.head.childNodes.at(-1), local);
  assert.equal(local.textContent, '.child-owned { color: red; }');
  prepared.dispose();
});

test('style content and nested body stylesheet changes are mirrored without moving child-owned styles', () => {
  const source = documentHarness(); const target = documentHarness();
  const a = source.style('A');
  const prepared = prepareDetachedDocument(source.document, target.document);
  const local = target.style('child-owned');
  a.textContent = '.A { color: blue; }'; source.mutate(childList(a));
  assert.equal(styles(target.document)[0].textContent, '.A { color: blue; }');
  a.setAttribute('media', 'screen'); source.mutate(attribute(a, 'media'));
  assert.equal(styles(target.document)[0].attributes.media, 'screen');
  const wrapper = source.document.createElement('section'); source.document.body.appendChild(wrapper);
  source.style('B', wrapper); source.mutate(childList(source.document.body, [wrapper]));
  assert.deepEqual(styleIds(target.document), ['A', 'B', 'child-owned']);
  const link = source.document.createElement('link'); link.setAttribute('id', 'C');
  link.setAttribute('rel', 'stylesheet'); link.setAttribute('href', '/theme.css'); wrapper.appendChild(link);
  source.mutate(childList(wrapper, [link]));
  link.setAttribute('href', '/updated-theme.css'); source.mutate(attribute(link, 'href'));
  assert.equal(styles(target.document)[2].attributes.href, 'https://example.test/updated-theme.css');
  wrapper.remove(); source.mutate(childList(source.document.body, [], [wrapper]));
  assert.deepEqual(styleIds(target.document), ['A', 'child-owned']);
  assert.equal(target.document.head.childNodes.at(-1), local);
  prepared.dispose();
});

test('ordinary UI mutations do not rescan CSS while host theme changes and style text mutations do', () => {
  const source = documentHarness(); const target = documentHarness();
  const a = source.style('A'); const prepared = prepareDetachedDocument(source.document, target.document);
  const queries = source.document.queries;
  const input = source.document.createElement('input'); source.document.body.appendChild(input);
  source.mutate(childList(source.document.body, [input]));
  source.mutate(attribute(input, 'class'));
  source.mutate({ type: 'characterData', target: { nodeType: 3, parentElement: input } });
  assert.equal(source.document.queries, queries);
  source.document.body.className = 'new-font'; source.mutate(attribute(source.document.body, 'class'));
  source.document.documentElement.className = 'new-theme'; source.mutate(attribute(source.document.documentElement, 'class'));
  assert.equal(target.document.body.className, 'new-font');
  assert.equal(target.document.documentElement.className, 'new-theme');
  a.textContent = '.A { display: block; }';
  source.mutate({ type: 'characterData', target: { nodeType: 3, parentElement: a } });
  assert.equal(styles(target.document)[0].textContent, a.textContent);
  assert.deepEqual(source.observers[0].observed.map(item => item.target), [source.document.head, source.document.documentElement, source.document.body]);
  assert.equal(source.observers[0].observed[2].options.subtree, true);
  prepared.dispose();
  a.textContent = 'after dispose'; source.mutate(childList(a));
  assert.notEqual(styles(target.document)[0].textContent, a.textContent);
});

test('a document without MutationObserver still receives its initial stylesheet snapshot', () => {
  const source = documentHarness(); const target = documentHarness(); source.style('A');
  source.document.defaultView = null;
  const result = prepareDetachedDocument(source.document, target.document);
  assert.deepEqual(styleIds(target.document), ['A']); assert.equal(result.container.isConnected, true);
  assert.doesNotThrow(() => result.dispose());
});

test('one source observer serves every popup and survives individual target disposal', () => {
  const source = documentHarness(); const first = documentHarness(); const second = documentHarness();
  const a = source.style('A');
  const one = prepareDetachedDocument(source.document, first.document);
  const initialQueries = source.document.queries;
  const two = prepareDetachedDocument(source.document, second.document);
  assert.equal(source.observers.length, 1);
  assert.equal(source.document.queries, initialQueries, 'opening another target reuses the stylesheet index');
  one.dispose(); one.dispose();
  assert.equal(source.observers[0].disconnected, false);
  a.textContent = '.A { color: green; }'; source.mutate(childList(a));
  assert.notEqual(styles(first.document)[0].textContent, a.textContent);
  assert.equal(styles(second.document)[0].textContent, a.textContent);
  two.dispose();
  assert.equal(source.observers[0].disconnected, true);
  const third = documentHarness(); const three = prepareDetachedDocument(source.document, third.document);
  assert.equal(source.observers.length, 2, 'after the last target closes, a fresh subscription can start');
  assert.equal(styles(third.document)[0].textContent, a.textContent);
  three.dispose(); assert.equal(source.observers[1].disconnected, true);
});

test('class changes and edits of one stylesheet avoid full scans and cloning unrelated styles', () => {
  const source = documentHarness(); const first = documentHarness(); const second = documentHarness();
  const a = source.style('A'); source.style('B'); source.style('C');
  const one = prepareDetachedDocument(source.document, first.document);
  const two = prepareDetachedDocument(source.document, second.document);
  const firstCopies = styles(first.document); const secondCopies = styles(second.document);
  const queries = source.document.queries; const clones = source.document.clones;
  source.document.documentElement.className = 'dark'; source.mutate(attribute(source.document.documentElement, 'class'));
  source.document.body.className = 'new-font'; source.mutate(attribute(source.document.body, 'class'));
  assert.equal(source.document.queries, queries);
  assert.equal(source.document.clones, clones);
  assert.equal(first.document.documentElement.className, 'dark');
  assert.equal(second.document.body.className, 'new-font');
  a.textContent = '.A { color: blue; }'; source.mutate(childList(a));
  assert.equal(source.document.queries, queries, 'direct text edits use the existing stylesheet index');
  assert.equal(source.document.clones, clones + 3, 'one source snapshot and one clone per target');
  assert.equal(styles(first.document)[1], firstCopies[1]);
  assert.equal(styles(second.document)[2], secondCopies[2]);
  assert.equal(styles(first.document)[0].textContent, a.textContent);
  one.dispose(); two.dispose();
});

test('later subscribers flush pending stylesheet edits and rel changes update membership', () => {
  const source = documentHarness(); const first = documentHarness(); const second = documentHarness();
  const a = source.style('A');
  const link = source.document.createElement('link'); link.setAttribute('id', 'B'); link.setAttribute('href', '/b.css');
  source.document.head.appendChild(link);
  const one = prepareDetachedDocument(source.document, first.document);
  a.textContent = '.A { color: pink; }';
  source.observers[0].pending.push(childList(a));
  const two = prepareDetachedDocument(source.document, second.document);
  assert.equal(styles(first.document)[0].textContent, a.textContent);
  assert.equal(styles(second.document)[0].textContent, a.textContent);
  link.setAttribute('rel', 'stylesheet'); source.mutate(attribute(link, 'rel'));
  assert.deepEqual(styleIds(first.document), ['A', 'B']);
  assert.deepEqual(styleIds(second.document), ['A', 'B']);
  link.setAttribute('rel', 'preload'); source.mutate(attribute(link, 'rel'));
  assert.deepEqual(styleIds(first.document), ['A']);
  assert.deepEqual(styleIds(second.document), ['A']);
  one.dispose(); two.dispose();
});

test('an unavailable target cannot interrupt stylesheet updates for another popup', () => {
  const source = documentHarness(); const unavailable = documentHarness(); const available = documentHarness();
  const a = source.style('A');
  const one = prepareDetachedDocument(source.document, unavailable.document);
  const two = prepareDetachedDocument(source.document, available.document);
  unavailable.document.head.insertBefore = () => { throw new Error('Navigated target'); };
  a.textContent = '.A { color: orange; }';
  assert.doesNotThrow(() => source.mutate(childList(a)));
  assert.equal(styles(available.document)[0].textContent, a.textContent);
  one.dispose(); two.dispose();
});
