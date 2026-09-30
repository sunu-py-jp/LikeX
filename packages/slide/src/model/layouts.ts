import type { Slide, SlideAppearance, SlideDeck, SlideElement, SlideLayout, SlideMaster, SlideMasterLibrary } from "./types";
import { normalizeSlide, normalizeSlideDeck, normalizeSlideElement, normalizeSlideMasterLibrary } from "./normalize";
import { copySlideLine, getSlideLineEndpoints, isSlideLine, slideLineGeometry } from "./lines";
import { identifier } from "./validation";
import { sameSlideElement } from "./query";

const emptyMasters = Object.freeze([]) as unknown as SlideMaster[];
const emptyLayouts = Object.freeze([]) as unknown as SlideLayout[];
export function getSlideMasters(deck: SlideDeck): SlideMaster[] { return normalizeSlideDeck(deck).masters ?? emptyMasters; }
export function getSlideLayouts(deck: SlideDeck, masterId?: string): SlideLayout[] {
  const layouts = normalizeSlideDeck(deck).layouts ?? emptyLayouts;
  if (masterId === undefined) return layouts;
  const id = identifier(masterId);
  return Object.freeze(layouts.filter(layout => layout.masterId === id)) as unknown as SlideLayout[];
}
export function getSlideLayout(deck: SlideDeck, layoutId: string): SlideLayout | undefined { const id = identifier(layoutId); return getSlideLayouts(deck).find(layout => layout.id === id); }

/** Composes inherited artwork without exposing it as editable page-owned elements. */
export function resolveSlideAppearance(deck: SlideDeck, slide: Slide): SlideAppearance {
  const source = normalizeSlideDeck(deck), local = normalizeSlide(slide);
  const layout = local.layoutId ? source.layouts?.find(item => item.id === local.layoutId) : undefined;
  if (local.layoutId && !layout) throw new Error("ページのレイアウトが見つかりません");
  const master = layout && source.masters!.find(item => item.id === layout.masterId)!;
  const inheritedElements = layout ? [...(master && layout.showMasterShapes !== false && local.showMasterShapes !== false ? master.elements : []), ...layout.elements] : [];
  return Object.freeze({ background: local.inheritBackground && layout ? layout.background ?? master!.background : local.background,
    inheritedElements: Object.freeze(inheritedElements) as unknown as SlideElement[], localElements: local.elements });
}

export function withoutLayoutPlaceholder(element: SlideElement): SlideElement {
  const result = { ...element }; delete result.layoutPlaceholderId; return result;
}

/** Same-type slots adopt layout styling; changed content types keep their content and common geometry. */
function placedPlaceholder(prototype: SlideElement, current: SlideElement | undefined, slotId: string): SlideElement {
  if (!current) return normalizeSlideElement({ ...prototype, id: crypto.randomUUID(), locked: false, layoutPlaceholderId: slotId,
    ...(prototype.type === "image" ? {} : { text: "" }) });
  const geometry = { x: prototype.x, y: prototype.y, width: prototype.width, height: prototype.height, rotation: prototype.rotation };
  const next = current.type === prototype.type ? { ...prototype, id: current.id, locked: current.locked,
    ...(current.type === "image" ? { src: current.src, alt: current.alt } : { text: current.text }) } : { ...current, ...geometry };
  return normalizeSlideElement({ ...next, layoutPlaceholderId: slotId });
}

export function applySlideLayout(deck: SlideDeck, slide: Slide, layoutId: string): Slide {
  const layout = getSlideLayout(deck, layoutId);
  if (!layout) throw new Error("適用するレイアウトが見つかりません");
  const previous = slide.layoutId ? getSlideLayout(deck, slide.layoutId) : undefined;
  const used = new Set<string>(), replacements = new Map<string, SlideElement>(), added: SlideElement[] = [];
  const linked = slide.elements.filter(element => element.layoutPlaceholderId !== undefined);
  for (const slot of layout.placeholders) {
    const sameSlot = linked.find(element => !used.has(element.id) && element.layoutPlaceholderId === slot.id);
    const sameRole = linked.find(element => !used.has(element.id) && previous?.placeholders.find(old => old.id === element.layoutPlaceholderId)?.kind === slot.kind);
    const current = sameSlot ?? sameRole;
    const next = placedPlaceholder(slot.element, current, slot.id);
    if (current) { used.add(current.id); replacements.set(current.id, next); } else added.push(next);
  }
  const elements = slide.elements.map(element => {
    const next = replacements.get(element.id) ?? (element.layoutPlaceholderId === undefined ? element : normalizeSlideElement(withoutLayoutPlaceholder(element)));
    if (element.locked && !sameSlideElement(next, element)) throw new Error("ロックされたプレースホルダーは変更できません");
    return next;
  });
  // All old local IDs survive, so animations and connections remain valid after slot remapping.
  const result = { ...slide, layoutId: layout.id, inheritBackground: true, elements: [...elements, ...added] };
  delete result.showMasterShapes;
  return normalizeSlide(result);
}

export function detachSlideLayout(deck: SlideDeck, slide: Slide): Slide {
  if (!slide.layoutId) return slide;
  const appearance = resolveSlideAppearance(deck, slide);
  const remap = new Map(appearance.inheritedElements.map(element => [element.id, crypto.randomUUID()]));
  const elements = [...appearance.inheritedElements.map(element => normalizeSlideElement(withoutLayoutPlaceholder(copySlideLine(element, remap)))),
    ...slide.elements.map(element => normalizeSlideElement(withoutLayoutPlaceholder(element)))];
  const result: Slide = { ...slide, background: appearance.background, elements };
  delete result.layoutId; delete result.inheritBackground; delete result.showMasterShapes;
  return normalizeSlide(result);
}

/** Imports definitions once, remapping every identity and scaling to the destination canvas. */
export function importSlideMasterLibrary(deck: SlideDeck, input: SlideMasterLibrary): { deck: SlideDeck; masterIds: string[]; layoutIds: string[] } {
  const library = normalizeSlideMasterLibrary(input), sx = deck.width / library.width, sy = deck.height / library.height, styleScale = Math.min(sx, sy);
  const masterIds = new Map(library.masters.map(master => [master.id, crypto.randomUUID()]));
  const layoutIds = new Map(library.layouts.map(layout => [layout.id, crypto.randomUUID()]));
  const allElements = [...library.masters.flatMap(master => master.elements), ...library.layouts.flatMap(layout => [...layout.elements, ...layout.placeholders.map(slot => slot.element)])];
  const elementIds = new Map(allElements.map(element => [element.id, crypto.randomUUID()]));
  const scale = (element: SlideElement): SlideElement => {
    let result = { ...element, id: elementIds.get(element.id)!, x: element.x * sx, y: element.y * sy, width: element.width * sx, height: element.height * sy,
      ...(element.type !== "image" ? { fontSize: element.fontSize * styleScale } : {}),
      ...(element.type === "shape" ? { strokeWidth: element.strokeWidth * styleScale } : {}) } as SlideElement;
    if (isSlideLine(element)) {
      const points = getSlideLineEndpoints(element);
      const endpoint = (point: typeof points.start) => ({ x: point.x * sx, y: point.y * sy,
        ...(point.binding ? { binding: { ...point.binding, targetId: elementIds.get(point.binding.targetId)! } } : {}) });
      const line = { start: endpoint(points.start), end: endpoint(points.end) };
      result = { ...result, ...slideLineGeometry(line), line } as SlideElement;
    }
    return normalizeSlideElement(result);
  };
  const masters = library.masters.map(master => ({ ...master, id: masterIds.get(master.id)!, elements: master.elements.map(scale) }));
  const layouts = library.layouts.map(layout => ({ ...layout, id: layoutIds.get(layout.id)!, masterId: masterIds.get(layout.masterId)!, elements: layout.elements.map(scale),
    placeholders: layout.placeholders.map(slot => ({ ...slot, id: crypto.randomUUID(), element: scale(slot.element) })) }));
  return { deck: normalizeSlideDeck({ ...deck, masters: [...(deck.masters ?? []), ...masters], layouts: [...(deck.layouts ?? []), ...layouts] }),
    masterIds: masters.map(master => master.id), layoutIds: layouts.map(layout => layout.id) };
}
