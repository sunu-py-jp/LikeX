import test from 'node:test';
import assert from 'node:assert/strict';
import { act, createElement as h, createRef, StrictMode } from 'react';
import { create } from 'react-test-renderer';
import { load, deferred, tick } from './helpers.mjs';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { LikeAIChat, createAIChat, createAIChatMessage } = await load('index');
const changed = fn => act(async () => { await fn(); });

function viewport({ resizeObserver = true } = {}) {
  const observers = [], listeners = new Set();
  class Observer {
    constructor(callback) { this.callback = callback; this.targets = new Set(); this.active = true; observers.push(this); }
    observe(target) { this.targets.add(target); }
    disconnect() { this.active = false; this.targets.clear(); }
  }
  const node = new EventTarget();
  Object.assign(node, {
    ownerDocument: { defaultView: resizeObserver ? { ResizeObserver: Observer } : {} },
    children: [{ name: 'user article' }, { name: 'assistant article' }],
    clientHeight: 400, scrollHeight: 1200, writes: 0,
  });
  let top = 0;
  Object.defineProperty(node, 'scrollTop', {
    get: () => top,
    set(value) { node.writes++; top = Math.max(0, Math.min(value, node.scrollHeight - node.clientHeight)); },
  });
  const add = node.addEventListener.bind(node), remove = node.removeEventListener.bind(node);
  node.addEventListener = (name, callback, options) => { if (name === 'scroll') listeners.add(callback); add(name, callback, options); };
  node.removeEventListener = (name, callback, options) => { if (name === 'scroll') listeners.delete(callback); remove(name, callback, options); };
  return {
    node, observers, listeners,
    scrollTo(value) { top = Math.max(0, Math.min(value, node.scrollHeight - node.clientHeight)); node.dispatchEvent(new Event('scroll')); },
    resize(values) { Object.assign(node, values); for (const observer of observers) if (observer.active) observer.callback([]); },
  };
}

async function mount(t, props = {}, options) {
  const env = viewport(options), ref = createRef();
  const initialAIChat = createAIChat({ id: 'chat', conversations: [
    { id: 'a', title: 'A', messages: [
      createAIChatMessage({ id: 'question', role: 'user', content: 'Question' }),
      createAIChatMessage({ id: 'answer', role: 'assistant', content: 'Answer' }),
    ] },
    { id: 'b', title: 'B', messages: [] },
  ] });
  let renderer, ended = false;
  await changed(() => { renderer = create(h(StrictMode, null, h(LikeAIChat, { ref, initialAIChat, onSave() {}, ...props })), {
    createNodeMock: element => element.props.className === 'lxai-transcript' ? env.node : null,
  }); });
  const unmount = async () => { if (!ended) { ended = true; await changed(() => renderer.unmount()); } };
  t.after(unmount);
  return { ...env, ref, unmount };
}

test('streaming follows the bottom, preserves a reader scrolling up, and resumes at the bottom', async t => {
  const next = deferred(), finish = deferred();
  const app = await mount(t, { onSend: async function* () {
    yield 'First'; await next.promise; yield ' second'; await finish.promise; yield ' final';
  } });
  assert.equal(app.node.scrollTop, 800);
  let task;
  await changed(() => { task = app.ref.current.send('Continue'); });
  await changed(tick);
  app.scrollTo(250); // The resulting scroll event is shared by wheel, PageUp, and scrollbar input.
  app.node.scrollHeight = 1500;
  await changed(async () => { next.resolve(); await tick(); });
  assert.equal(app.node.scrollTop, 250, 'stream chunks must not take the reading position away');
  app.scrollTo(1100);
  app.node.scrollHeight = 1700;
  await changed(async () => { finish.resolve(); await task; });
  assert.equal(app.node.scrollTop, 1300, 'returning to the bottom enables subsequent updates');
});

test('rich message and viewport resizes follow only while the reader remains at the bottom', async t => {
  const app = await mount(t);
  const observer = app.observers.find(item => item.active);
  assert.deepEqual([...observer.targets], [app.node, ...app.node.children]);
  app.resize({ scrollHeight: 1800 }); // Image load or expanded tool details changes the message height.
  assert.equal(app.node.scrollTop, 1400);
  app.resize({ clientHeight: 250 }); // Composer or host drawer changes the available height.
  assert.equal(app.node.scrollTop, 1550);
  app.scrollTo(500);
  app.resize({ scrollHeight: 2100, clientHeight: 350 });
  assert.equal(app.node.scrollTop, 500);
  app.scrollTo(1750);
  app.resize({ scrollHeight: 2250 });
  assert.equal(app.node.scrollTop, 1900);
});

test('a layout scroll event before resize delivery does not accidentally disable following', async t => {
  const app = await mount(t);
  app.node.scrollHeight = 1800;
  app.node.dispatchEvent(new Event('scroll'));
  app.resize({});
  assert.equal(app.node.scrollTop, 1400);
});

test('new user messages and conversation changes show the bottom but text edits preserve reading position', async t => {
  const app = await mount(t);
  app.scrollTo(200);
  app.node.scrollHeight = 1500;
  await changed(() => app.ref.current.execute({ type: 'message.update', conversationId: 'a', messageId: 'question', patch: { content: 'Edited question' } }));
  assert.equal(app.node.scrollTop, 200);
  await changed(() => app.ref.current.send('Another question'));
  assert.equal(app.node.scrollTop, 1100);
  app.scrollTo(300);
  await changed(() => app.ref.current.selectConversation('b'));
  assert.equal(app.node.scrollTop, 1100);
  app.scrollTo(100);
  await changed(() => app.ref.current.selectConversation('a'));
  assert.equal(app.node.scrollTop, 1100);
});

test('StrictMode reconnects one subscription and unmount disconnects even queued resize callbacks', async t => {
  const app = await mount(t);
  assert.ok(app.observers.length >= 2, 'StrictMode must exercise setup/cleanup/setup');
  assert.equal(app.observers.filter(item => item.active).length, 1);
  assert.equal(app.listeners.size, 1);
  app.scrollTo(100);
  await changed(() => app.ref.current.execute({ type: 'message.update', conversationId: 'a', messageId: 'answer', patch: { content: 'Updated' } }));
  assert.equal(app.node.scrollTop, 100);
  assert.equal(app.observers.filter(item => item.active).length, 1);
  assert.equal(app.listeners.size, 1);
  await app.unmount();
  assert.equal(app.observers.filter(item => item.active).length, 0);
  assert.equal(app.listeners.size, 0);
  const writes = app.node.writes;
  app.node.scrollHeight = 2500;
  for (const observer of app.observers) observer.callback([]);
  app.scrollTo(500);
  assert.equal(app.node.writes, writes, 'stale callbacks cannot write after cleanup');
});

test('message updates and user scrolling remain usable without ResizeObserver', async t => {
  const app = await mount(t, {}, { resizeObserver: false });
  assert.equal(app.node.scrollTop, 800);
  app.node.scrollHeight = 1600;
  await changed(() => app.ref.current.execute({ type: 'message.update', conversationId: 'a', messageId: 'answer', patch: { content: 'Longer answer' } }));
  assert.equal(app.node.scrollTop, 1200);
  app.scrollTo(300);
  app.node.scrollHeight = 1800;
  await changed(() => app.ref.current.execute({ type: 'message.update', conversationId: 'a', messageId: 'answer', patch: { content: 'Still longer' } }));
  assert.equal(app.node.scrollTop, 300);
});
