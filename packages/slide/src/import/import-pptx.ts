import type { OfficePackageInput, OfficePackageSignal } from "../ooxml";
import { normalizeSlideDeck } from "../model";
import { SLIDE_LIMITS } from "../model/limits";
import type { Slide, SlideDeck } from "../model/types";
import { child, children, localName, shapes, placeholder, nonVisual, readTheme, plainText, relationship, type Node } from "./pptx-reader";
import { readElement } from "./pptx-elements";
import { readSlideAnimations } from "./pptx-animations";
import { resolvePptxConnections, type PptxConnectionSource } from "./pptx-connectors";
import type { SlidePptxDiagnostic } from "../office/types";
import { openPptxPresentation } from "./pptx-package";
import { readPptxMasterLibrary, placeholderIndex, masterPlaceholder, placeholderDefaults, pptxColorMapping, pptxBackground } from "./pptx-masters";

export type SlidePptxImportOptions = {
  signal?: OfficePackageSignal;
  /** Called after a complete, validated import. Throwing rejects the import. */
  onDiagnostic?: (diagnostic: SlidePptxDiagnostic) => void;
};
export type SlidePptxImportResult = { deck: SlideDeck; warnings: string[]; diagnostics: readonly SlidePptxDiagnostic[] };
const fail = (message: string): never => { throw new Error(`PowerPointを読み込めません: ${message}`); };

/** Reads a bounded PresentationML package without DOM parsing, external fetching, or macro execution. */
export async function importSlidePptx(input: OfficePackageInput, options: SlidePptxImportOptions = {}): Promise<SlidePptxImportResult> {
  const { signal } = options;
  const { context, archive, presentation, presentationLinks, width, height, title } = await openPptxPresentation(input, options);
  const { library, sources } = await readPptxMasterLibrary(context, presentation, presentationLinks, width, height);
  const slideNodes = children(child(presentation, "sldIdLst"), "sldId");
  if (!slideNodes.length || slideNodes.length > SLIDE_LIMITS.slides) return fail("スライド数は1〜500枚にしてください");
  const slides: Slide[] = [], seen = new Set<string>();
  for (const [index, slideNode] of slideNodes.entries()) {
    signal?.throwIfAborted();
    const relationId = Object.entries(slideNode.attributes).find(([key]) => key.endsWith(":id"))?.[1];
    const link = presentationLinks.get(relationId ?? "");
    if (!link || link.external || !link.type.endsWith("/slide") || seen.has(link.target)) return fail("スライドの参照が不正または重複しています");
    seen.add(link.target);
    const root = await context.root(link.target), links = await context.links(link.target);
    const slideLocation = { slideIndex: index, slideId: `pptx-slide-${index + 1}`, slideName: child(root, "cSld")?.attributes.name || `スライド ${index + 1}`, sourcePart: link.target };
    context.location = slideLocation;
    if (localName(root.name) !== "sld") return fail("スライドの構造が不正です");
    const layoutLink = relationship(links, "slideLayout"), source = layoutLink ? sources.get(layoutLink.target) : undefined;
    if (layoutLink && !source) return fail("スライドのレイアウトがマスター一覧に登録されていません");
    const layout = source?.root, master = source?.master;
    if (!layout || !master) context.warn("マスター・レイアウトのないスライドは、スライド内の書式のみで読み込みました", { code: "appearance-adjusted", action: "adjustment" });
    const theme = source?.theme ?? await readTheme(context, undefined), mapping = pptxColorMapping(master, layout, root);
    const layoutIndex = source?.index ?? placeholderIndex(undefined), masterIndex = source?.masterIndex ?? placeholderIndex(undefined);
    const ownBackground = pptxBackground(root, theme, mapping, context);
    const background = ownBackground ?? source?.layout.background ?? library.masters.find(item => item.id === source?.layout.masterId)?.background ?? "#FFFFFF";
    const elements: Slide["elements"] = [];
    const connectionSources: PptxConnectionSource[] = [];
    const animationTargets = new Map<string, Slide["elements"][number]>(), ambiguousIds = new Set<string>();
    const localShapes = new Set(shapes(root));
    const ordered = shapes(root).map(node => ({ node, links }));
    if (ordered.length > SLIDE_LIMITS.elementsPerSlide || context.totalElements + ordered.length > SLIDE_LIMITS.totalElements) return fail("スライドのオブジェクト数が読み込み上限を超えています");
    context.totalElements += ordered.length;
    for (const [elementIndex, source] of ordered.entries()) {
      if (elementIndex % 32 === 0) { await new Promise<void>(resolve => setTimeout(resolve, 0)); signal?.throwIfAborted(); }
      const ph = placeholder(source.node), inherited = ph ? layoutIndex.byIndex.get(ph.attributes.idx ?? "0") : undefined;
      const type = ph?.attributes.type ?? placeholder(inherited)?.attributes.type ?? "obj";
      const masterShape = ph ? masterPlaceholder(masterIndex, type) : undefined;
      const chain = [source.node, inherited, masterShape].filter((node): node is Node => !!node);
      const defaults = placeholderDefaults(presentation, master, ph ? type : undefined);
      context.location = { ...slideLocation, elementId: `pptx-${index + 1}-${elementIndex + 1}`, elementName: nonVisual(source.node)?.attributes.name };
      let element = await readElement(chain, { context, theme, mapping, links: source.links, defaults }, `pptx-${index + 1}-${elementIndex + 1}`);
      if (element) {
        const slotId = inherited && layoutLink ? sources.get(layoutLink.target)?.slots.get(inherited) : undefined;
        if (slotId) element = { ...element, layoutPlaceholderId: slotId };
        elements.push(element);
        connectionSources.push({ node: source.node, element, scope: source.links });
        if (localShapes.has(source.node)) {
          const shapeId = nonVisual(source.node)?.attributes.id;
          if (shapeId) {
            if (animationTargets.has(shapeId) || ambiguousIds.has(shapeId)) { animationTargets.delete(shapeId); ambiguousIds.add(shapeId); }
            else animationTargets.set(shapeId, element);
          }
        }
      }
    }
    context.location = slideLocation;
    resolvePptxConnections(elements, connectionSources, context);
    const connectedElements = new Map(elements.map(element => [element.id, element]));
    for (const [nativeId, element] of animationTargets) animationTargets.set(nativeId, connectedElements.get(element.id)!);
    let notes = "";
    const notesLink = relationship(links, "notesSlide");
    if (notesLink) {
      const notesRoot = await context.root(notesLink.target);
      notes = shapes(notesRoot).filter(node => placeholder(node)?.attributes.type === "body").map(node => plainText(child(node, "txBody"))).join("\n");
      if (notes.length > SLIDE_LIMITS.textLength || (context.textCharacters += notes.length) > SLIDE_LIMITS.totalTextLength) return fail("ノートのテキスト量が読み込み上限を超えています");
    }
    const animations = await readSlideAnimations(child(root, "timing"), { context, theme, mapping, targets: animationTargets, width, height, pageNumber: index + 1, layoutId: source?.layout.id,
      applyInitialValues(element) { const index = elements.findIndex(item => item.id === element.id); if (index !== -1) elements[index] = element; } });
    if (child(root, "transition")) context.warn("画面切り替えを省略しました");
    if (["0", "false"].includes(root.attributes.show ?? "")) context.warn("非表示のスライドを表示状態で読み込みました", { code: "appearance-adjusted", action: "adjustment" });
    const name = child(root, "cSld")?.attributes.name || elements.find(element => element.type === "text" && element.text)?.name || `スライド ${index + 1}`;
    slides.push({ id: `pptx-slide-${index + 1}`, name, background, notes, elements, ...(source ? { layoutId: source.layout.id, inheritBackground: ownBackground === undefined, ...(["0", "false"].includes(root.attributes.showMasterSp ?? "") ? { showMasterShapes: false } : {}) } : {}), ...(animations ? { animations } : {}) });
  }
  context.location = {};
  if (archive.paths.some(path => /(?:^|\/)(?:charts|diagrams|embeddings|activeX|media\/.*\.(?:mp4|mp3|wav|avi))(?:\/|\.|$)/i.test(path))) context.warn("グラフ・SmartArt・埋め込みファイル・音声・動画を省略しました");
  signal?.throwIfAborted();
  const deck = normalizeSlideDeck({ version: 1, id: "pptx-deck", title: title || "取り込んだプレゼンテーション", width, height, slides, ...(library.masters.length ? { masters: library.masters, layouts: library.layouts } : {}) });
  const diagnostics = Object.freeze(context.diagnostics.map(item => {
    const slide = item.slideIndex === undefined ? undefined : deck.slides[item.slideIndex];
    const element = slide?.elements.find(element => element.id === item.elementId);
    return Object.freeze({ ...item, ...(slide ? { slideName: slide.name } : {}), ...(element ? { elementName: element.name } : {}) });
  }));
  for (const diagnostic of diagnostics) { signal?.throwIfAborted(); options.onDiagnostic?.(diagnostic); }
  signal?.throwIfAborted();
  return { deck, warnings: [...context.warnings], diagnostics };
}
