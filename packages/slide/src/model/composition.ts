import type { SlideCommand, SlideComposition, SlideCompositionPreset, SlideDeck, SlideElement, SlideShapeElement, SlideTextElement } from "./types";
import { createSlideElement, normalizeSlideDeck } from "./normalize";
import { getSlideElementBounds, measureSlideText } from "./authoring";
import type { SlideTextMeasure } from "./authoring";
import { resolveSlideAppearance } from "./layouts";
import { choice, identifier, list, record, text } from "./validation";
import { SLIDE_LIMITS } from "./limits";

const PRESETS = Object.freeze([
  Object.freeze({ id: "executive" as const, name: "Executive", description: "Navy and teal, clear business hierarchy, generous spacing." }),
  Object.freeze({ id: "editorial" as const, name: "Editorial", description: "Warm neutral panels, serif headings, restrained terracotta accents." }),
  Object.freeze({ id: "contrast" as const, name: "Contrast", description: "Strong ink headings, violet accents, sharply separated panels." }),
]);
const LIMITS = Object.freeze({ title: 64, eyebrow: 40, subtitle: 120, footer: 90, itemTitle: 28, itemBody: 160,
  flowTitle: 20, flowBody: 90, columnTitle: 24, nodeTitle: 26, nodeBody: 70, connectionLabel: 12, action: 72, details: 160, highlight: 32 });
const LAYOUTS = Object.freeze([
  { kind: "hero", name: "Hero", description: "A statement with an accent rule and up to three supporting highlights.", minItems: 0, maxItems: 3 },
  { kind: "comparison", name: "Comparison", description: "Two parallel before/after panels.", minItems: 2, maxItems: 2 },
  { kind: "features", name: "Features", description: "Two or three columns; four items form a balanced two-by-two grid.", minItems: 2, maxItems: 4 },
  { kind: "flow", name: "Flow", description: "Two to five ordered steps connected by attached arrows.", minItems: 2, maxItems: 5 },
  { kind: "architecture", name: "Architecture", description: "Two to four columns, one or two nodes per column, up to eight connections. Connect adjacent columns or nodes in the same column; use short labels.", minItems: 2, maxItems: 4,
    minNodesPerColumn: 1, maxNodesPerColumn: 2, maxConnections: 8, connectionRules: "Distinct existing node IDs; one connection per pair; same or adjacent columns only." },
  { kind: "closing", name: "Closing", description: "A prominent action with a separate supporting detail block.", minItems: 1, maxItems: 1 },
].map(item => Object.freeze({ ...item, kind: item.kind as SlideComposition["kind"], textLimits: LIMITS })));
export function getSlideCompositionPresets(): typeof PRESETS { return PRESETS; }
/** Limits are grapheme counts, not English word counts. Available measured lines can impose a tighter bound. */
export function getSlideCompositionLayouts(): typeof LAYOUTS { return LAYOUTS; }
export type SlideCompositionOptions = { preset?: SlideCompositionPreset; notes?: string; measureText?: SlideTextMeasure };
const segmenter = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;
const graphemes = (value: string) => segmenter ? [...segmenter.segment(value)].map(part => part.segment) : Array.from(value);

function content(value: unknown, path: string, maximum: number): string {
  const result = text(value, path, maximum * 32, false).replace(/\r\n?/g, "\n");
  if (graphemes(result).length > maximum) throw new Error(`${path}: ${maximum}文字（書記素）以内に短くするか、複数のスライドに分けてください`);
  return result;
}
function validateComposition(input: SlideComposition): SlideComposition {
  const common = ["kind", "title", "eyebrow", "subtitle", "footer"];
  const fields = { hero: ["highlights"], comparison: ["before", "after"], features: ["items"], flow: ["steps"], architecture: ["columns", "connections"], closing: ["action", "details"] };
  const raw = record(input, "composition", [...common, ...Object.values(fields).flat()]);
  const kind = choice(raw.kind, Object.keys(fields) as SlideComposition["kind"][], "composition.kind");
  const limits = LAYOUTS.find(item => item.kind === kind)!;
  record(raw, "composition", [...common, ...fields[kind]]);
  const base = { title: content(raw.title, "composition.title", LIMITS.title), ...Object.fromEntries(
    (["eyebrow", "subtitle", "footer"] as const).filter(key => raw[key] !== undefined).map(key => [key, content(raw[key], `composition.${key}`, LIMITS[key])])) };
  const item = (value: unknown, path: string, flow = false) => {
    const row = record(value, path, ["title", "body"]);
    return { title: content(row.title, `${path}.title`, flow ? LIMITS.flowTitle : LIMITS.itemTitle), body: content(row.body, `${path}.body`, flow ? LIMITS.flowBody : LIMITS.itemBody) };
  };
  if (kind === "hero") return { ...base, kind, ...(raw.highlights === undefined ? {} : { highlights: list(raw.highlights, "composition.highlights", limits.maxItems, limits.minItems).map((value, index) => content(value, `composition.highlights[${index}]`, LIMITS.highlight)) }) };
  if (kind === "comparison") return { ...base, kind, before: item(raw.before, "composition.before"), after: item(raw.after, "composition.after") };
  if (kind === "features") return { ...base, kind, items: list(raw.items, "composition.items", limits.maxItems, limits.minItems).map((value, index) => item(value, `composition.items[${index}]`)) };
  if (kind === "flow") return { ...base, kind, steps: list(raw.steps, "composition.steps", limits.maxItems, limits.minItems).map((value, index) => item(value, `composition.steps[${index}]`, true)) };
  if (kind === "closing") return { ...base, kind, action: content(raw.action, "composition.action", LIMITS.action), ...(raw.details === undefined ? {} : { details: content(raw.details, "composition.details", LIMITS.details) }) };
  const ids = new Set<string>();
  const columns = list(raw.columns, "composition.columns", limits.maxItems, limits.minItems).map((value, index) => {
    const path = `composition.columns[${index}]`, column = record(value, path, ["title", "nodes"]);
    return { title: content(column.title, `${path}.title`, LIMITS.columnTitle), nodes: list(column.nodes, `${path}.nodes`, limits.maxNodesPerColumn!, limits.minNodesPerColumn!).map((value, nodeIndex) => {
      const nodePath = `${path}.nodes[${nodeIndex}]`, node = record(value, nodePath, ["id", "title", "body"]), id = identifier(node.id);
      if (ids.has(id)) throw new Error(`${nodePath}.id: ノードIDが重複しています: ${id}`);
      ids.add(id);
      return { id, title: content(node.title, `${nodePath}.title`, LIMITS.nodeTitle), ...(node.body === undefined ? {} : { body: content(node.body, `${nodePath}.body`, LIMITS.nodeBody) }) };
    }) };
  });
  const pairs = new Set<string>();
  const connections = list(raw.connections, "composition.connections", limits.maxConnections!).map((value, index) => {
    const path = `composition.connections[${index}]`, edge = record(value, path, ["from", "to", "label"]), from = identifier(edge.from), to = identifier(edge.to);
    if (!ids.has(from) || !ids.has(to) || from === to) throw new Error(`${path}: from/toには異なる既存ノードIDを指定してください`);
    const key = JSON.stringify([from, to].sort());
    if (pairs.has(key)) throw new Error(`${path}: 同じノード間の接続は1本にまとめてください`);
    pairs.add(key);
    const column = (id: string) => columns.findIndex(item => item.nodes.some(node => node.id === id));
    if (Math.abs(column(from) - column(to)) > 1) throw new Error(`${path}: 線が中間ノードを横切らないよう、隣接する列へ接続するかページを分けてください`);
    return { from, to, ...(edge.label === undefined ? {} : { label: content(edge.label, `${path}.label`, LIMITS.connectionLabel) }) };
  });
  return { ...base, kind, columns, connections };
}

/** Conservative pure fallback; hosts can inject their renderer's installed-font measurements. */
const fallbackMeasure: SlideTextMeasure = (value, style) => graphemes(value).reduce((width, cluster) => {
  const units = /^[\x20-\x7e]+$/.test(cluster) ? (/^[ilI.,'!| ]$/.test(cluster) ? .38 : /^[MW@#%]$/.test(cluster) ? 1 : .66) : 1.08;
  return width + units * style.fontSize * (style.bold ? 1.04 : 1);
}, 0);
type Box = { x: number; y: number; width: number; height: number };
const intersect = (a: Box, b: Box) => a.x < b.x + b.width - .01 && a.x + a.width > b.x + .01 && a.y < b.y + b.height - .01 && a.y + a.height > b.y + .01;
type Rgb = [number, number, number];
function over(base: Rgb, color: string, opacity = 1): Rgb {
  if (color === "transparent") return base;
  const alpha = opacity * (color.length === 9 ? parseInt(color.slice(7, 9), 16) / 255 : 1);
  return base.map((channel, index) => channel * (1 - alpha) + parseInt(color.slice(1 + index * 2, 3 + index * 2), 16) / 255 * alpha) as Rgb;
}
function dark(color: Rgb): boolean {
  const linear = color.map(channel => channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4);
  return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722 < .26;
}
function hash(value: string): string {
  let result = 2166136261;
  for (const part of value) result = Math.imul(result ^ part.codePointAt(0)!, 16777619) >>> 0;
  return result.toString(36);
}

/** Returns an atomic ordinary replacement command. No content is truncated or automatically shrunk. */
export function composeSlideContent(deck: SlideDeck, slideId: string, composition: SlideComposition, options: SlideCompositionOptions = {}): Extract<SlideCommand, { type: "slide.replaceContent" }> {
  const source = normalizeSlideDeck(deck), page = source.slides.find(slide => slide.id === identifier(slideId));
  if (!page) throw new Error(`操作するスライドが見つかりません: ${slideId}`);
  if (page.elements.some(element => element.locked)) throw new Error("ロックされた要素は変更できません");
  const acceptedOptions = record(options, "composition options", ["preset", "notes", "measureText"]);
  const preset = choice(acceptedOptions.preset ?? "executive", ["executive", "editorial", "contrast"], "preset");
  const measure = acceptedOptions.measureText === undefined ? fallbackMeasure : acceptedOptions.measureText as SlideTextMeasure;
  if (typeof measure !== "function") throw new Error("measureTextには文字幅を測定する関数を指定してください");
  const notes = acceptedOptions.notes === undefined ? undefined : text(acceptedOptions.notes, "notes", SLIDE_LIMITS.textLength);
  const data = validateComposition(composition), appearance = resolveSlideAppearance(source, page);
  const background = page.layoutId ? undefined : preset === "contrast" ? "#141826" : preset === "editorial" ? "#fbf8f2" : "#ffffff";
  const s = Math.min(source.width / 1280, source.height / 720);
  if (source.width < 640 || source.height < 360 || source.width / source.height < 1.1 || source.width / source.height > 2.5)
    throw new Error("slide.compose: 640×360px以上、横縦比1.1〜2.5のスライドを使用してください");
  const theme = preset === "editorial" ? { ink: "#302c28", accent: "#a6472e", panel: "#f5efe6", font: "Georgia, Yu Mincho, serif", title: 44 }
    : preset === "contrast" ? { ink: "#171a2b", accent: "#6344c6", panel: "#eeebf8", font: "Arial, Yu Gothic, sans-serif", title: 46 }
      : { ink: "#173f5f", accent: "#147d92", panel: "#edf3f5", font: "Arial, Yu Gothic, sans-serif", title: 42 };
  let canvasColor = over([1, 1, 1], background ?? appearance.background);
  for (const element of appearance.inheritedElements) if (element.type === "shape" && element.shape === "rect" && !element.rotation && element.x <= 0 && element.y <= 0 && element.width >= source.width && element.height >= source.height)
    canvasColor = over(canvasColor, element.fill, element.opacity);
  const night = dark(canvasColor), ink = night ? "#f4f6fa" : theme.ink, secondary = night ? "#d4dce7" : "#52616e";
  const accent = night ? (preset === "editorial" ? "#f2b093" : preset === "contrast" ? "#b9a5ff" : "#79d6d2") : theme.accent;
  let left = 54 * s, right = source.width - 54 * s, top = 42 * s, bottom = source.height - 42 * s;
  const obstacles: Box[] = [], inheritedArtwork: Box[] = [];
  for (const element of appearance.inheritedElements) {
    if (!element.opacity || element.type === "shape" && !element.text && element.fill === "transparent" && !element.strokeWidth) continue;
    const bounds = getSlideElementBounds(element), box = { x: bounds.left, y: bounds.top, width: bounds.right - bounds.left, height: bounds.bottom - bounds.top };
    // Full-canvas rectangles are inherited backgrounds, never covered or replaced.
    if (element.type === "shape" && element.shape === "rect" && !element.text && !element.rotation && box.x <= 0 && box.y <= 0 && box.width >= source.width && box.height >= source.height) continue;
    inheritedArtwork.push(box);
    if (bounds.bottom <= source.height * .22) top = Math.max(top, bounds.bottom + 22 * s);
    else if (bounds.top >= source.height * .78) bottom = Math.min(bottom, bounds.top - 22 * s);
    else if (bounds.right <= source.width * .15) left = Math.max(left, bounds.right + 22 * s);
    else if (bounds.left >= source.width * .85) right = Math.min(right, bounds.left - 22 * s);
    else obstacles.push(box);
  }
  const area = { x: left, y: top, width: right - left, height: bottom - top };
  if (area.width < 720 * s || area.height < 420 * s || obstacles.some(box => intersect(box, area)))
    throw new Error("slide.compose: マスターの装飾と重ならない領域が不足しています。装飾が上下端にあるレイアウトへ変更するか、通常の要素編集APIで配置してください");
  const elements: SlideElement[] = [], ids = new Set<string>();
  const existingIds = new Set([...source.slides.filter(slide => slide.id !== page.id).flatMap(slide => slide.elements), ...(source.masters ?? []).flatMap(master => master.elements), ...(source.layouts ?? []).flatMap(layout => [...layout.elements, ...layout.placeholders.map(slot => slot.element)])].map(element => element.id));
  const id = (slot: string) => {
    const result = `compose-${hash(page.id)}-${slot}`;
    if (ids.has(result) || existingIds.has(result)) throw new Error(`slide.compose: 生成IDが既存要素と衝突しています: ${result}。対象ページのIDを一意にしてください`);
    ids.add(result); return result;
  };
  const shape = (slot: string, box: Box, fill = theme.panel, round = true) => {
    const element = createSlideElement({ type: "shape", id: id(slot), name: slot, ...box, shape: round ? "roundRect" : "rect", fill, stroke: "transparent", strokeWidth: 0, text: "" });
    elements.push(element); return element;
  };
  const write = (slot: string, value: string, box: Box, size: number, path: string, color = ink, bold = false, extra: Partial<SlideTextElement> = {}) => {
    // Renderer padding is fixed in document pixels. Compensate the frame so its
    // content geometry, rather than its padding, scales with the canvas.
    const frame = extra.layoutPlaceholderId ? box : { x: box.x + 10 * (s - 1), y: box.y + 8 * (s - 1), width: box.width - 20 * (s - 1), height: box.height - 16 * (s - 1) };
    const element = createSlideElement({ type: "text", id: id(slot), name: path, ...frame, text: value, fontSize: size * s,
      fontFamily: "Arial, Yu Gothic, sans-serif", color, bold, fill: "transparent", ...extra }) as SlideTextElement;
    const layout = measureSlideText(element, measure);
    if (layout.overflow) throw new Error(`${path}: ${layout.lines.length}行は領域に収まりません（目安${Math.max(1, Math.floor(layout.availableHeight / (element.fontSize * 1.2)))}行）。文章を短くするか複数ページに分けてください。文字サイズは自動縮小しません`);
    elements.push(element); return element;
  };
  let cursor = top;
  if (data.eyebrow) { write("eyebrow", data.eyebrow, { x: left, y: cursor, width: area.width, height: 38 * s }, 16, "composition.eyebrow", accent, true); cursor += 40 * s; }
  const layout = source.layouts?.find(layout => layout.id === page.layoutId);
  const titleSlot = layout?.placeholders.find(slot => /^(title|ctrTitle)$/i.test(slot.kind) && slot.element.type === "text" && !slot.element.rotation
    && slot.element.x >= 20 * s && slot.element.x + slot.element.width <= source.width - 20 * s && slot.element.y >= (data.eyebrow ? cursor : 0)
    && !inheritedArtwork.some(artwork => intersect(artwork, slot.element))
    && slot.element.y <= source.height * .30 && slot.element.height >= 65 * s && slot.element.height <= 150 * s);
  const titleBox = titleSlot ? { x: titleSlot.element.x, y: titleSlot.element.y, width: titleSlot.element.width, height: titleSlot.element.height }
    : { x: left, y: cursor, width: area.width, height: (data.kind === "hero" ? 128 : 112) * s };
  const titleStyle = titleSlot?.element.type === "text" ? { layoutPlaceholderId: titleSlot.id, fontSize: titleSlot.element.fontSize,
    fontFamily: titleSlot.element.fontFamily, color: titleSlot.element.color, bold: titleSlot.element.bold, italic: titleSlot.element.italic,
    align: titleSlot.element.align, verticalAlign: titleSlot.element.verticalAlign, fill: titleSlot.element.fill, opacity: titleSlot.element.opacity } : { fontFamily: theme.font };
  write("title", data.title, titleBox, data.kind === "hero" ? theme.title + 8 : theme.title, "composition.title", ink, true, titleStyle);
  cursor = titleBox.y + titleBox.height + 10 * s;
  if (data.subtitle) { write("subtitle", data.subtitle, { x: left, y: cursor, width: area.width, height: 74 * s }, 21, "composition.subtitle", secondary); cursor += 80 * s; }
  const footerHeight = data.footer ? 42 * s : 0;
  const body: Box = { x: left, y: cursor + 12 * s, width: area.width, height: bottom - footerHeight - cursor - 12 * s };
  if (body.height < 180 * s) throw new Error("composition: 見出し・サブタイトル・マスターで本文領域が不足しています。サブタイトルを省略するか、タイトル領域の小さなレイアウトへ変更してください");
  if (data.footer) write("footer", data.footer, { x: left, y: bottom - footerHeight + 6 * s, width: area.width, height: 36 * s }, 14, "composition.footer", secondary);
  const panel = (slot: string, box: Box, title: string, value: string, path: string, options: { number?: number; small?: boolean; active?: boolean } = {}) => {
    const background = options.active ? theme.ink : theme.panel, foreground = options.active ? "#ffffff" : theme.ink;
    const element = shape(slot, box, background), pad = 18 * s;
    let y = box.y + pad;
    if (options.number !== undefined) { write(`${slot}-number`, String(options.number).padStart(2, "0"), { x: box.x + pad, y, width: box.width - pad * 2, height: 38 * s }, 17, path, options.active ? "#ffffff" : theme.accent, true); y += 40 * s; }
    const titleHeight = (options.small ? 64 : 76) * s;
    write(`${slot}-title`, title, { x: box.x + pad, y, width: box.width - pad * 2, height: titleHeight }, options.small ? 21 : 25, `${path}.title`, foreground, true);
    y += titleHeight + 4 * s;
    write(`${slot}-body`, value, { x: box.x + pad, y, width: box.width - pad * 2, height: box.y + box.height - pad - y }, options.small ? 18 : 21, `${path}.body`, options.active ? "#ffffff" : "#52616e");
    return element;
  };
  const connect = (slot: string, from: SlideElement, to: SlideElement, label: string | undefined, path: string) => {
    const horizontal = Math.abs(from.x - to.x) > .1, forward = horizontal ? to.x > from.x : to.y > from.y;
    const start = horizontal ? { x: forward ? from.x + from.width : from.x, y: from.y + from.height / 2 }
      : { x: from.x + from.width / 2, y: forward ? from.y + from.height : from.y };
    const end = horizontal ? { x: forward ? to.x : to.x + to.width, y: to.y + to.height / 2 }
      : { x: to.x + to.width / 2, y: forward ? to.y : to.y + to.height };
    const line = createSlideElement({ type: "shape", id: id(slot), name: path, shape: "line", fill: "transparent", stroke: accent, strokeWidth: 2 * s, endArrow: "triangle",
      line: { start: { ...start, binding: { targetId: from.id, port: horizontal ? (forward ? "right" : "left") : (forward ? "bottom" : "top") } }, end: { ...end, binding: { targetId: to.id, port: horizontal ? (forward ? "left" : "right") : (forward ? "top" : "bottom") } } } }) as SlideShapeElement;
    elements.unshift(line);
    if (label) {
      const width = horizontal ? Math.abs(end.x - start.x) - 4 * s : 150 * s;
      write(`${slot}-label`, label, { x: (start.x + end.x) / 2 - width / 2, y: (start.y + end.y) / 2 - (horizontal ? 76 : 18) * s, width, height: (horizontal ? 66 : 36) * s }, 14, `${path}.label`, accent, false, { align: "center" });
    }
  };
  if (data.kind === "hero") {
    shape("rule", { x: body.x + 10, y: body.y + 10 * s, width: 96 * s, height: 5 * s }, accent, false);
    const items = data.highlights ?? [], gap = 28 * s, width = (body.width - gap * Math.max(0, items.length - 1)) / Math.max(1, items.length);
    items.forEach((value, index) => {
      const box = { x: body.x + index * (width + gap), y: body.y + Math.min(80 * s, body.height * .25), width, height: body.height - Math.min(80 * s, body.height * .25) };
      shape(`highlight-${index}`, box);
      write(`highlight-${index}-text`, value, { x: box.x + 20 * s, y: box.y + 24 * s, width: box.width - 40 * s, height: box.height - 48 * s }, 27, `composition.highlights[${index}]`, theme.ink, true);
    });
  } else if (data.kind === "comparison") {
    const gap = 36 * s, width = (body.width - gap) / 2;
    panel("before", { ...body, width }, data.before.title, data.before.body, "composition.before");
    panel("after", { ...body, x: body.x + width + gap, width }, data.after.title, data.after.body, "composition.after", { active: true });
  } else if (data.kind === "features") {
    const columns = data.items.length === 4 ? 2 : data.items.length, rows = data.items.length === 4 ? 2 : 1, gap = 24 * s;
    const width = (body.width - (columns - 1) * gap) / columns, height = (body.height - (rows - 1) * gap) / rows;
    data.items.forEach((item, index) => panel(`feature-${index}`, { x: body.x + index % columns * (width + gap), y: body.y + Math.floor(index / columns) * (height + gap), width, height }, item.title, item.body, `composition.items[${index}]`, { small: rows > 1, ...(rows === 1 ? { number: index + 1 } : {}) }));
  } else if (data.kind === "flow") {
    const gap = 42 * s, width = (body.width - gap * (data.steps.length - 1)) / data.steps.length;
    const nodes = data.steps.map((item, index) => panel(`step-${index}`, { ...body, x: body.x + index * (width + gap), width }, item.title, item.body, `composition.steps[${index}]`, { number: index + 1, small: true }));
    nodes.slice(1).forEach((node, index) => connect(`flow-${index}`, nodes[index], node, undefined, `composition.steps[${index}]`));
  } else if (data.kind === "architecture") {
    const gap = 72 * s, width = (body.width - gap * (data.columns.length - 1)) / data.columns.length, nodes = new Map<string, SlideElement>();
    data.columns.forEach((column, columnIndex) => {
      const x = body.x + columnIndex * (width + gap);
      write(`column-${columnIndex}`, column.title, { x, y: body.y, width, height: 62 * s }, 19, `composition.columns[${columnIndex}].title`, accent, true);
      const height = (body.height - 76 * s - (column.nodes.length - 1) * 44 * s) / column.nodes.length;
      column.nodes.forEach((node, nodeIndex) => {
        const path = `composition.columns[${columnIndex}].nodes[${nodeIndex}]`, slot = `node-${columnIndex}-${nodeIndex}`;
        const box = { x, y: body.y + 76 * s + nodeIndex * (height + 44 * s), width, height }, element = shape(slot, box);
        const titleHeight = node.body ? Math.min(70 * s, height * .5) : height - 24 * s;
        write(`${slot}-title`, node.title, { x: x + 10 * s, y: box.y + 12 * s, width: width - 20 * s, height: titleHeight }, 21, `${path}.title`, theme.ink, true);
        if (node.body) write(`${slot}-body`, node.body, { x: x + 10 * s, y: box.y + 12 * s + titleHeight, width: width - 20 * s, height: height - 24 * s - titleHeight }, 17, `${path}.body`, "#52616e");
        nodes.set(node.id, element);
      });
    });
    data.connections.forEach((edge, index) => connect(`connection-${index}`, nodes.get(edge.from)!, nodes.get(edge.to)!, edge.label, `composition.connections[${index}]`));
  } else {
    shape("action-rule", { x: body.x, y: body.y + 10 * s, width: 7 * s, height: body.height - 20 * s }, accent, false);
    const actionHeight = data.details ? body.height * .55 : body.height - 20 * s;
    write("action", data.action, { x: body.x + 32 * s, y: body.y, width: body.width - 48 * s, height: actionHeight }, 34, "composition.action", accent, true);
    if (data.details) write("details", data.details, { x: body.x + 32 * s, y: body.y + actionHeight + 10 * s, width: body.width - 48 * s, height: body.height - actionHeight - 10 * s }, 22, "composition.details", secondary);
  }
  // Validate the full candidate, including global IDs, placeholder ownership and connector bindings.
  const candidate = normalizeSlideDeck({ ...source, slides: source.slides.map(slide => slide.id === page.id ? { ...slide, elements, animations: undefined, ...(background === undefined ? {} : { background }), ...(notes === undefined ? {} : { notes }) } : slide) });
  for (const element of candidate.slides.find(slide => slide.id === page.id)!.elements) {
    const bounds = getSlideElementBounds(element);
    if (bounds.left < -.01 || bounds.top < -.01 || bounds.right > source.width + .01 || bounds.bottom > source.height + .01)
      throw new Error(`${element.name}: 要素がページ外へはみ出します。内容を短くするか別のレイアウトを選択してください`);
  }
  return { type: "slide.replaceContent", slideId: page.id, elements: candidate.slides.find(slide => slide.id === page.id)!.elements, ...(background === undefined ? {} : { background }), ...(notes === undefined ? {} : { notes }) };
}
