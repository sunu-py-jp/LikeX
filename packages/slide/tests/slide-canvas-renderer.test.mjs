import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';

const output = await build({ stdin: { contents: `
  export { renderSlideImage } from './src/render/canvas-renderer';
  export { wrapSlideText } from './src/render/render-style';
  export { createSlideDeck, createSlideElement } from './src/model';
`, resolveDir: new URL('../', import.meta.url).pathname }, bundle: true, platform: 'node', format: 'esm', write: false });
const { renderSlideImage, wrapSlideText, createSlideDeck, createSlideElement } = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text + '\n//# sourceURL=slide-canvas-renderer-test.js').toString('base64')}`);
const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACgAAAAUCAIAAABwJOjsAAAAOElEQVR4nO3NQQEAIAwDsVINSMS/BfhuBm4PGgNZ92xN8MiqxCCTWZUYY67qEmPMVV1ijLlKn8cPnj8Bn7y225YAAAAASUVORK5CYII=';
const gif = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 1e-6, `${actual} ≈ ${expected}`);

test('text wrapping retains graphemes, explicit blank lines, whole words and Japanese punctuation', () => {
  const segmenter = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  const measure = value => [...segmenter.segment(value)].length;
  assert.deepEqual(wrapSlideText('abc def', 4, measure), ['abc ', 'def']);
  assert.deepEqual(wrapSlideText('a\r\n\r\nb', 4, measure), ['a', '', 'b']);
  assert.deepEqual(wrapSlideText('日本語。', 3, measure), ['日本', '語。']);
  assert.deepEqual(wrapSlideText('日本「語」', 3, measure), ['日本', '「語」']);
  assert.deepEqual(wrapSlideText('👨‍👩‍👦e\u0301日', 1, measure), ['👨‍👩‍👦', 'e\u0301', '日']);
});

test('a long unbroken word in a narrow text box has bounded measurement work', () => {
  const text = 'a'.repeat(10_000); let measuredCharacters = 0;
  const lines = wrapSlideText(text, 1, value => { measuredCharacters += value.length; return value.length; });
  assert.equal(lines.length, text.length);
  assert.equal(lines.join(''), text);
  assert.ok(measuredCharacters < text.length * 8, `measured ${measuredCharacters} characters`);
});

function request(elements = [], options = {}) {
  const deck = createSlideDeck({ id: 'deck', width: 800, height: 600, slides: [{ id: 'page', name: 'Page', background: '#abcdef', notes: '', elements: elements.map(createSlideElement) }] });
  return { deck, slide: deck.slides[0], pageNumber: 1, width: 800, height: 600, scale: 1, format: 'png', ...options };
}

function environment(t, options = {}) {
  const keys = ['document', 'Image', 'ImageDecoder', 'createImageBitmap', 'setTimeout', 'clearTimeout'];
  const previous = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const calls = [], images = [], canvases = [], fontLoads = [], timers = new Map();
  const nativeSetTimeout = globalThis.setTimeout, nativeClearTimeout = globalThis.clearTimeout;
  globalThis.setTimeout = (callback, milliseconds, ...args) => {
    if (milliseconds !== 30_000) return nativeSetTimeout(callback, milliseconds, ...args);
    const token = {}; timers.set(token, () => callback(...args)); return token;
  };
  globalThis.clearTimeout = token => { if (!timers.delete(token)) nativeClearTimeout(token); };
  const measure = text => [...text].reduce((width, character) => width + (character.codePointAt(0) > 127 ? 20 : 10), 0);
  function createContext(canvasIndex) {
    const state = { font: '10px sans-serif', textAlign: 'left', textBaseline: 'alphabetic', fillStyle: '#000', strokeStyle: '#000', globalAlpha: 1, lineWidth: 1 };
    const stack = [];
    const record = (name, args = []) => calls.push({ name, args, canvasIndex, state: { ...state } });
    const context = new Proxy(state, {
      get(target, key) {
        if (key in target) return target[key];
        if (key === 'measureText') return text => ({ width: measure(text), actualBoundingBoxAscent: 16, actualBoundingBoxDescent: 4 });
        if (key === 'save') return () => { stack.push({ ...state }); record('save'); };
        if (key === 'restore') return () => { Object.assign(state, stack.pop()); record('restore'); };
        return (...args) => record(key, args);
      },
      set(target, key, value) { target[key] = value; return true; },
    });
    return { context, record };
  }
  class MockImage {
    naturalWidth = options.imageWidth ?? 40;
    naturalHeight = options.imageHeight ?? 20;
    width = this.naturalWidth;
    height = this.naturalHeight;
    complete = false;
    onload = null;
    onerror = null;
    _src = '';
    constructor() { images.push(this); }
    set src(value) {
      this._src = value;
      if (value && !options.holdImages) queueMicrotask(() => {
        if (options.imageError) this.onerror?.(new Error('bad image'));
        else { this.complete = true; this.onload?.(); }
      });
    }
    get src() { return this._src; }
    removeAttribute(name) { if (name === 'src') this._src = ''; }
    decode() { return options.imageDecode?.promise ?? (options.imageError ? Promise.reject(new Error('bad image')) : Promise.resolve()); }
    load() { this.complete = true; this.onload?.(); }
  }
  const document = {
    fonts: { ready: options.fontReady?.promise ?? Promise.resolve(), load(font, text) { fontLoads.push({ font, text }); return options.fontLoad?.promise ?? Promise.resolve([]); } },
    createElement(name) {
      if (name === 'img') return new MockImage();
      assert.equal(name, 'canvas');
      const { context, record } = createContext(canvases.length);
      const canvas = { width: 0, height: 0, getContext(kind) { assert.equal(kind, '2d'); return options.noContext ? null : context; },
        toBlob(callback, mime) {
          record('toBlob', [mime]);
          if (options.toBlob) options.toBlob(callback, mime);
          else callback(new Blob(['png'], { type: mime }));
        }, remove() { this.removed = true; } };
      canvases.push(canvas); return canvas;
    },
  };
  globalThis.document = document;
  globalThis.Image = MockImage;
  globalThis.ImageDecoder = options.imageDecoder;
  globalThis.createImageBitmap = undefined;
  t.after(() => { for (const [key, descriptor] of previous) { if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; } });
  return { calls, images, canvases, document, fontLoads, timers,
    named(name) { return calls.filter(call => call.name === name); },
    timeout() { const pending = [...timers.values()]; timers.clear(); for (const callback of pending) callback(); },
  };
}

test('PNG canvas renders background and elements in model order with scaled rotation and isolated opacity', async t => {
  const env = environment(t);
  const value = request([
    { type: 'shape', shape: 'rect', id: 'back', x: 30, y: 40, width: 100, height: 80, rotation: 90, opacity: .4, fill: '#123456' },
    { type: 'shape', shape: 'ellipse', id: 'front', x: 80, y: 70, width: 50, height: 40, fill: '#654321' },
  ], { width: 1600, height: 1200, scale: 2 });
  const before = JSON.stringify(value.deck);
  const blob = await renderSlideImage(value);
  assert.equal(blob.type, 'image/png'); assert.equal(blob.size, 3);
  assert.equal(JSON.stringify(value.deck), before);
  assert.ok(env.named('fillRect').some(call => call.state.fillStyle === '#abcdef'));
  assert.ok(env.named('scale').some(call => call.args[0] === 2 && call.args[1] === 2));
  const rotated = env.named('rotate').find(call => call.args[0] !== 0);
  near(rotated.args[0], Math.PI / 2);
  const fills = env.named('fill').filter(call => ['#123456', '#654321'].includes(call.state.fillStyle));
  assert.deepEqual(fills.map(call => call.state.fillStyle), ['#123456', '#654321']);
  assert.deepEqual(fills.map(call => call.state.globalAlpha), [1, 1], 'fill and stroke render opaque before their group is composited');
  const composite = env.named('drawImage').find(call => call.args[0] === env.canvases[1]);
  assert.equal(composite.canvasIndex, 0); assert.equal(composite.state.globalAlpha, .4);
  assert.ok(env.calls.indexOf(fills[0]) < env.calls.indexOf(composite));
  assert.ok(env.calls.indexOf(composite) < env.calls.indexOf(fills[1]));
  assert.equal(env.timers.size, 0);
  assert.ok(env.canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
});

test('every supported shape keeps its distinct path and transparent fills do not cover lower layers', async t => {
  const env = environment(t);
  await renderSlideImage(request(['rect', 'roundRect', 'ellipse', 'triangle', 'diamond', 'arrow', 'line'].map((shape, index) => ({ type: 'shape', id: shape, shape, x: index * 100, width: 100, height: 80, strokeWidth: 2, stroke: '#123456', fill: 'transparent' }))));
  assert.ok(env.named('rect').some(call => call.args[0] === 1 && call.args[1] === 1 && call.args[2] === 98 && call.args[3] === 78));
  assert.ok(env.named('roundRect').length || env.named('quadraticCurveTo').length || env.named('arcTo').length, 'rounded rectangle has curved corners');
  assert.ok(env.named('ellipse').some(call => call.args[0] === 50 && call.args[1] === 40 && call.args[2] === 49 && call.args[3] === 39));
  for (const [x, y] of [[50, 1], [99, 79], [1, 79], [99, 40], [50, 79], [1, 40], [65, 22.4], [65, 1], [65, 57.6]]) {
    assert.ok([...env.named('moveTo'), ...env.named('lineTo')].some(call => Math.abs(call.args[0] - x) < 1e-6 && Math.abs(call.args[1] - y) < 1e-6), `${x},${y} path point`);
  }
  assert.ok(env.named('lineTo').some(call => call.args[0] === 99 && call.args[1] === 79));
  assert.equal(env.named('stroke').length, 7);
  assert.equal(env.named('fill').length, 0);
});

test('embedded images use contain sizing and finish decoding before PNG serialization', async t => {
  const env = environment(t, { holdImages: true });
  const pending = renderSlideImage(request([{ type: 'image', src: png, x: 20, y: 30, width: 100, height: 100, opacity: .6 }]));
  await flush();
  assert.equal(env.named('drawImage').length, 0); assert.equal(env.named('toBlob').length, 0);
  assert.equal(env.images.length, 1);
  env.images[0].load();
  await pending;
  const args = env.named('drawImage')[0].args;
  assert.equal(args[0], env.images[0]);
  assert.deepEqual(args.slice(-4), [0, 25, 100, 50]);
  assert.equal(env.named('drawImage')[0].state.globalAlpha, .6);
  assert.ok(env.calls.findIndex(call => call.name === 'drawImage') < env.calls.findIndex(call => call.name === 'toBlob'));
  assert.equal(env.timers.size, 0);
  assert.equal(env.images[0].src, ''); assert.equal(env.images[0].onload, null); assert.equal(env.images[0].onerror, null);
});

test('text retains Japanese wrapping, explicit line breaks, font style and horizontal alignment', async t => {
  const env = environment(t);
  await renderSlideImage(request([
    { type: 'text', id: 'jp', text: '日本語文\n次行', fontSize: 20, fontFamily: 'Yu Gothic', width: 60, height: 180, align: 'center', verticalAlign: 'middle', bold: true, italic: true },
    { type: 'text', id: 'right', text: 'ABC', x: 200, fontSize: 20, width: 100, height: 100, align: 'right', verticalAlign: 'bottom' },
    { type: 'text', id: 'left', text: 'Left', x: 400, fontSize: 20, width: 100, height: 100, align: 'left', verticalAlign: 'top' },
  ]));
  const texts = env.named('fillText');
  const japanese = texts.filter(call => /[日本語文次行]/u.test(call.args[0]));
  assert.deepEqual(japanese.map(call => call.args[0]), ['日本', '語文', '次行']);
  assert.ok(japanese.every(call => call.state.textAlign === 'center'));
  assert.deepEqual(japanese.map(call => call.args.slice(1)), [[30, 72], [30, 96], [30, 120]]);
  assert.ok(japanese.every(call => /italic/.test(call.state.font) && /(?:bold|700)/.test(call.state.font) && /Yu Gothic/.test(call.state.font)));
  const right = texts.find(call => call.args[0] === 'ABC');
  assert.equal(right.state.textAlign, 'right');
  assert.deepEqual(right.args.slice(1), [90, 86]);
  const left = texts.find(call => call.args[0] === 'Left');
  assert.equal(left.state.textAlign, 'left'); assert.deepEqual(left.args.slice(1), [10, 26]);
  assert.ok(env.named('clip').length >= 2, 'text is clipped to its element');
});

test('font readiness is awaited before measuring and serializing text', async t => {
  const fontReady = deferred(), fontLoad = deferred(), env = environment(t, { fontReady, fontLoad });
  const pending = renderSlideImage(request([{ type: 'text', text: '日本語', fontFamily: 'Yu Gothic' }]));
  await flush(); assert.equal(env.named('toBlob').length, 0);
  fontReady.resolve(); await flush(); assert.equal(env.named('toBlob').length, 0);
  fontLoad.resolve([]); await pending;
  assert.ok(env.fontLoads.some(call => call.font.includes('Yu Gothic')));
  assert.equal(env.named('toBlob').length, 1); assert.equal(env.timers.size, 0);
});

test('an already aborted render does not allocate a canvas or begin image decoding', async t => {
  const env = environment(t), controller = new AbortController(); controller.abort();
  await assert.rejects(renderSlideImage(request([{ type: 'image', src: png }], { signal: controller.signal })), /abort|cancel|中止/i);
  assert.equal(env.canvases.length, 0); assert.equal(env.images.length, 0); assert.equal(env.timers.size, 0);
});

test('aborting pending image decoding prevents late drawing and releases image callbacks and timers', async t => {
  const env = environment(t, { holdImages: true }), controller = new AbortController();
  const pending = renderSlideImage(request([{ type: 'image', src: png }], { signal: controller.signal }));
  await flush(); assert.equal(env.images.length, 1);
  const load = env.images[0].onload;
  controller.abort();
  await assert.rejects(pending, /abort|cancel|中止/i);
  load?.(); await flush();
  assert.equal(env.named('drawImage').length, 0); assert.equal(env.named('toBlob').length, 0);
  assert.equal(env.images[0].onload, null); assert.equal(env.images[0].onerror, null);
  assert.equal(env.images[0].src, '');
  assert.equal(env.canvases[0].width, 0); assert.equal(env.canvases[0].height, 0);
  assert.equal(env.timers.size, 0);
});

test('a stalled render rejects at its 30 second limit and releases pending resources', async t => {
  const env = environment(t, { holdImages: true });
  const pending = renderSlideImage(request([{ type: 'image', src: png }]));
  await flush(); assert.ok(env.timers.size > 0);
  env.timeout();
  await assert.rejects(pending, /timeout|timed out|時間|タイムアウト|30秒/i);
  assert.equal(env.named('toBlob').length, 0);
  assert.equal(env.images[0].onload, null); assert.equal(env.images[0].onerror, null);
  assert.equal(env.timers.size, 0);
});

test('image failures reject instead of returning incomplete output', async t => {
  const env = environment(t, { imageError: true });
  await assert.rejects(renderSlideImage(request([{ type: 'image', src: png }])), /image|画像/i);
  assert.equal(env.named('toBlob').length, 0); assert.equal(env.timers.size, 0);
});

test('failed PNG encoding rejects instead of returning incomplete output', async t => {
  const env = environment(t, { toBlob: callback => callback(null) });
  await assert.rejects(renderSlideImage(request()), /PNG|image|画像|encode/i);
  assert.equal(env.timers.size, 0);
  assert.equal(env.canvases[0].width, 0); assert.equal(env.canvases[0].height, 0);
});

for (const phase of ['fonts', 'encoding']) test(`the render timeout also covers stalled ${phase}`, async t => {
  const fontReady = deferred(); let encoded;
  const env = environment(t, phase === 'fonts' ? { fontReady } : { toBlob: callback => { encoded = callback; } });
  const pending = renderSlideImage(request([{ type: 'text', text: 'Wait for output' }]));
  await flush(); assert.ok(env.timers.size > 0);
  if (phase === 'encoding') assert.equal(typeof encoded, 'function');
  env.timeout();
  await assert.rejects(pending, /timeout|timed out|時間|タイムアウト|30秒/i);
  const count = env.calls.length;
  if (phase === 'fonts') fontReady.resolve();
  else encoded(new Blob(['late'], { type: 'image/png' }));
  await flush();
  assert.equal(env.calls.length, count, 'late work cannot resume drawing');
  assert.equal(env.timers.size, 0);
  if (env.canvases[0]) { assert.equal(env.canvases[0].width, 0); assert.equal(env.canvases[0].height, 0); }
});

test('animated images explicitly decode frame zero and release their decoder and frame', async t => {
  const decoders = [], frames = [], decoded = [];
  class Decoder {
    static async isTypeSupported(type) { assert.equal(type, 'image/gif'); return true; }
    tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2 } };
    constructor(options) { this.options = options; decoders.push(this); }
    async decode(options) {
      decoded.push(options);
      const frame = { displayWidth: 40, displayHeight: 20, codedWidth: 40, codedHeight: 20, close() { this.closed = true; } };
      frames.push(frame); return { image: frame, complete: true };
    }
    close() { this.closed = true; }
  }
  const env = environment(t, { imageDecoder: Decoder });
  await renderSlideImage(request([{ type: 'image', src: gif, width: 100, height: 100 }]));
  assert.equal(decoders.length, 1); assert.equal(decoders[0].options.type, 'image/gif');
  assert.equal(decoded[0].frameIndex, 0);
  assert.equal(env.images.length, 0, 'animated HTML images must not select an arbitrary current frame');
  assert.equal(env.named('drawImage')[0].args[0], frames[0]);
  assert.equal(decoders[0].closed, true); assert.equal(frames[0].closed, true);
  assert.equal(env.timers.size, 0);
});

test('animated image export reports unsupported decoding instead of choosing an arbitrary frame', async t => {
  const env = environment(t);
  await assert.rejects(renderSlideImage(request([{ type: 'image', src: gif }])), /ImageDecoder|support|対応|animated|アニメ/i);
  assert.equal(env.named('drawImage').length, 0); assert.equal(env.named('toBlob').length, 0);
  assert.equal(env.timers.size, 0);
});

test('an animated frame that finishes after cancellation is closed without drawing', async t => {
  const decoded = deferred(), decoders = [];
  class Decoder {
    static async isTypeSupported() { return true; }
    tracks = { ready: Promise.resolve(), selectedTrack: { frameCount: 2 } };
    constructor() { decoders.push(this); }
    decode() { return decoded.promise; }
    close() { this.closed = true; }
  }
  const env = environment(t, { imageDecoder: Decoder }), controller = new AbortController();
  const pending = renderSlideImage(request([{ type: 'image', src: gif }], { signal: controller.signal }));
  await flush(); assert.equal(decoders.length, 1);
  controller.abort(); await assert.rejects(pending, /abort|cancel|中止/i);
  const frame = { displayWidth: 40, displayHeight: 20, close() { this.closed = true; } };
  decoded.resolve({ image: frame, complete: true }); await flush();
  assert.equal(decoders[0].closed, true); assert.equal(frame.closed, true);
  assert.equal(env.named('drawImage').length, 0); assert.equal(env.named('toBlob').length, 0);
  assert.equal(env.timers.size, 0);
});
