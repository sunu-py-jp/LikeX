import test, { after } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createSlideDeck, createSlideElement, parseSlideDeck, serializeSlideDeck } from "@likex/slide/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundled = await build({ stdin: { resolveDir: root, contents: "export * from './apps/playground/build/ai/session.ts'; export * from './apps/playground/build/ai/provider.ts';" }, bundle: true, platform: "node", format: "esm", write: false });
const { runAISession, readConfiguration } = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString("base64")}`);
const config = readConfiguration({ OPENAI_API_KEY: "test-key-not-real" });
const document = serializeSlideDeck(createSlideDeck({ slides: [{ id: "page", name: "Original", notes: "", background: "#ffffff", elements: [createSlideElement({ id: "title", type: "text", text: "Original" })] }] }));
const request = { module: "slide", document, capabilities: { slidePreview: true }, messages: [{ role: "user", content: "現在のページの名前と見出しを更新して" }] };
const logs = new Set();
after(async () => { await Promise.all([...logs].map(id => rm(path.join(root, ".likex-ai/runs", `${id}.jsonl`), { force: true }))); });
const emitTo = events => event => { events.push(event); if (event.type === "run") logs.add(event.id); };
const response = (...output) => new Response(JSON.stringify({ status: "completed", output }));
const call = (name, args, id = name) => ({ id: `fc-${id}`, type: "function_call", call_id: id, name, arguments: JSON.stringify(args), status: "completed" });
const answer = () => response({ type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: "確認して反映しました。", annotations: [] }] });
const apply = (commands, id, { dryRun = false, resolvesFailureIds = [] } = {}) => call("apply_commands", { commands, dryRun, resolvesFailureIds }, id);
const rename = (name = "Edited") => ({ type: "slide.update", slideId: "page", patch: { name } });
const preview = id => call("preview_slide", { slideId: "page" }, id);
const inspect = id => call("inspect_document", { query: { kind: "slide", slideId: "page", includeData: true, elementId: null } }, id);
const imageResult = () => ({ slideId: "page", width: 1280, height: 720, imageUrl: "data:image/png;base64,NOOP_TEST_IMAGE", diagnostics: [] });
const toolOutput = (body, id) => JSON.parse(body.input.find(item => item.type === "function_call_output" && item.call_id === id).output);
const noResult = events => assert.equal(events.some(event => event.type === "result"), false, "staged changes must not be published");
const session = async (events, fetcher, render = async () => imageResult()) => {
  let assertionError;
  try {
    return await runAISession({ repository: root, config, request, signal: new AbortController().signal, emit: emitTo(events), preview: render,
      fetcher: async (...args) => { try { return await fetcher(...args); } catch (error) { assertionError = error; throw error; } },
    });
  } catch (error) { throw assertionError ?? error; }
};

test("session hard-stops the third identical no-op even across inspect calls and never publishes staged edits", async () => {
  const events = []; let fetches = 0, renders = 0;
  await assert.rejects(session(events, async (_url, init) => {
    const body = JSON.parse(init.body);
    switch (++fetches) {
      case 1: return response(apply([rename()], "edit"), preview("review"));
      case 2: return response(apply([rename()], "noop-1"), inspect("inspect-1"));
      case 3: {
        assert.deepEqual(Object.fromEntries(Object.entries(toolOutput(body, "noop-1").noChange).filter(([key]) => key !== "message")), { code: "no_change", repeatCount: 1, stopAfter: 3 });
        assert.ok(body.input.some(item => item.role === "developer"), "host guidance must be a trusted developer message");
        return response(apply([rename()], "noop-2"), inspect("inspect-2"));
      }
      case 4:
        assert.equal(toolOutput(body, "noop-2").noChange.repeatCount, 2);
        return response(apply([rename()], "noop-3"), apply([rename("Must not execute")], "after-limit"));
      default: assert.fail("provider must not be called after the third no-op");
    }
  }, async () => { renders++; return imageResult(); }), error => error.details?.code === "repeated_no_change" || error.code === "repeated_no_change");
  assert.equal(fetches, 4);
  assert.equal(renders, 1);
  noResult(events);
  assert.equal(events.some(event => event.type === "tool" && event.call.input?.commands?.some(command => command.patch?.name === "Must not execute")), false);
  const errors = events.filter(event => event.type === "tool" && event.call.status === "error");
  assert.equal(errors.length, 1);
  assert.equal(errors[0].call.output.diagnostics.code, "repeated_no_change");
});

test("a model can finish after empty normalized patches without invalidating a current preview", async () => {
  const events = []; let fetches = 0, renders = 0;
  await session(events, async (_url, init) => {
    const body = JSON.parse(init.body);
    if (++fetches === 1) return response(apply([rename()], "edit"), preview("review"));
    if (fetches === 2) return response(apply([{ type: "element.update", slideId: "page", elementId: "title", patch: { text: null, fontSize: null, x: null, y: null } }], "empty"));
    assert.equal(fetches, 3);
    const output = toolOutput(body, "empty");
    assert.equal(output.changed, false);
    assert.equal(output.noChange.code, "empty_patch");
    assert.equal(output.noChange.repeatCount, 1);
    assert.ok(body.input.some(item => item.role === "developer"));
    return answer();
  }, async () => { renders++; return imageResult(); });
  assert.equal(renders, 1);
  const result = events.find(event => event.type === "result");
  assert.equal(result.changed, true);
  assert.equal(parseSlideDeck(result.document).slides[0].name, "Edited");
});

test("no-op guidance cannot bypass the required preview of a changed page", async () => {
  const events = []; let fetches = 0, renders = 0;
  await session(events, async (_url, init) => {
    const body = JSON.parse(init.body);
    switch (++fetches) {
      case 1: return response(apply([rename()], "edit"), apply([rename()], "noop"));
      case 2: return answer();
      case 3:
        noResult(events);
        assert.match(body.input.at(-1).content, /Required host validation.*page/);
        return response(preview("review"));
      case 4: return answer();
      default: assert.fail("unexpected provider request");
    }
  }, async () => { renders++; return imageResult(); });
  assert.equal(renders, 1);
  assert.equal(events.find(event => event.type === "result").changed, true);
});

test("no-op guidance cannot discard an unresolved requested write", async () => {
  const events = []; let fetches = 0, failureId;
  const patch = { text: "Repaired title" };
  await session(events, async (_url, init) => {
    const body = JSON.parse(init.body);
    switch (++fetches) {
      case 1: return response(apply([rename()], "edit"), preview("review"), apply([{ type: "element.update", slideId: "page", elementId: "missing", patch }], "invalid"));
      case 2:
        assert.equal(toolOutput(body, "invalid").diagnostics.code, "unknown_id", JSON.stringify(toolOutput(body, "invalid")));
        failureId = toolOutput(body, "invalid").diagnostics.failureId;
        assert.ok(failureId);
        return response(apply([rename()], "noop"));
      case 3: return answer();
      case 4:
        noResult(events);
        assert.match(body.input.at(-1).content, /Required edits still have unresolved failures/);
        assert.ok(body.input.at(-1).content.includes(failureId));
        return response(inspect("refresh-after-failure"), apply([{ type: "element.update", slideId: "page", elementId: "title", patch }], "repair", { resolvesFailureIds: [failureId] }), preview("repaired-review"));
      case 5:
        assert.equal(toolOutput(body, "repair").ok, true, JSON.stringify(toolOutput(body, "repair")));
        return answer();
      default: assert.fail("unexpected provider request");
    }
  });
  const result = events.find(event => event.type === "result");
  assert.equal(parseSlideDeck(result.document).slides[0].elements[0].text, "Repaired title");
});

test("a real revision change resets the no-op guard, while dry runs do not consume it", async () => {
  const events = []; let fetches = 0;
  await session(events, async (_url, init) => {
    const body = JSON.parse(init.body);
    switch (++fetches) {
      case 1: return response(apply([rename()], "edit"), preview("review"));
      case 2: return response(apply([rename()], "noop-before-1"), apply([rename()], "noop-before-2"));
      case 3:
        assert.equal(toolOutput(body, "noop-before-2").noChange.repeatCount, 2);
        return response(apply([rename("Final")], "actual-change"), preview("final-review"));
      case 4: return response(apply([rename("Final")], "noop-after-1"), ...Array.from({ length: 3 }, (_, index) => apply([rename("Final")], `dry-${index}`, { dryRun: true })), apply([rename("Final")], "noop-after-2"));
      case 5:
        assert.equal(toolOutput(body, "noop-after-1").noChange.repeatCount, 1);
        assert.equal(toolOutput(body, "noop-after-2").noChange.repeatCount, 2);
        for (let index = 0; index < 3; index++) assert.equal(toolOutput(body, `dry-${index}`).noChange, undefined);
        return answer();
      default: assert.fail("unexpected provider request");
    }
  });
  assert.equal(parseSlideDeck(events.find(event => event.type === "result").document).slides[0].name, "Final");
});
