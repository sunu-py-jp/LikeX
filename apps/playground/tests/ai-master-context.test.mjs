import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { applySlideCommands, createSlideDeck, importSlidePptxMasters, parseSlideDeck, serializeSlideDeck } from "@likex/slide/model";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const bundle = await build({ stdin: { resolveDir: root, contents: "export { SkillWorkspace } from './apps/playground/build/ai/tools.ts';" },
  bundle: true, platform: "node", format: "esm", write: false });
const { SkillWorkspace } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text + "\n//# sourceURL=ai-master-context-test.js").toString("base64")}`);
const { library } = await importSlidePptxMasters(await readFile(new URL("../../../packages/slide/tests/fixtures/powerpoint-masters.potx", import.meta.url)));
const imported = applySlideCommands(createSlideDeck({ id: "erp-proposal", title: "ERP新機能提案", slides: [{ id: "cover", name: "表紙", background: "#ffffff", notes: "", elements: [] }] }), { type: "masters.import", library });
const titleLayout = imported.deck.layouts.find(layout => layout.name === "Title Slide");
const contentLayout = imported.deck.layouts.find(layout => layout.name === "Title and Content");
const initial = applySlideCommands(imported.deck, { type: "slide.applyLayout", slideId: "cover", layoutId: titleLayout.id }).deck;
const source = serializeSlideDeck(initial);
const signal = () => new AbortController().signal;
const inspect = (workspace, query) => workspace.invoke("inspect_document", { query }, signal());
const apply = (workspace, commands) => workspace.invoke("apply_commands", { commands, dryRun: false, resolvesFailureIds: [] }, signal());
const page = (workspace, slideId) => inspect(workspace, { kind: "slide", slideId, elementId: null, includeData: true });
const formatKeys = ["fontFamily", "fontSize", "bold", "italic", "textColor", "align", "verticalAlign", "fill", "stroke", "strokeWidth", "opacity", "startArrow", "endArrow"];
const size = value => JSON.stringify(value).length;
function compactCatalog(result) {
  assert.equal(result.ok, true);
  assert.equal(result.summary.masterCount, 1);
  assert.equal(result.summary.layoutCount, 11);
  assert.equal(Object.hasOwn(result.summary, "masters"), false, "a routine response must not repeat the master catalog");
  assert.equal(Object.hasOwn(result.summary, "layouts"), false, "a routine response must not repeat all 11 layouts and their placeholders");
}

test("master-backed list retains discoverable definitions while targeted reads return only the requested data", async t => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  t.after(() => workspace.dispose());
  const list = await inspect(workspace, { kind: "list" });
  assert.equal(list.summary.masters.length, 1); assert.equal(list.summary.layouts.length, 11);
  assert.equal(list.summary.masters[0].id, initial.masters[0].id);
  assert.equal(list.summary.layouts.find(layout => layout.id === titleLayout.id).name, "Title Slide");
  assert.ok(list.summary.layouts.find(layout => layout.id === titleLayout.id).placeholders.every(slot => slot.id));
  assert.equal(list.summary.slides[0].id, "cover"); assert.equal(list.summary.slides[0].layoutId, titleLayout.id);

  compactCatalog(await inspect(workspace, { kind: "overview" }));
  const selectedPage = await page(workspace, "cover");
  compactCatalog(selectedPage);
  assert.equal(selectedPage.selection.slide.id, "cover");
  assert.equal(selectedPage.selection.slide.layoutId, titleLayout.id);
  assert.ok(selectedPage.selection.elements.length > 0);
  assert.ok(selectedPage.selection.elements.every(element => element.id && element.layoutPlaceholderId));
  assert.ok(selectedPage.selection.inheritedElements.some(element => element.name === "Brand stripe"));

  const selectedLayout = await inspect(workspace, { kind: "layout", layoutId: titleLayout.id, includeData: true });
  compactCatalog(selectedLayout);
  assert.equal(selectedLayout.selection.layout.id, titleLayout.id);
  assert.deepEqual(selectedLayout.selection.placeholders.map(slot => slot.id), titleLayout.placeholders.map(slot => slot.id));
  const selectedMaster = await inspect(workspace, { kind: "master", masterId: initial.masters[0].id, includeData: true });
  compactCatalog(selectedMaster);
  assert.equal(selectedMaster.selection.master.id, initial.masters[0].id);
  assert.equal(selectedMaster.selection.layouts.length, 11, "an explicit master read still returns that master's layout definitions");
  assert.equal(await readFile(workspace.file, "utf8"), source, "compaction only changes tool responses, never the document");
});

test("six-page writes, text, formatting and validation keep generated IDs and native masters without growing the conversation by the catalog", async t => {
  const workspace = await SkillWorkspace.create(root, "slide", source);
  t.after(() => workspace.dispose());
  const list = await inspect(workspace, { kind: "list" });
  const catalog = { masters: list.summary.masters, layouts: list.summary.layouts };
  const outputs = [], pageIds = ["cover"];
  for (let index = 0; index < 6; index++) {
    let slideId = "cover";
    if (index) {
      const added = await apply(workspace, [{ type: "slide.add", layoutId: contentLayout.id, slide: { name: `ERP提案 ${index + 1}` } }]);
      compactCatalog(added); outputs.push(added);
      const generated = added.summary.slides.find(slide => !pageIds.includes(slide.id));
      assert.ok(generated?.id, "the AI can discover the generated page ID from the write result");
      assert.equal(generated.layoutId, contentLayout.id);
      slideId = generated.id; pageIds.push(slideId);
    }
    const read = await page(workspace, slideId); compactCatalog(read);
    const title = read.selection.elements.find(element => element.type === "text");
    assert.ok(title?.id); assert.ok(title.layoutPlaceholderId);
    const updated = await workspace.invoke("update_slide_text", { slideId, updates: [{ elementId: title.id, text: `ERP新機能 ${index + 1}` }], dryRun: false, resolvesFailureIds: [] }, signal());
    compactCatalog(updated); outputs.push(updated);
    assert.ok(updated.summary.slides.some(slide => slide.id === slideId && slide.layoutId === (index ? contentLayout.id : titleLayout.id)));
    const formatted = await workspace.invoke("format_slide_elements", { slideId, elementIds: [title.id], format: {
      ...Object.fromEntries(formatKeys.map(key => [key, null])), fontSize: 32 + index,
    }, dryRun: false, resolvesFailureIds: [] }, signal());
    compactCatalog(formatted); outputs.push(formatted);
  }
  for (const [tool, args] of [["validate_document", {}], ["run_script", { operation: "validate" }]]) {
    const checked = await workspace.invoke(tool, args, signal());
    compactCatalog(checked); outputs.push(checked);
    assert.equal(checked.valid, true);
    assert.deepEqual(checked.summary.slides.map(slide => slide.id), pageIds);
  }
  // Keep every small, changing page summary; remove only the repeatedly large catalog.
  const compactCharacters = outputs.reduce((total, output) => total + size(output), 0);
  const previousCharacters = outputs.reduce((total, output) => total + size({ ...output, summary: { ...output.summary, ...catalog } }), 0);
  t.diagnostic(`${outputs.length} responses: ${compactCharacters} characters instead of ${previousCharacters} with repeated catalogs`);
  assert.ok(compactCharacters < previousCharacters / 3, `${compactCharacters} should be less than one third of ${previousCharacters}`);
  assert.ok(outputs.every(output => size(output) < 4_000), "routine edits stay small even after all six pages exist");

  const final = parseSlideDeck((await workspace.result(signal())).document);
  assert.deepEqual(final.masters, initial.masters); assert.deepEqual(final.layouts, initial.layouts);
  assert.deepEqual(final.slides.map(slide => slide.id), pageIds);
  for (const [index, slide] of final.slides.entries()) {
    assert.equal(slide.layoutId, index ? contentLayout.id : titleLayout.id);
    const title = slide.elements.find(element => element.type === "text");
    assert.equal(title.text, `ERP新機能 ${index + 1}`); assert.equal(title.fontSize, 32 + index);
  }
  assert.deepEqual(workspace.unresolvedWrites, []);
  const finalList = await inspect(workspace, { kind: "list" });
  assert.deepEqual(finalList.summary.masters, catalog.masters); assert.deepEqual(finalList.summary.layouts, catalog.layouts);
});
