import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { Readable } from "node:stream";
import { EventEmitter } from "node:events";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const compiled = await build({ absWorkingDir: root, stdin: { contents: `
  export * from './apps/playground/build/ai/slide-preview.ts';
  export * from './apps/playground/build/ai-playground.ts';
  export * from './apps/playground/src/ai/slide-preview.ts';
  export * from './apps/playground/src/ai/ai-client.ts';
  export {createSlideDeck,createSlideElement,serializeSlideDeck} from './packages/slide/src/model/index.ts';`, resolveDir: root },
  alias: { "@likex/slide/model": `${root}/packages/slide/src/model-entry.ts`, "@likex/slide/render": `${root}/packages/slide/src/render-entry.ts` },
  loader: { ".css": "empty" }, platform: "node", format: "esm", bundle: true, write: false,
  define: { "import.meta.url": JSON.stringify(new URL("../build/ai-playground.ts", import.meta.url).href) },
  plugins: [{ name: "external-packages", setup(builder) {
    builder.onResolve({ filter: /^(?:react|react-dom|lucide-react)(?:\/.*)?$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
    builder.onResolve({ filter: /^vite$/ }, ({ path }) => ({ path: import.meta.resolve(path), external: true }));
  } }],
});
const { SlidePreviewBroker, validatePreviewResult, respondToSlidePreview, renderSlidePreview, readAIResponse, createAIMiddleware,
  createSlideDeck, createSlideElement, serializeSlideDeck } =
  await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);
const source = { document: JSON.stringify({ width: 1280, height: 720, slides: [{ id: "one" }] }), slideId: "one" };
function result(width = 1280, height = 720) {
  const png = Buffer.alloc(33);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]).copy(png);
  png.writeUInt32BE(width, 16); png.writeUInt32BE(height, 20);
  return { slideId: "one", imageUrl: `data:image/png;base64,${png.toString("base64")}`, width, height, diagnostics: [] };
}

test("preview broker isolates concurrent render requests with one-use credentials and matching page dimensions", async () => {
  const broker = new SlidePreviewBroker(), events = [];
  const first = broker.request(source, new AbortController().signal, event => events.push(event));
  const second = broker.request(source, new AbortController().signal, event => events.push(event));
  const [one, two] = events;
  assert.notEqual(one.id, two.id); assert.notEqual(one.token, two.token);
  assert.equal(broker.complete(one.id, { token: two.token, result: result() }), false);
  assert.throws(() => broker.complete(one.id, { token: one.token, result: result(1, 1) }), /寸法/);
  assert.equal(broker.complete(two.id, { token: two.token, result: result() }), true);
  assert.deepEqual(await second, result());
  assert.equal(broker.complete(one.id, { token: one.token, result: result() }), true);
  assert.deepEqual(await first, result());
  assert.equal(broker.complete(one.id, { token: one.token, result: result() }), false);
});

test("aborted, timed-out and failed rendering requests are removed without accepting late images", async () => {
  const broker = new SlidePreviewBroker(10), controller = new AbortController(); let event;
  const cancelled = broker.request(source, controller.signal, value => { event = value; });
  const rejected = assert.rejects(cancelled, { name: "AbortError" });
  controller.abort(); await rejected;
  assert.equal(broker.complete(event.id, { token: event.token, result: result() }), false);
  const late = broker.request(source, new AbortController().signal, value => { event = value; });
  await assert.rejects(late, /時間内/);
  assert.equal(broker.complete(event.id, { token: event.token, result: result() }), false);
  const failed = broker.request(source, new AbortController().signal, value => { event = value; });
  const failedResult = assert.rejects(failed, /フォント/);
  assert.equal(broker.complete(event.id, { token: event.token, error: "フォントを読めません" }), true);
  await failedResult;
});

test("preview broker only requests a bounded single page and enforces PNG and diagnostic limits", () => {
  const broker = new SlidePreviewBroker();
  for (const document of ["invalid", "null", JSON.stringify({ width: 1280, height: 720, slides: [{ id: "one" }, { id: "two" }] })])
    assert.throws(() => broker.request({ ...source, document }, new AbortController().signal, () => {}), /プレビュー/);
  const good = result();
  for (const invalid of [{ ...good, slideId: "another" }, { ...good, width: 2 }, { ...good, imageUrl: "https://example.com/image.png" },
    { ...good, imageUrl: "data:image/png;base64," }, { ...good, diagnostics: [{ code: "instructions", elementId: "title", message: "bad" }] },
    { ...good, diagnostics: [{ code: "text-overflow", elementId: "title", message: "overflow", measuredWidth: -1 }] },
    { ...good, diagnostics: [{ code: "out-of-bounds", elementId: "title", message: "overflow", unexpected: true }] }])
    assert.throws(() => validatePreviewResult(invalid, "one"), /形式/);
  const diagnostic = { code: "text-overflow", elementId: "title", message: "文字切れ", measuredWidth: 20, availableWidth: 18, measuredHeight: 60, availableHeight: 40 };
  assert.deepEqual(validatePreviewResult({ ...good, diagnostics: [diagnostic] }, "one").diagnostics, [diagnostic]);
});

test("browser preview responder posts an isolated rendered result or a recoverable renderer failure", async () => {
  const event = { type: "preview", ...source, id: "d3149b1e-2dce-4a28-8e91-447d090608f3", token: "a".repeat(64) }, requests = [];
  const fetcher = async (url, init) => { requests.push({ url, ...init, body: JSON.parse(init.body) }); return Response.json({ ok: true }); };
  const controller = new AbortController();
  await respondToSlidePreview(event, controller.signal, async (request, signal) => { assert.equal(request, event); assert.equal(signal, controller.signal); return result(); }, fetcher);
  assert.equal(requests[0].url, `/api/ai/previews/${event.id}`);
  assert.deepEqual(requests[0].body, { token: event.token, result: result() });
  await respondToSlidePreview(event, controller.signal, async () => { throw new Error("描画に失敗"); }, fetcher);
  assert.deepEqual(requests[1].body, { token: event.token, error: "描画に失敗" });
  await assert.rejects(respondToSlidePreview(event, controller.signal, async () => result(), async () => new Response(null, { status: 404 })), /返せません/);
});

test("stopping a request while rendering prevents a late browser preview POST", async () => {
  const controller = new AbortController(); let release, posts = 0;
  const rendering = new Promise(resolve => { release = resolve; });
  const pending = respondToSlidePreview({ type: "preview", ...source, id: "unused", token: "unused" }, controller.signal,
    () => rendering, async () => { posts++; return Response.json({ ok: true }); });
  const rejected = assert.rejects(pending, { name: "AbortError" });
  controller.abort(); release(result()); await rejected;
  assert.equal(posts, 0);
});

test("stream parser preserves valid preview events and rejects malformed credentials", async () => {
  const event = { type: "preview", ...source, id: "d3149b1e-2dce-4a28-8e91-447d090608f3", token: "a".repeat(64) };
  const complete = { type: "result", document: "{}", changed: false };
  const response = value => new Response([value, complete].map(item => JSON.stringify(item)).join("\n"));
  assert.deepEqual(await Array.fromAsync(readAIResponse(response(event), new AbortController().signal)), [event, complete]);
  for (const invalid of [{ ...event, id: "../config" }, { ...event, token: "bad" }, { ...event, slideId: "" }, { ...event, document: null }])
    await assert.rejects(Array.fromAsync(readAIResponse(response(invalid), new AbortController().signal)), /プレビュー要求/);
});

test("preview rendering uses the public exporter, awaits fonts, reports measured layout issues and never mutates its snapshot", async t => {
  const oldDocument = globalThis.document, canvases = []; let fontsReady = false, loads = 0;
  t.after(() => { globalThis.document = oldDocument; });
  globalThis.document = {
    fonts: { load: async () => { loads++; fontsReady = true; return []; }, ready: Promise.resolve() },
    createElement(name) {
      assert.equal(name, "canvas");
      const context = new Proxy({ font: "" }, { get(target, key) {
        if (key in target) return target[key];
        if (key === "measureText") return text => { assert.ok(fontsReady); return { width: text.length * 24 }; };
        return () => {};
      } });
      const canvas = { width: 0, height: 0, getContext: () => context, toBlob(callback) {
        callback(new Blob([Buffer.from(result(this.width, this.height).imageUrl.slice(22), "base64")], { type: "image/png" }));
      } };
      canvases.push(canvas); return canvas;
    },
  };
  const deck = createSlideDeck({ id: "deck", width: 1280, height: 720, slides: [{ id: "one", name: "Preview", background: "#ffffff", notes: "", elements: [
    createSlideElement({ id: "title", type: "text", text: "Long overflowing title", x: 1200, y: 100, width: 200, height: 20, fontSize: 32 }),
  ] }] });
  const request = { type: "preview", ...source, document: serializeSlideDeck(deck), id: "unused", token: "unused" }, before = request.document;
  const preview = await renderSlidePreview(request, new AbortController().signal);
  assert.equal(preview.width, 1280); assert.equal(preview.height, 720);
  assert.equal(loads, 1); assert.equal(request.document, before);
  assert.ok(preview.diagnostics.some(item => item.code === "text-overflow" && item.elementId === "title" && item.measuredHeight > item.availableHeight));
  assert.ok(preview.diagnostics.some(item => item.code === "out-of-bounds" && item.elementId === "title"));
  assert.ok(canvases.every(canvas => canvas.width === 0 && canvas.height === 0));
  assert.deepEqual(validatePreviewResult(preview, "one"), preview);
});

class MemoryResponse extends EventEmitter {
  headers = {}; statusCode = 200; destroyed = false; body = "";
  setHeader(name, value) { this.headers[name.toLowerCase()] = value; }
  end(value) { this.body += value ?? ""; }
}
test("preview completion endpoint enforces local origin, content type, IDs, size and outstanding credentials", async () => {
  const middleware = createAIMiddleware({ repository: root, config: { configured: false } });
  const endpoint = "/api/ai/previews/d3149b1e-2dce-4a28-8e91-447d090608f3";
  async function http(options = {}) {
    const req = Readable.from([JSON.stringify(options.body ?? {})]);
    req.url = options.url ?? endpoint; req.method = options.method ?? "POST";
    req.headers = { host: "127.0.0.1:5173", origin: "http://127.0.0.1:5173", "content-type": "application/json", ...options.headers };
    req.socket = { remoteAddress: options.remoteAddress ?? "127.0.0.1" };
    const res = new MemoryResponse();
    await middleware(req, res, () => { throw new Error("unexpected next"); }); return res;
  }
  assert.equal((await http()).statusCode, 404);
  assert.equal((await http({ method: "GET" })).statusCode, 405);
  assert.equal((await http({ url: "/api/ai/previews/../secret" })).statusCode, 400);
  assert.equal((await http({ headers: { origin: undefined } })).statusCode, 403);
  assert.equal((await http({ headers: { origin: "https://other.example" } })).statusCode, 403);
  assert.equal((await http({ remoteAddress: "192.168.1.2" })).statusCode, 403);
  assert.equal((await http({ headers: { "content-type": "text/plain" } })).statusCode, 415);
  assert.equal((await http({ headers: { "content-length": String(4 * 1024 * 1024) } })).statusCode, 400);
});
