import type { OfficePackageInput } from "../ooxml";
import { normalizeSlideMasterLibrary } from "../model";
import type { SlideLayout, SlideMaster, SlideMasterLibrary } from "../model/types";
import { SLIDE_LIMITS } from "../model/limits";
import { child, children, localName, shapes, placeholder, readTheme, readFill, color, relationship, type Node, type PptxContext, type Relations, type Theme } from "./pptx-reader";
import { readElement } from "./pptx-elements";
import { resolvePptxConnections, type PptxConnectionSource } from "./pptx-connectors";
import { openPptxPresentation } from "./pptx-package";
import type { SlidePptxImportOptions } from "./import-pptx";
import type { SlidePptxDiagnostic } from "../office/types";

export type SlidePptxMastersImportResult = { library: SlideMasterLibrary; warnings: string[]; diagnostics: readonly SlidePptxDiagnostic[] };
export type PptxPlaceholderIndex = { nodes: Node[]; byIndex: Map<string, Node>; byType: Map<string, Node> };
export function placeholderIndex(root: Node | undefined): PptxPlaceholderIndex {
  const nodes = shapes(root), byIndex = new Map<string, Node>(), byType = new Map<string, Node>();
  if (nodes.length > SLIDE_LIMITS.elementsPerSlide) throw new Error("テンプレートのオブジェクト数が上限を超えています");
  for (const node of nodes) { const ph = placeholder(node); if (!ph) continue;
    if (!byIndex.has(ph.attributes.idx ?? "0")) byIndex.set(ph.attributes.idx ?? "0", node);
    if (!byType.has(ph.attributes.type ?? "obj")) byType.set(ph.attributes.type ?? "obj", node);
  }
  return { nodes, byIndex, byType };
}
export const masterPlaceholder = (index: PptxPlaceholderIndex, kind: string): Node | undefined => index.byType.get(kind)
  ?? (kind === "ctrTitle" ? index.byType.get("title") : ["obj", "subTitle"].includes(kind) ? index.byType.get("body") : undefined);
export function placeholderDefaults(presentation: Node, master: Node | undefined, kind?: string): Node[] {
  const style = !kind ? "otherStyle" : ["title", "ctrTitle"].includes(kind) ? "titleStyle" : ["body", "obj"].includes(kind) ? "bodyStyle" : "otherStyle";
  return [child(child(child(presentation, "defaultTextStyle"), "lvl1pPr"), "defRPr"), child(child(child(master, "txStyles"), style), "lvl1pPr")]
    .flatMap(node => node ? localName(node.name) === "defRPr" ? [node] : children(node, "defRPr") : []);
}
export const pptxColorMapping = (master?: Node, layout?: Node, slide?: Node) => ({ bg1: "lt1", tx1: "dk1", bg2: "lt2", tx2: "dk2", ...child(master, "clrMap")?.attributes,
  ...child(child(layout, "clrMapOvr"), "overrideClrMapping")?.attributes, ...child(child(slide, "clrMapOvr"), "overrideClrMapping")?.attributes });
export function pptxBackground(root: Node | undefined, theme: Theme, mapping: Record<string, string>, context: PptxContext): string | undefined {
  const bg = child(child(root, "cSld"), "bg");
  return readFill(child(bg, "bgPr"), theme, mapping, context) ?? color(child(bg, "bgRef"), theme, mapping, context);
}
export type PptxLayoutSource = { layout: SlideLayout; root: Node; master: Node; links: Relations; theme: Theme; mapping: Record<string, string>;
  index: PptxPlaceholderIndex; masterIndex: PptxPlaceholderIndex; slots: ReadonlyMap<Node, string> };
export type PptxMasterLibrarySource = { library: SlideMasterLibrary; sources: Map<string, PptxLayoutSource> };
export async function readPptxMasterLibrary(context: PptxContext, presentation: Node, presentationLinks: Relations, width: number, height: number): Promise<PptxMasterLibrarySource> {
  const masters: SlideMaster[] = [], layouts: SlideLayout[] = [], sources = new Map<string, PptxLayoutSource>(), seenMasters = new Set<string>(), seenLayouts = new Set<string>();
  let hasOriginalTheme = false;
  const relationId = (node: Node) => Object.entries(node.attributes).find(([key]) => key.endsWith(":id"))?.[1];
  const entries = children(child(presentation, "sldMasterIdLst"), "sldMasterId");
  if (entries.length > SLIDE_LIMITS.masters) throw new Error("マスターの数が上限を超えています");
  for (const [masterIndex, entry] of entries.entries()) {
    await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal?.throwIfAborted();
    const link = presentationLinks.get(relationId(entry) ?? "");
    if (!link || link.external || !link.type.endsWith("/slideMaster") || seenMasters.has(link.target)) throw new Error("マスターの参照が不正または重複しています");
    seenMasters.add(link.target);
    const root = await context.root(link.target), links = await context.links(link.target);
    if (localName(root.name) !== "sldMaster") throw new Error("スライドマスターの構造が不正です");
    const id = `pptx-master-${masterIndex + 1}`, theme = await readTheme(context, link.target), mapping = pptxColorMapping(root), index = placeholderIndex(root);
    const themeLink = relationship(links, "theme");
    if (themeLink && (await context.root(themeLink.target)).attributes.name !== "LikeSlide") hasOriginalTheme = true;
    context.location = { sourcePart: link.target };
    const master: SlideMaster = { id, name: child(root, "cSld")?.attributes.name || `マスター ${masterIndex + 1}`, background: pptxBackground(root, theme, mapping, context) ?? "#FFFFFF", elements: [] };
    const connections: PptxConnectionSource[] = [];
    for (const [i, node] of index.nodes.entries()) if (!placeholder(node)) {
      if (i % 32 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal?.throwIfAborted(); }
      if (++context.totalElements > SLIDE_LIMITS.totalElements) throw new Error("テンプレートのオブジェクト数が読み込み上限を超えています");
      const element = await readElement([node], { context, theme, mapping, links, defaults: placeholderDefaults(presentation, root) }, `${id}-element-${i + 1}`);
      if (element) { master.elements.push(element); connections.push({ node, element, scope: links }); }
    }
    resolvePptxConnections(master.elements, connections, context); masters.push(master);
    if (child(root, "timing")) context.warn("マスターのアニメーションは省略しました。必要な動きは適用後のスライドへ設定してください");
    const layoutEntries = children(child(root, "sldLayoutIdLst"), "sldLayoutId");
    for (const layoutEntry of layoutEntries) {
      context.signal?.throwIfAborted();
      if (layouts.length >= SLIDE_LIMITS.layouts) throw new Error("レイアウトの数が上限を超えています");
      const layoutLink = links.get(relationId(layoutEntry) ?? "");
      if (!layoutLink || layoutLink.external || !layoutLink.type.endsWith("/slideLayout") || seenLayouts.has(layoutLink.target)) throw new Error("レイアウトの参照が不正または重複しています");
      seenLayouts.add(layoutLink.target);
      const layoutRoot = await context.root(layoutLink.target), layoutLinks = await context.links(layoutLink.target);
      if (localName(layoutRoot.name) !== "sldLayout" || relationship(layoutLinks, "slideMaster")?.target !== link.target) throw new Error("レイアウトとマスターの参照が一致しません");
      context.location = { sourcePart: layoutLink.target };
      const layoutId = `pptx-layout-${layouts.length + 1}`, layoutMapping = pptxColorMapping(root, layoutRoot), layoutIndex = placeholderIndex(layoutRoot);
      const background = pptxBackground(layoutRoot, theme, layoutMapping, context);
      const layout: SlideLayout = { id: layoutId, masterId: id, name: child(layoutRoot, "cSld")?.attributes.name || layoutRoot.attributes.matchingName || `レイアウト ${layouts.length + 1}`,
        ...(background !== undefined ? { background } : {}), elements: [], placeholders: [], ...(["0", "false"].includes(layoutRoot.attributes.showMasterSp ?? "") ? { showMasterShapes: false } : {}) };
      const slots = new Map<Node, string>(), layoutConnections: PptxConnectionSource[] = [];
      for (const [i, node] of layoutIndex.nodes.entries()) {
        if (i % 32 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); context.signal?.throwIfAborted(); }
        if (++context.totalElements > SLIDE_LIMITS.totalElements) throw new Error("テンプレートのオブジェクト数が読み込み上限を超えています");
        const ph = placeholder(node), kind = ph?.attributes.type ?? "obj", inherited = ph ? masterPlaceholder(index, kind) : undefined;
        const element = await readElement([node, inherited].filter((node): node is Node => !!node), { context, theme, mapping: layoutMapping, links: layoutLinks, defaults: placeholderDefaults(presentation, root, ph ? kind : undefined) }, `${layoutId}-element-${i + 1}`);
        if (!element) continue;
        if (ph) { const slotId = `${layoutId}-placeholder-${i + 1}`; layout.placeholders.push({ id: slotId, kind, element }); slots.set(node, slotId); }
        else layout.elements.push(element);
        layoutConnections.push({ node, element, scope: layoutLinks });
      }
      const allElements = [...layout.elements, ...layout.placeholders.map(item => item.element)]; resolvePptxConnections(allElements, layoutConnections, context);
      const resolved = new Map(allElements.map(element => [element.id, element]));
      layout.elements = layout.elements.map(element => resolved.get(element.id)!); layout.placeholders = layout.placeholders.map(slot => ({ ...slot, element: resolved.get(slot.element.id)! }));
      if (child(layoutRoot, "timing") || child(layoutRoot, "transition")) context.warn("レイアウトのアニメーション・画面切り替えを省略しました");
      if (child(child(layoutRoot, "clrMapOvr"), "overrideClrMapping")) context.warn("レイアウトの色マッピングは個別要素へ反映しました。マスター装飾のテーマ連動は保持しません", { code: "appearance-adjusted", action: "adjustment" });
      layouts.push(layout); sources.set(layoutLink.target, { layout, root: layoutRoot, master: root, links: layoutLinks, theme, mapping: layoutMapping, index: layoutIndex, masterIndex: index, slots });
    }
  }
  context.location = {};
  if (hasOriginalTheme) context.warn("マスター・レイアウトの対応する色と文字書式を固定値として読み込みました。元テーマの配色変更・フォント連動・効果スタイルは保持しません", { code: "appearance-adjusted", action: "adjustment" });
  return { library: { width, height, masters, layouts }, sources };
}
/** Read every registered master/layout, including unused layouts and zero-slide POTX templates. */
export async function importSlidePptxMasters(input: OfficePackageInput, options: SlidePptxImportOptions = {}): Promise<SlidePptxMastersImportResult> {
  const { context, presentation, presentationLinks, width, height } = await openPptxPresentation(input, options);
  const { library } = await readPptxMasterLibrary(context, presentation, presentationLinks, width, height);
  const normalized = normalizeSlideMasterLibrary(library);
  const diagnostics = Object.freeze(context.diagnostics.map(item => Object.freeze({ ...item })));
  for (const item of diagnostics) { options.signal?.throwIfAborted(); options.onDiagnostic?.(item); }
  options.signal?.throwIfAborted();
  return { library: normalized, warnings: [...context.warnings], diagnostics };
}
