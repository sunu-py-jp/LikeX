import type { SlideAnimationNode, SlideAnimationProperties, SlideAnimationStep, SlideAnimationTrigger, SlideElement } from "./types";
import { SLIDE_LIMITS } from "./limits";
import { boolean, choice, color, identifier, list, number, record, text } from "./validation";

export type SlideTween = Extract<SlideAnimationNode, { type: "tween" }>;
export type AnimationProperty = keyof SlideAnimationProperties;
export const ANIMATION_PROPERTIES: readonly AnimationProperty[] = ["x", "y", "width", "height", "rotation", "opacity", "fontSize", "strokeWidth", "fill", "stroke", "color", "textColor"];
const COMMON = ["x", "y", "width", "height", "rotation", "opacity"];
const NUMERIC_BOUNDS: Partial<Record<AnimationProperty, readonly [number, number]>> = {
  x: [-100_000, 100_000], y: [-100_000, 100_000], width: [Number.MIN_VALUE, 100_000], height: [Number.MIN_VALUE, 100_000],
  rotation: [-3_600_000, 3_600_000], opacity: [0, 1], fontSize: [1, 1000], strokeWidth: [0, 100],
};
export function clampAnimationNumber(key: AnimationProperty, value: number): number {
  const bounds = NUMERIC_BOUNDS[key]!;
  return Math.max(bounds[0], Math.min(bounds[1], value));
}
function properties(value: unknown, element: SlideElement): SlideAnimationProperties {
  const supported = [...COMMON, ...(element.type === "text" ? ["fontSize", "fill", "color"] : element.type === "shape" ? ["fontSize", "strokeWidth", "fill", "stroke", "textColor"] : [])];
  const raw = record(value, "アニメーションのプロパティ", supported);
  if (!Object.keys(raw).length) throw new Error("アニメーションのプロパティを1つ以上指定してください");
  const result: Record<string, number | string> = {};
  for (const key of ANIMATION_PROPERTIES) if (Object.hasOwn(raw, key)) {
    const bounds = NUMERIC_BOUNDS[key];
    result[key] = bounds ? number(raw[key], `アニメーションの${key}`, ...bounds) : color(raw[key], `アニメーションの${key}`);
  }
  return Object.freeze(result) as SlideAnimationProperties;
}
export function tweenProperties(tween: SlideTween): AnimationProperty[] {
  return ANIMATION_PROPERTIES.filter(key => Object.hasOwn(tween.to, key) || (tween.from !== undefined && Object.hasOwn(tween.from, key)));
}
export function animationNodeDuration(node: SlideAnimationNode): number {
  if (node.type === "tween") return (node.delayMs ?? 0) + node.durationMs * (node.repeat ?? 1) * (node.yoyo ? 2 : 1);
  const durations = node.children.map(animationNodeDuration);
  return node.type === "sequence" ? durations.reduce((total, duration) => total + duration, 0) : Math.max(...durations);
}
export type ScheduledTween = { tween: SlideTween; start: number; end: number };
export function scheduleAnimation(node: SlideAnimationNode, start = 0, result: ScheduledTween[] = []): ScheduledTween[] {
  if (node.type === "tween") result.push({ tween: node, start: start + (node.delayMs ?? 0), end: start + animationNodeDuration(node) });
  else for (const child of node.children) {
    scheduleAnimation(child, start, result);
    if (node.type === "sequence") start += animationNodeDuration(child);
  }
  return result;
}
function validateOverlaps(node: SlideAnimationNode): void {
  const writes = new Map<string, Map<AnimationProperty, ScheduledTween[]>>();
  for (const entry of scheduleAnimation(node)) {
    let target = writes.get(entry.tween.elementId);
    if (!target) writes.set(entry.tween.elementId, target = new Map());
    for (const key of tweenProperties(entry.tween)) {
      const intervals = target.get(key) ?? [];
      if (intervals.some(other => entry.start < other.end && other.start < entry.end))
        throw new Error(`並列アニメーションが同じ要素の${key}を同時に変更します`);
      intervals.push(entry);
      target.set(key, intervals);
    }
  }
}
export function normalizeSlideAnimations(value: unknown, elements: readonly SlideElement[]): SlideAnimationStep[] | undefined {
  if (value === undefined) return undefined;
  const source = list(value, "アニメーション", SLIDE_LIMITS.animationNodesPerSlide);
  if (!source.length) return undefined;
  const targets = new Map(elements.map(element => [element.id, element]));
  let count = 0, totalDuration = 0;
  const target = (value: unknown): SlideElement => {
    const element = targets.get(identifier(value));
    if (!element) throw new Error("アニメーションの対象要素が見つかりません");
    return element;
  };
  const normalizeNode = (value: unknown, depth: number): SlideAnimationNode => {
    if (++count > SLIDE_LIMITS.animationNodesPerSlide || depth > SLIDE_LIMITS.animationDepth)
      throw new Error("アニメーションのノード数または深さが上限を超えています");
    const raw = record(value, "アニメーションノード", ["type", "children", "elementId", "durationMs", "delayMs", "easing", "from", "to", "repeat", "yoyo"]);
    const type = choice(raw.type, ["sequence", "parallel", "tween"], "アニメーションノードの種類");
    if (type !== "tween") {
      record(raw, "アニメーショングループ", ["type", "children"]);
      const children = list(raw.children, "子アニメーション", SLIDE_LIMITS.animationNodesPerSlide, 1).map(child => normalizeNode(child, depth + 1));
      return Object.freeze({ type, children: Object.freeze(children) as SlideAnimationNode[] });
    }
    record(raw, "トゥイーン", ["type", "elementId", "durationMs", "delayMs", "easing", "from", "to", "repeat", "yoyo"]);
    const element = target(raw.elementId);
    const result: SlideTween = { type, elementId: element.id, durationMs: number(raw.durationMs, "アニメーション時間", 1, SLIDE_LIMITS.animationDurationMs),
      ...(raw.delayMs === undefined ? {} : { delayMs: number(raw.delayMs, "アニメーション遅延", 0, SLIDE_LIMITS.animationDurationMs) }),
      ...(raw.easing === undefined ? {} : { easing: choice(raw.easing, ["linear", "ease-in", "ease-out", "ease-in-out", "spring", "bounce"] as const, "イージング") }),
      ...(raw.from === undefined ? {} : { from: properties(raw.from, element) }), to: properties(raw.to, element),
      ...(raw.repeat === undefined ? {} : { repeat: number(raw.repeat, "繰り返し回数", 1, SLIDE_LIMITS.animationRepeat, true) }),
      ...(raw.yoyo === undefined ? {} : { yoyo: boolean(raw.yoyo, "往復") }) };
    return Object.freeze(result);
  };
  const ids = new Set<string>();
  const result = source.map(value => {
    const raw = record(value, "アニメーションステップ", ["id", "name", "trigger", "animation"]);
    const id = identifier(raw.id);
    if (ids.has(id)) throw new Error("アニメーションのIDが重複しています");
    ids.add(id);
    let trigger: SlideAnimationTrigger | undefined;
    if (raw.trigger !== undefined) {
      const spec = record(raw.trigger, "アニメーション開始条件", ["type", "delayMs", "elementId"]);
      const type = choice(spec.type, ["immediate", "after-delay", "click"], "アニメーション開始条件");
      record(spec, "アニメーション開始条件", type === "immediate" ? ["type"] : type === "after-delay" ? ["type", "delayMs"] : ["type", "elementId"]);
      trigger = type === "immediate" ? { type } : type === "after-delay" ? { type, delayMs: number(spec.delayMs, "開始遅延", 0, SLIDE_LIMITS.animationDurationMs) }
        : { type, ...(spec.elementId === undefined ? {} : { elementId: target(spec.elementId).id }) };
      Object.freeze(trigger);
    }
    const animation = normalizeNode(raw.animation, 1);
    validateOverlaps(animation);
    totalDuration += animationNodeDuration(animation) + (trigger?.type === "after-delay" ? trigger.delayMs : 0);
    if (totalDuration > SLIDE_LIMITS.animationDurationMs) throw new Error("スライドのアニメーション時間が上限を超えています");
    return Object.freeze({ id, ...(raw.name === undefined ? {} : { name: text(raw.name, "アニメーション名", 1000) }), ...(trigger ? { trigger } : {}), animation });
  });
  return Object.freeze(result) as SlideAnimationStep[];
}

/** Structural comparison is independent of property insertion order. */
export function sameAnimations(left: readonly SlideAnimationStep[] | undefined, right: readonly SlideAnimationStep[] | undefined): boolean {
  if (left === right) return true;
  return sameValue(left ?? [], right ?? []);
}
function sameValue(left: unknown, right: unknown): boolean {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  if (Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && sameValue(Reflect.get(left, key), Reflect.get(right, key)));
}
/** Retain matching tweens and prune empty containers, preserving the remaining order. */
export function filterAnimationNode(node: SlideAnimationNode, include: (elementId: string) => boolean, remap?: ReadonlyMap<string, string>, offset = 0): SlideAnimationNode | undefined {
  if (node.type === "tween") {
    if (!include(node.elementId)) return undefined;
    const shift = (values: SlideAnimationProperties): SlideAnimationProperties => ({ ...values,
      ...(values.x === undefined ? {} : { x: values.x + offset }), ...(values.y === undefined ? {} : { y: values.y + offset }) });
    return { ...node, elementId: remap?.get(node.elementId) ?? node.elementId,
      ...(offset === 0 ? {} : { ...(node.from ? { from: shift(node.from) } : {}), to: shift(node.to) }) };
  }
  const children = node.children.flatMap(child => {
    const kept = filterAnimationNode(child, include, remap, offset);
    return kept ? [kept] : [];
  });
  return children.length ? { type: node.type, children } : undefined;
}
export function animationTargetIds(step: SlideAnimationStep): Set<string> {
  const ids = new Set(scheduleAnimation(step.animation).map(({ tween }) => tween.elementId));
  if (step.trigger?.type === "click" && step.trigger.elementId) ids.add(step.trigger.elementId);
  return ids;
}
