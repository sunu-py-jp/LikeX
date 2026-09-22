import type { Slide, SlideAnimationStep, SlideCommand, SlideCommandResult, SlideDeck, SlideElement, SlideElementInput } from "./types";
import { createSlide, createSlideElement, ELEMENT_KEYS, normalizeSlide, normalizeSlideDeck, normalizeSlideElement } from "./normalize";
import { getSlide, sameSlideDeck, sameSlideElement } from "./query";
import { choice, identifier, list, number, record } from "./validation";
import { SLIDE_LIMITS } from "./limits";
import { animationTargetIds, filterAnimationNode, normalizeSlideAnimations, sameAnimations } from "./animation-validation";

const COMMAND_KEYS: Record<SlideCommand["type"], readonly string[]> = {
  "deck.rename": ["type", "title"], "deck.resize": ["type", "width", "height"],
  "slide.add": ["type", "afterId", "slide"], "slide.delete": ["type", "slideId"],
  "slide.duplicate": ["type", "slideId"], "slide.move": ["type", "slideId", "index"],
  "slide.update": ["type", "slideId", "patch"], "element.add": ["type", "slideId", "element"],
  "element.update": ["type", "slideId", "elementId", "patch"], "element.delete": ["type", "slideId", "elementIds"],
  "element.duplicate": ["type", "slideId", "elementIds"], "element.order": ["type", "slideId", "elementIds", "direction"],
  "animation.set": ["type", "slideId", "animations"], "animation.remove": ["type", "slideId", "animationId"],
};

function requiredSlide(deck: SlideDeck, value: unknown): Slide {
  const slide = getSlide(deck, identifier(value), { includeAnimations: true });
  if (!slide) throw new Error("操作するスライドが見つかりません");
  return slide;
}

function selectedElements(slide: Slide, value: unknown): SlideElement[] {
  const ids = new Set(list(value, "操作する要素", SLIDE_LIMITS.elementsPerSlide).map(identifier));
  const selected = slide.elements.filter(element => ids.has(element.id));
  if (selected.length !== ids.size) throw new Error("操作する要素が見つかりません");
  return selected;
}

function requireUnlocked(elements: readonly SlideElement[]) {
  if (elements.some(element => element.locked)) throw new Error("ロックされた要素は変更できません");
}

function updateSlide(deck: SlideDeck, slide: Slide, patch: Partial<Slide>): SlideDeck {
  const updated = normalizeSlide({ ...slide, ...patch });
  return normalizeSlideDeck({ ...deck, slides: deck.slides.map(current => current.id === slide.id ? updated : current) });
}

function copyAnimations(slide: Slide, remap: ReadonlyMap<string, string>, offset = 0): SlideAnimationStep[] {
  return (slide.animations ?? []).flatMap(step => {
    const animation = filterAnimationNode(step.animation, id => remap.has(id), remap, offset);
    if (!animation) return [];
    const trigger = step.trigger?.type === "click" && step.trigger.elementId
      ? { ...step.trigger, elementId: remap.get(step.trigger.elementId) ?? step.trigger.elementId } : step.trigger;
    return [{ ...step, id: crypto.randomUUID(), ...(trigger ? { trigger } : {}), animation }];
  });
}
function requireUnlockedAnimations(slide: Slide, next: SlideAnimationStep[] | undefined): void {
  const before = new Map((slide.animations ?? []).map(step => [step.id, step]));
  const after = new Map((next ?? []).map(step => [step.id, step]));
  const beforeOrder = [...before.keys()].filter(id => after.has(id));
  const afterOrder = [...after.keys()].filter(id => before.has(id));
  for (const id of new Set([...before.keys(), ...after.keys()])) {
    const old = before.get(id), updated = after.get(id);
    if (old && updated && beforeOrder.indexOf(id) === afterOrder.indexOf(id) && sameAnimations([old], [updated])) continue;
    const targets = new Set([...(old ? animationTargetIds(old) : []), ...(updated ? animationTargetIds(updated) : [])]);
    requireUnlocked(slide.elements.filter(element => targets.has(element.id)));
  }
}

function applyOne(deck: SlideDeck, input: unknown): Omit<SlideCommandResult, "changed"> {
  const raw = record(input, "操作", [...new Set(Object.values(COMMAND_KEYS).flat())]);
  const type = choice(raw.type, Object.keys(COMMAND_KEYS) as SlideCommand["type"][], "操作");
  record(raw, "操作", COMMAND_KEYS[type]);
  const unchanged = { deck, elementIds: [] as string[] };
  if (type === "deck.rename") return { ...unchanged, deck: normalizeSlideDeck({ ...deck, title: raw.title }) };
  if (type === "deck.resize") return { ...unchanged, deck: normalizeSlideDeck({ ...deck, width: raw.width, height: raw.height }) };
  if (type === "slide.add") {
    const after = raw.afterId === undefined ? deck.slides.length - 1 : deck.slides.indexOf(requiredSlide(deck, raw.afterId));
    const slide = createSlide(raw.slide as Partial<Slide> | undefined);
    const next = [...deck.slides];
    next.splice(after + 1, 0, slide);
    return { deck: normalizeSlideDeck({ ...deck, slides: next }), slideId: slide.id, elementIds: [] };
  }
  const slide = requiredSlide(deck, raw.slideId);
  const slideIndex = deck.slides.indexOf(slide);
  if (type === "slide.delete") {
    if (deck.slides.length === 1) throw new Error("最後のスライドは削除できません");
    const next = deck.slides.filter(current => current !== slide);
    return { deck: normalizeSlideDeck({ ...deck, slides: next }), slideId: next[Math.min(slideIndex, next.length - 1)].id, elementIds: [] };
  }
  if (type === "slide.duplicate") {
    const remap = new Map(slide.elements.map(element => [element.id, crypto.randomUUID()]));
    const duplicate = createSlide({ ...slide, id: crypto.randomUUID(), name: `${slide.name.slice(0, 995)} のコピー`,
      elements: slide.elements.map(element => normalizeSlideElement({ ...element, id: remap.get(element.id)! })),
      animations: copyAnimations(slide, remap) });
    const next = [...deck.slides];
    next.splice(slideIndex + 1, 0, duplicate);
    return { deck: normalizeSlideDeck({ ...deck, slides: next }), slideId: duplicate.id, elementIds: [] };
  }
  if (type === "slide.move") {
    const index = number(raw.index, "挿入位置", 0, deck.slides.length - 1, true);
    const next = [...deck.slides];
    next.splice(slideIndex, 1);
    next.splice(index, 0, slide);
    return { deck: normalizeSlideDeck({ ...deck, slides: next }), slideId: slide.id, elementIds: [] };
  }
  if (type === "slide.update") {
    const patch = record(raw.patch, "スライドの変更", ["name", "background", "notes"]);
    return { deck: updateSlide(deck, slide, patch), slideId: slide.id, elementIds: [] };
  }
  if (type === "animation.set" || type === "animation.remove") {
    let animations: SlideAnimationStep[] | undefined;
    if (type === "animation.set") {
      if (raw.animations === undefined) throw new Error("アニメーションを配列で指定してください");
      animations = normalizeSlideAnimations(raw.animations, slide.elements);
    } else {
      const id = identifier(raw.animationId);
      if (!slide.animations?.some(step => step.id === id)) throw new Error("操作するアニメーションが見つかりません");
      animations = slide.animations.filter(step => step.id !== id);
    }
    requireUnlockedAnimations(slide, animations);
    return { deck: updateSlide(deck, slide, { animations }), slideId: slide.id, elementIds: [] };
  }
  if (type === "element.add") {
    const element = createSlideElement(raw.element as SlideElementInput);
    return { deck: updateSlide(deck, slide, { elements: [...slide.elements, element] }), slideId: slide.id, elementIds: [element.id] };
  }
  if (type === "element.update") {
    const id = identifier(raw.elementId);
    const element = slide.elements.find(current => current.id === id);
    if (!element) throw new Error("操作する要素が見つかりません");
    const patch = record(raw.patch, "要素の変更", ELEMENT_KEYS[element.type].filter(key => key !== "id" && key !== "type"));
    const updated = normalizeSlideElement({ ...element, ...patch });
    if (sameSlideElement(element, updated)) return { ...unchanged, slideId: slide.id, elementIds: [id] };
    if (element.locked && Object.keys(patch).some(key => key !== "locked" && Reflect.get(element, key) !== Reflect.get(updated, key)))
      throw new Error("ロックされた要素は変更できません。先にロックを解除してください");
    return { deck: updateSlide(deck, slide, { elements: slide.elements.map(current => current.id === id ? updated : current) }), slideId: slide.id, elementIds: [id] };
  }
  const selected = selectedElements(slide, raw.elementIds);
  requireUnlocked(selected);
  const ids = new Set(selected.map(element => element.id));
  if (type === "element.delete") {
    const animations = (slide.animations ?? []).flatMap(step => {
      if (step.trigger?.type === "click" && step.trigger.elementId && ids.has(step.trigger.elementId)) return [];
      const animation = filterAnimationNode(step.animation, id => !ids.has(id));
      return animation ? [{ ...step, animation }] : [];
    });
    requireUnlockedAnimations(slide, animations);
    return { deck: updateSlide(deck, slide, { elements: slide.elements.filter(element => !ids.has(element.id)), animations }), slideId: slide.id, elementIds: [] };
  }
  if (type === "element.duplicate") {
    const copies = selected.map(element => normalizeSlideElement({ ...element, id: crypto.randomUUID(),
      x: element.x + 20, y: element.y + 20 }));
    const remap = new Map(selected.map((element, index) => [element.id, copies[index].id]));
    const animations = [...(slide.animations ?? []), ...copyAnimations(slide, remap, 20)];
    requireUnlockedAnimations(slide, animations);
    return { deck: updateSlide(deck, slide, { elements: [...slide.elements, ...copies], animations }), slideId: slide.id, elementIds: copies.map(element => element.id) };
  }
  const direction = choice(raw.direction, ["front", "back", "forward", "backward"], "重なり順");
  let ordered = [...slide.elements];
  const rest = ordered.filter(element => !ids.has(element.id));
  if (direction === "front") ordered = [...rest, ...selected];
  else if (direction === "back") ordered = [...selected, ...rest];
  else if (direction === "forward") {
    for (let index = ordered.length - 2; index >= 0; index--) if (ids.has(ordered[index].id) && !ids.has(ordered[index + 1].id))
      [ordered[index], ordered[index + 1]] = [ordered[index + 1], ordered[index]];
  } else {
    for (let index = 1; index < ordered.length; index++) if (ids.has(ordered[index].id) && !ids.has(ordered[index - 1].id))
      [ordered[index], ordered[index - 1]] = [ordered[index - 1], ordered[index]];
  }
  return { deck: updateSlide(deck, slide, { elements: ordered }), slideId: slide.id, elementIds: [...ids] };
}

/** Validate each command privately; an invalid batch never mutates its input deck. */
export function applySlideCommands(deck: SlideDeck, commands: SlideCommand | readonly SlideCommand[]): SlideCommandResult {
  const source = normalizeSlideDeck(deck);
  const batch = Array.isArray(commands) ? list(commands, "操作", SLIDE_LIMITS.commands) : [commands];
  let result: Omit<SlideCommandResult, "changed"> = { deck: source, elementIds: [] };
  for (const command of batch) result = applyOne(result.deck, command);
  const changed = !sameSlideDeck(source, result.deck);
  return Object.freeze({ ...result, deck: changed ? result.deck : source, changed, elementIds: Object.freeze(result.elementIds) as string[] });
}
