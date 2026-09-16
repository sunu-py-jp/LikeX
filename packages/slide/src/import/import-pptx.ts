import { openOfficePackage, resolveOfficePart, type OfficePackageInput, type OfficePackageSignal } from "../ooxml";
import { normalizeSlideDeck } from "../model";
import { SLIDE_LIMITS } from "../model/limits";
import type { Slide, SlideDeck } from "../model/types";
import { createContext, child, children, localName, textContent, shapes, placeholder, readTheme, readFill, color, plainText, relationship, type Node } from "./pptx-reader";
import { readElement } from "./pptx-elements";

export type SlidePptxImportOptions = { signal?: OfficePackageSignal };
export type SlidePptxImportResult = { deck: SlideDeck; warnings: string[] };
const mainType = "application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml";
const fail = (message: string): never => { throw new Error(`PowerPointを読み込めません: ${message}`); };
function placeholderIndex(root: Node | undefined) {
  const nodes = shapes(root), byIndex = new Map<string, Node>(), byType = new Map<string, Node>();
  if (nodes.length > SLIDE_LIMITS.elementsPerSlide) return fail("テンプレートのオブジェクト数が上限を超えています");
  for (const node of nodes) { const ph = placeholder(node); if (!ph) continue;
    if (!byIndex.has(ph.attributes.idx ?? "0")) byIndex.set(ph.attributes.idx ?? "0", node);
    if (!byType.has(ph.attributes.type ?? "obj")) byType.set(ph.attributes.type ?? "obj", node);
  }
  return { nodes, byIndex, byType };
}

/** Reads a bounded PresentationML package without DOM parsing, external fetching, or macro execution. */
export async function importSlidePptx(input: OfficePackageInput, options: SlidePptxImportOptions = {}): Promise<SlidePptxImportResult> {
  const { signal } = options; signal?.throwIfAborted();
  if (input && typeof input === "object" && "name" in input && typeof input.name === "string" && !/\.pptx$/i.test(input.name))
    return fail(".pptx形式を指定してください。古い.ppt形式と暗号化ファイルには対応していません");
  let archive;
  try { archive = await openOfficePackage(input, signal); }
  catch (cause) { if (signal?.aborted || cause instanceof Error && cause.name === "AbortError") throw cause;
    return fail(`暗号化されていない.pptx形式を指定してください（古い.pptは未対応）。${cause instanceof Error ? cause.message : "不正なファイルです"}`); }
  const context = createContext(archive, signal), content = await context.root("[Content_Types].xml"), contentTypes = new Map<string, string>();
  if (localName(content.name) !== "Types") return fail("Officeパッケージの構造が不正です");
  for (const entry of content.children) {
    const type = entry.attributes.ContentType;
    if (!type || /macroEnabled|vbaProject|encrypted/i.test(type)) return fail("マクロ・暗号化ファイルには対応していません");
    if (localName(entry.name) === "Override") {
      const path = resolveOfficePart("", entry.attributes.PartName ?? "");
      if (contentTypes.has(path)) return fail("コンテンツ形式が重複しています");
      contentTypes.set(path, type);
    }
  }
  if (archive.paths.some(path => /(?:^|\/)(?:vbaProject\.bin|EncryptedPackage|EncryptionInfo)$/i.test(path))) return fail("マクロ・暗号化ファイルには対応していません");
  for (const path of archive.paths.filter(path => path.endsWith(".rels"))) {
    const match = /^(?:(.*)\/)?_rels\/([^/]*)\.rels$/.exec(path); if (!match) return fail("参照情報の場所が不正です");
    const part = `${match[1] ? `${match[1]}/` : ""}${match[2]}`;
    for (const link of (await context.links(part)).values()) {
      if (/vbaProject|attachedTemplate/i.test(link.type)) return fail("マクロ・外部テンプレートには対応していません");
      if (link.external) context.warn("外部リンク・外部画像を読み込まずに省略しました");
    }
  }
  const packageLinks = await context.links(""), presentationLink = relationship(packageLinks, "officeDocument");
  if (!presentationLink || contentTypes.get(presentationLink.target) !== mainType) return fail(".pptx形式のプレゼンテーションではありません");
  const presentation = await context.root(presentationLink.target), presentationLinks = await context.links(presentationLink.target);
  if (localName(presentation.name) !== "presentation") return fail("プレゼンテーションの構造が不正です");
  const size = child(presentation, "sldSz"), width = Number(size?.attributes.cx) / 9525, height = Number(size?.attributes.cy) / 9525;
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) return fail("スライドのサイズが不正です");
  const slideNodes = children(child(presentation, "sldIdLst"), "sldId");
  if (!slideNodes.length || slideNodes.length > SLIDE_LIMITS.slides) return fail("スライド数は1〜500枚にしてください");
  const titleLink = [...packageLinks.values()].find(link => link.type.endsWith("/metadata/core-properties") && !link.external);
  const title = titleLink ? textContent(child(await context.root(titleLink.target), "title")) : "";
  const slides: Slide[] = [], seen = new Set<string>();
  const indexCache = new Map<string, ReturnType<typeof placeholderIndex>>();
  for (const [index, slideNode] of slideNodes.entries()) {
    signal?.throwIfAborted();
    const relationId = Object.entries(slideNode.attributes).find(([key]) => key.endsWith(":id"))?.[1];
    const link = presentationLinks.get(relationId ?? "");
    if (!link || link.external || !link.type.endsWith("/slide") || seen.has(link.target)) return fail("スライドの参照が不正または重複しています");
    seen.add(link.target);
    const root = await context.root(link.target), links = await context.links(link.target);
    if (localName(root.name) !== "sld") return fail("スライドの構造が不正です");
    const layoutLink = relationship(links, "slideLayout");
    const layout = layoutLink ? await context.root(layoutLink.target) : undefined;
    const layoutLinks = layoutLink ? await context.links(layoutLink.target) : new Map();
    const masterLink = relationship(layoutLinks, "slideMaster");
    const master = masterLink ? await context.root(masterLink.target) : undefined;
    if (!layout || !master) context.warn("マスター・レイアウトのないスライドは、スライド内の書式のみで読み込みました");
    const theme = await readTheme(context, masterLink?.target);
    const mapping = { bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2", ...child(master, "clrMap")?.attributes,
      ...child(child(layout, "clrMapOvr"), "overrideClrMapping")?.attributes, ...child(child(root, "clrMapOvr"), "overrideClrMapping")?.attributes };
    const getIndex = (part: string | undefined, node: Node | undefined) => {
      if (!part) return placeholderIndex(node);
      let cached = indexCache.get(part); if (!cached) { cached = placeholderIndex(node); indexCache.set(part, cached); } return cached;
    };
    const layoutIndex = getIndex(layoutLink?.target, layout), masterIndex = getIndex(masterLink?.target, master);
    let background = "#FFFFFF";
    for (const node of [master, layout, root]) {
      const bg = child(child(node, "cSld"), "bg");
      background = readFill(child(bg, "bgPr"), theme, mapping, context) ?? color(child(bg, "bgRef"), theme, mapping, context) ?? background;
    }
    const elements: Slide["elements"] = [];
    const showMaster = !["0", "false"].includes(root.attributes.showMasterSp ?? "") && !["0", "false"].includes(layout?.attributes.showMasterSp ?? "");
    const ordered = [...(showMaster ? masterIndex.nodes.filter(node => !placeholder(node)).map(node => ({ node, links: masterLink ? context.relations.get(masterLink.target)! : links })) : []),
      ...layoutIndex.nodes.filter(node => !placeholder(node)).map(node => ({ node, links: layoutLinks })), ...shapes(root).map(node => ({ node, links }))];
    if (ordered.length > SLIDE_LIMITS.elementsPerSlide || context.totalElements + ordered.length > SLIDE_LIMITS.totalElements) return fail("スライドのオブジェクト数が読み込み上限を超えています");
    context.totalElements += ordered.length;
    for (const [elementIndex, source] of ordered.entries()) {
      if (elementIndex % 32 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      const ph = placeholder(source.node), inherited = ph ? layoutIndex.byIndex.get(ph.attributes.idx ?? "0") : undefined;
      const type = ph?.attributes.type ?? placeholder(inherited)?.attributes.type ?? "obj";
      const masterShape = ph ? masterIndex.byType.get(type) ?? (type === "ctrTitle" ? masterIndex.byType.get("title") : ["obj", "subTitle"].includes(type) ? masterIndex.byType.get("body") : undefined) : undefined;
      const chain = [source.node, inherited, masterShape].filter((node): node is Node => !!node);
      const styleName = !ph ? "otherStyle" : ["title", "ctrTitle"].includes(type) ? "titleStyle" : type === "body" || type === "obj" ? "bodyStyle" : "otherStyle";
      const defaults = [child(child(child(presentation, "defaultTextStyle"), "lvl1pPr"), "defRPr"), child(child(child(master, "txStyles"), styleName), "lvl1pPr")].flatMap(node => node ? localName(node.name) === "defRPr" ? [node] : children(node, "defRPr") : []);
      const element = await readElement(chain, { context, theme, mapping, links: source.links, defaults }, `pptx-${index + 1}-${elementIndex + 1}`);
      if (element) elements.push(element);
    }
    let notes = "";
    const notesLink = relationship(links, "notesSlide");
    if (notesLink) {
      const notesRoot = await context.root(notesLink.target);
      notes = shapes(notesRoot).filter(node => placeholder(node)?.attributes.type === "body").map(node => plainText(child(node, "txBody"))).join("\n");
      if (notes.length > SLIDE_LIMITS.textLength || (context.textCharacters += notes.length) > SLIDE_LIMITS.totalTextLength) return fail("ノートのテキスト量が読み込み上限を超えています");
    }
    if (child(root, "timing") || child(root, "transition")) context.warn("アニメーション・画面切り替えを省略しました");
    if (["0", "false"].includes(root.attributes.show ?? "")) context.warn("非表示のスライドを表示状態で読み込みました");
    const name = child(root, "cSld")?.attributes.name || elements.find(element => element.type === "text" && element.text)?.name || `スライド ${index + 1}`;
    slides.push({ id: `pptx-slide-${index + 1}`, name, background, notes, elements });
  }
  if (archive.paths.some(path => /(?:^|\/)(?:charts|diagrams|embeddings|activeX|media\/.*\.(?:mp4|mp3|wav|avi))(?:\/|\.|$)/i.test(path))) context.warn("グラフ・SmartArt・埋め込みファイル・音声・動画を省略しました");
  signal?.throwIfAborted();
  const deck = normalizeSlideDeck({ version: 1, id: "pptx-deck", title: title || "取り込んだプレゼンテーション", width, height, slides });
  return { deck, warnings: [...context.warnings] };
}
