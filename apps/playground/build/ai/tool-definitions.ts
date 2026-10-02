import { commandSchemas, validateSchema, type JSONSchema } from "./command-schema.ts";
import { invalidArgument, AIToolError } from "./tool-errors.ts";
import { slideFormatCommands } from "./slide-format.ts";
import { slideSvgCommands, slideSvgParameters, slideSvgUpdateParameters } from "./slide-svg.ts";

export const referenceNames = {
  spreadsheet: ["commands.md", "inspect.md", "schema-guide.md", "commands.schema.json", "spon.schema.json"],
  slide: ["commands.md", "inspect.md", "schema-guide.md", "commands.schema.json", "slon.schema.json", "image-export.md", "design-guide.md", "layout-examples.md"],
};
const string: JSONSchema = { type: "string" };
const boolean: JSONSchema = { type: "boolean" };
const nullable = (schema: JSONSchema): JSONSchema => ({ anyOf: [schema, { type: "null" }] });
const literal = (value: string): JSONSchema => ({ type: "string", enum: [value] });
const closed = (properties: Record<string, JSONSchema>): JSONSchema => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const integer = (min: number, max?: number): JSONSchema => ({ type: "integer", minimum: min, ...(max === undefined ? {} : { maximum: max }) });
const definition = (name: string, description: string, parameters: JSONSchema) => ({ type: "function" as const, name, strict: true, description, parameters });
const slideTextParameters = closed({
  slideId: { type: "string", minLength: 1, maxLength: 200 },
  updates: { type: "array", minItems: 1, maxItems: 1000, items: closed({ elementId: { type: "string", minLength: 1, maxLength: 200 }, text: { type: "string", maxLength: 100000 } }) },
  dryRun: boolean,
  resolvesFailureIds: { type: "array", items: string, maxItems: 32 },
});
const slideFormatParameters = closed({
  slideId: { type: "string", minLength: 1, maxLength: 200 },
  elementIds: { type: "array", minItems: 1, maxItems: 1000, items: { type: "string", minLength: 1, maxLength: 200 } },
  format: closed({
    fontFamily: nullable({ type: "string", maxLength: 200 }), fontSize: nullable({ type: "number", minimum: 1, maximum: 1000 }),
    bold: nullable(boolean), italic: nullable(boolean), textColor: nullable(string),
    align: nullable({ type: "string", enum: ["left", "center", "right"] }), verticalAlign: nullable({ type: "string", enum: ["top", "middle", "bottom"] }),
    fill: nullable(string), stroke: nullable(string), strokeWidth: nullable({ type: "number", minimum: 0, maximum: 100 }),
    opacity: nullable({ type: "number", minimum: 0, maximum: 1 }),
    startArrow: nullable({ type: "string", enum: ["none", "triangle", "openArrow", "diamond", "oval", "stealth"] }),
    endArrow: nullable({ type: "string", enum: ["none", "triangle", "openArrow", "diamond", "oval", "stealth"] }),
  }),
  dryRun: boolean, resolvesFailureIds: { type: "array", items: string, maxItems: 32 },
});
export function toolDefinitions(module: "slide" | "spreadsheet", repository = process.cwd()) {
  const commands = commandSchemas(repository, module).strict;
  const queries = [closed({ kind: literal("overview") }), closed({ kind: literal("list") }), ...(module === "slide"
    ? [closed({ kind: literal("slide"), slideId: string, includeData: boolean, elementId: nullable(string) }),
      closed({ kind: literal("master"), masterId: string, includeData: boolean }), closed({ kind: literal("layout"), layoutId: string, includeData: boolean })]
    : [closed({ kind: literal("sheet"), sheetId: string, includeData: boolean, includeFormat: boolean, offset: nullable(integer(0)), limit: nullable(integer(1, 1000)) }),
      closed({ kind: literal("range"), sheetId: string, range: string, includeFormat: boolean }), closed({ kind: literal("drawing"), sheetId: string, drawingId: string, includeData: boolean })])];
  return [
    definition("read_skill", "Read the installed LikeX SKILL.md and its reference list. Its CLI examples describe native commands; use the strict tools below to execute them.", closed({})),
    definition("read_reference", "Read a skill reference, paginated by character offset. Null means default offset/limit. Strict tools require optional command properties as null; dynamic dictionaries use [{key,value}] entries (not an arbitrary-key object).", closed({ name: { type: "string", enum: referenceNames[module] }, offset: nullable(integer(0)), limit: nullable(integer(100, 16000)) })),
    definition("inspect_document", module === "slide"
      ? "Read overview counts, list slides, or get ONE page's elements together. query kind:slide with includeData:true returns all page element details in selection.elements, preserving animations and omitting image src/dataUrl. Use elementId:null for the whole page; avoid repeated per-element reads. summary.title is the document name and slide.name is the slide-list label; neither is the visible canvas heading. Read selection.elements[].text to find and verify a visible heading. Only query kind:list returns the full masters/layouts catalog in summary; write and validation results keep counts and page IDs without repeating the catalog; query kind:master/masterId or kind:layout/layoutId reads their definitions. Page selection.inheritedElements is read-only decoration, separate from editable selection.elements. Copy IDs from results exactly."
      : "Read overview counts, list sheets, a specific sheet's paginated stored cells (selection.cells), a rectangular range (selection.rows row-major matrix), or a drawing. Prefer range reads for table data. Use includeFormat:false for content reads: cell.value preserves raw input/formulas and validation is retained, while repeated cell formatting is omitted (selection.formatsOmitted:true). This is a read projection, not a request to clear formatting. Use includeFormat:true only on a small representative range when existing formatting matters. Copy IDs exactly.", closed({ query: { anyOf: queries } })),
    ...(module === "spreadsheet" ? [
      definition("search_sheets", "Search sheet names by literal keyword. Read-only; inspect the returned sheetId only if its content is needed.", closed({ text: { type: "string", minLength: 1, maxLength: 100000 }, matchCase: boolean, exact: boolean, offset: nullable(integer(0)), limit: nullable(integer(1, 1000)) })),
      definition("search_cells", "Search stored cells by literal keyword across all sheets or a selected sheet/range. range requires sheetId. Values are formatted calculated values; formulas searches raw formulas/input.", closed({ text: { type: "string", minLength: 1, maxLength: 100000 }, sheetId: nullable(string), range: nullable(string), matchCase: boolean, exact: boolean, lookIn: { type: "string", enum: ["values", "formulas"] }, offset: nullable(integer(0)), limit: nullable(integer(1, 1000)), previewLength: nullable(integer(1, 10000)) })),
    ] : []),
    ...(module === "slide" ? [
      definition("add_svg_image", "Insert an original SVG illustration, chart or diagram on ONE existing page at any chosen position/size. Supply raw SVG markup; the host validates and encodes it as an ordinary image through the native API. Use a unique elementId for this new image. SVG internals are one image, not separately editable slide elements; keep important headings, numeric values and labels as native text whenever individual editing matters. SVG supports paths, basic shapes, groups, gradients and clipping; give the root xmlns=http://www.w3.org/2000/svg and a viewBox or width/height. Only local gradient/clip URL references are allowed. Scripts, event handlers, external resources, foreignObject, style, filters, use and embedded images are rejected. Use presentation attributes. Match the document's chosen visual language; this tool imposes no layout, palette or illustration template. dryRun:true validates without staging. resolvesFailureIds normally []; after an error retry the corrected image on the same page with its failureId, refreshing unknown IDs first. Use update_svg_image to revise its artwork from raw SVG and element.update for placement/opacity/alt changes. Preview the page after its final edit.", slideSvgParameters),
      definition("update_svg_image", "Replace the artwork of ONE existing image using raw SVG markup, preserving its ID, position, dimensions, rotation, opacity, alt and other formatting. Inspect to identify the image first; this rejects text/shape targets. The static SVG rules are the same as add_svg_image. Use this to revise a generated diagram after preview without manually encoding base64 or deleting/recreating its element. Keep important editable labels as native text. dryRun:true validates without staging; resolvesFailureIds normally [], or include the failed edit's failureId when retrying its full corrected source. Preview after the final edit.", slideSvgUpdateParameters),
    ] : []),
    ...(module === "slide" ? [definition("update_slide_text", "PREFERRED for changing or translating existing visible titles, body text, or shape labels on ONE slide; keeps formatting. Inspect IDs first. Document/page metadata is unaffected. Image elements are not text targets. Each update needs only elementId and text; empty text clears it. All updates are atomic. dryRun:true validates without staging. resolvesFailureIds normally []; after an error repeat the entire corrected batch with its failureId. Preview the changed page before finishing.", slideTextParameters)] : []),
    ...(module === "slide" ? [definition("format_slide_elements", "PREFERRED for formatting existing elements on ONE slide, without changing text or layout. Inspect IDs/types first. Apply the same format to every elementId atomically. Text supports fontFamily/fontSize/bold/italic/textColor/align/verticalAlign/fill/opacity; ordinary shapes support fontSize/textColor/fill/stroke/strokeWidth/opacity; lines support stroke/strokeWidth/opacity/startArrow/endArrow only (none/triangle/openArrow/diamond/oval/stealth); images support opacity only. Unsupported fields reject the WHOLE batch. Null means leave unchanged for every format field; use a hex color or transparent, never null to clear a color. All-null format makes no change and is subject to the repeated-no-change guard. dryRun:true validates without staging. To repair, repeat the whole selection and intended format fields with resolvesFailureIds. Preview the changed page before finishing.", slideFormatParameters)] : []),
    definition("apply_commands", `Atomically apply native typed commands. ${module === "slide" ? "ONE PAGE per call is enforced by the API; a user request may process many pages through sequential calls. Use slide.add with all desired elements for a new page, or slide.replaceContent for an explicitly requested full-page redesign. Choose arbitrary geometry, hierarchy, typography, color and visual rhythm suited to the content; there is no layout catalog or preset requirement. slide.replaceContent preserves page identity/master but replaces local elements and animations, so use incremental commands for small edits. Use add_svg_image for original vector artwork from raw SVG markup. Batch all same-page element edits. For text-only changes to existing visible titles, body text, or shape labels, prefer update_slide_text instead of choosing an element.update patch branch. For formatting-only changes prefer format_slide_elements. Use line.add/line.update with two endpoints and binding:{targetId,port} for persistent shape connections; startArrow/endArrow format the two line ends. Block right/left arrows are separate filled shapes. deck.rename changes document metadata only; slide.update patch.name changes the slide-list label only. Neither changes canvas text. slide.delete/duplicate/move and deck.rename must be standalone; deck.resize requires a one-page deck. Use slide.add with layoutId or slide.applyLayout to reuse imported layouts; slide.detachLayout converts inherited decoration into local elements. masters.import must be standalone." : "Batch independent edits across sheets. For ordinary cell data with grid borders and header colors prefer cells.writeGrid (headerStyle and optional border); it creates no table metadata. Use tables.insert only when a named structured table is requested. For borders on existing ranges use cells.borders. For drawing connections use lines.insert/lines.update with two endpoints and binding:{targetId,port}, and startArrow/endArrow for end markers. Block right/left arrows are separate filled shapes. cells.format/cells.validation/cells.replace addresses accept same-sheet A1 cells and ranges (e.g. B2:F2 and A1); range-containing lists may expand to at most 10,000 unique cells. cells.set.values uses [{key:\"A1\",value:\"text\"}], and rowHeights uses numeric-string keys."} Optional native fields are required nullable on the wire; null omits a field only where the native type disallows null. dryRun:true validates without staging. resolvesFailureIds normally []; after an error repeat the entire corrected batch and list its failureId. Unrelated success cannot resolve it. No page/sheet selector belongs outside commands.`, {
      ...closed({ commands: { type: "array", items: commands.items, maxItems: 1000 }, dryRun: boolean, resolvesFailureIds: { type: "array", items: string, maxItems: 32 } }), $defs: commands.$defs,
    }),
    definition("validate_document", "Validate the staged document. apply_commands already validates; normally the host's final validation is enough. Does not resolve failed edits.", closed({})),
    definition("create_document", "REPLACE the whole document with an empty default document, only when explicitly requested by the user. Slide permits this only for an existing single-page document. Then use apply_commands to populate. Does not resolve unrelated failed edits. To retry a failed create, inspect first and supply its failureId.", closed({ resolvesFailureIds: { type: "array", items: string, maxItems: 32 } })),
  ];
}
const object = (value: unknown, location: string): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalidArgument(location, "object", value);
  return value as Record<string, unknown>;
};
function onlyKeys(value: Record<string, unknown>, allowed: string[], location: string) {
  for (const key of Object.keys(value)) if (!allowed.includes(key)) invalidArgument(`${location}.${key}`, `known property (${allowed.join(", ")})`, value[key]);
}
const omitNull = (value: Record<string, unknown>) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null));
/** Preserve native target identity for failure recovery, even when an update's value is invalid. */
export function slideTextCommands(input: Record<string, unknown>): Record<string, unknown>[] | undefined {
  if (!Array.isArray(input.updates)) return undefined;
  return input.updates.map(update => {
    const item = update && typeof update === "object" && !Array.isArray(update) ? update as Record<string, unknown> : {};
    return { type: "element.update", slideId: input.slideId, elementId: item.elementId, patch: { text: item.text } };
  });
}
/** Translate strict read/write tools to the shared installed CLI without mixing their argument spaces. */
export function scriptArguments(module: "slide" | "spreadsheet", name: string, input: Record<string, unknown>): Record<string, unknown> {
  if (name === "run_script") return input;
  if (module === "slide" && (name === "add_svg_image" || name === "update_svg_image")) {
    const mode = name === "update_svg_image" ? "update" : "add";
    const parameters = mode === "update" ? slideSvgUpdateParameters : slideSvgParameters;
    validateSchema(input, parameters, parameters, name);
    return { operation: "apply", commands: slideSvgCommands(input, mode), dryRun: input.dryRun };
  }
  if (module === "slide" && name === "update_slide_text") {
    validateSchema(input, slideTextParameters, slideTextParameters, name);
    return { operation: "apply", commands: slideTextCommands(input), dryRun: input.dryRun };
  }
  if (module === "slide" && name === "format_slide_elements") {
    validateSchema(input, slideFormatParameters, slideFormatParameters, name);
    const ids = input.elementIds as string[];
    if (new Set(ids).size !== ids.length) invalidArgument(`${name}.elementIds`, "unique element IDs", ids);
    return { operation: "apply", commands: slideFormatCommands(input), dryRun: input.dryRun };
  }
  if (name === "apply_commands") {
    onlyKeys(input, ["commands", "dryRun", "resolvesFailureIds"], name);
    if (!Array.isArray(input.resolvesFailureIds ?? [] ) || (input.resolvesFailureIds as unknown[] | undefined)?.some(id => typeof id !== "string")) invalidArgument("resolvesFailureIds", "string[]", input.resolvesFailureIds);
    return { operation: "apply", commands: input.commands, ...(input.dryRun === undefined ? {} : { dryRun: input.dryRun }) };
  }
  if (name === "validate_document" || name === "create_document") { onlyKeys(input, name === "create_document" ? ["resolvesFailureIds"] : [], name); return { operation: name === "create_document" ? "create" : "validate" }; }
  if (name === "inspect_document") {
    onlyKeys(input, ["query"], name);
    const query = object(input.query, "query"), kind = query.kind;
    if (kind === "overview" || kind === "list") { onlyKeys(query, ["kind"], "query"); return { operation: "inspect", ...(kind === "overview" ? { overview: true } : {}) }; }
    const variants: Record<string, string[]> = module === "slide" ? { slide: ["slideId", "elementId", "includeData"], master: ["masterId", "includeData"], layout: ["layoutId", "includeData"] }
      : { sheet: ["sheetId", "includeData", "includeFormat", "offset", "limit"], range: ["sheetId", "range", "includeFormat"], drawing: ["sheetId", "drawingId", "includeData"] };
    if (typeof kind !== "string" || !variants[kind]) invalidArgument("query.kind", ["overview", "list", ...Object.keys(variants)], kind);
    onlyKeys(query, ["kind", ...variants[kind]], "query");
    for (const key of kind === "slide" ? ["slideId"] : kind === "master" ? ["masterId"] : kind === "layout" ? ["layoutId"] : kind === "range" ? ["sheetId", "range"] : kind === "drawing" ? ["sheetId", "drawingId"] : ["sheetId"]) if (typeof query[key] !== "string" || !query[key]) invalidArgument(`query.${key}`, "nonempty string", query[key]);
    const { kind: ignored, ...selectors } = query; void ignored;
    return { operation: "inspect", ...omitNull(selectors) };
  }
  if (module === "spreadsheet" && (name === "search_sheets" || name === "search_cells")) {
    onlyKeys(input, ["text", "matchCase", "exact", "offset", "limit", ...(name === "search_cells" ? ["sheetId", "range", "lookIn", "previewLength"] : [])], name);
    return { operation: "inspect", search: name === "search_sheets" ? "sheets" : "cells", ...omitNull(input) };
  }
  throw new AIToolError("利用できないツールです。", { code: "unknown_tool", actual: name });
}
