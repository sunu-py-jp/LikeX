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
/** Reject arithmetic overflow and positive intervals that cannot advance the clock. */
export function addAnimationTime(left: number, right: number): number {
  const result = left + right;
  if (!Number.isFinite(result) || left < 0 || right < 0 || right > 0 && result <= left || left > 0 && result <= right)
    throw new Error("アニメーションの時間差を有限の数値で表現できません");
  return result;
}
function nodeDurations(root: SlideAnimationNode): Map<SlideAnimationNode, number> {
  const durations = new Map<SlideAnimationNode, number>(), ancestors = new Set<SlideAnimationNode>();
  const stack = [{ node: root, index: 0, duration: 0, entered: false }];
  while (stack.length) {
    const frame = stack[stack.length - 1], node = frame.node;
    if (!frame.entered) {
      if (ancestors.has(node)) throw new Error("アニメーションに循環参照は指定できません");
      if (durations.has(node)) { stack.pop(); continue; }
      frame.entered = true;
      if (node.type === "tween") {
        const duration = number(node.durationMs, "アニメーション時間", Number.MIN_VALUE, Infinity);
        const repeat = number(node.repeat ?? 1, "繰り返し回数", 1, Infinity, true);
        const span = duration * repeat * (node.yoyo ? 2 : 1);
        durations.set(node, addAnimationTime(number(node.delayMs ?? 0, "アニメーション遅延", 0, Infinity), span));
        stack.pop(); continue;
      }
      ancestors.add(node);
    }
    if (node.type === "tween") continue;
    if (frame.index < node.children.length) {
      const child = node.children[frame.index];
      if (!durations.has(child)) { stack.push({ node: child, index: 0, duration: 0, entered: false }); continue; }
      const duration = durations.get(child)!;
      frame.duration = node.type === "sequence" ? addAnimationTime(frame.duration, duration) : Math.max(frame.duration, duration);
      frame.index++;
    } else {
      durations.set(node, frame.duration); ancestors.delete(node); stack.pop();
    }
  }
  return durations;
}
export function animationNodeDuration(node: SlideAnimationNode): number {
  return nodeDurations(node).get(node)!;
}
export type ScheduledTween = { tween: SlideTween; start: number; end: number };
export function scheduleAnimation(node: SlideAnimationNode, start = 0, result: ScheduledTween[] = []): ScheduledTween[] {
  const durations = nodeDurations(node), stack = [{ node, start, index: 0 }];
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.node.type === "tween") {
      result.push({ tween: frame.node, start: addAnimationTime(frame.start, frame.node.delayMs ?? 0), end: addAnimationTime(frame.start, durations.get(frame.node)!) });
      stack.pop();
    } else if (frame.index < frame.node.children.length) {
      const child = frame.node.children[frame.index++], offset = frame.start;
      if (frame.node.type === "sequence") frame.start = addAnimationTime(frame.start, durations.get(child)!);
      stack.push({ node: child, start: offset, index: 0 });
    } else stack.pop();
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
      intervals.push(entry);
      target.set(key, intervals);
    }
  }
  for (const target of writes.values()) for (const [key, intervals] of target) {
    intervals.sort((left, right) => left.start - right.start);
    for (let index = 1; index < intervals.length; index++) if (intervals[index].start < intervals[index - 1].end)
      throw new Error(`並列アニメーションが同じ要素の${key}を同時に変更します`);
  }
}
export function normalizeSlideAnimations(value: unknown, elements: readonly SlideElement[]): SlideAnimationStep[] | undefined {
  if (value === undefined) return undefined;
  const source = list(value, "アニメーション", SLIDE_LIMITS.animationNodesPerSlide);
  if (!source.length) return undefined;
  const targets = new Map(elements.map(element => [element.id, element]));
  const timelineDurations = new Map<string | undefined, number>();
  const target = (value: unknown): SlideElement => {
    const element = targets.get(identifier(value));
    if (!element) throw new Error("アニメーションの対象要素が見つかりません");
    return element;
  };
  const normalizeTween = (raw: Record<string, unknown>): SlideTween => {
    record(raw, "トゥイーン", ["type", "elementId", "durationMs", "delayMs", "easing", "from", "to", "repeat", "yoyo"]);
    const element = target(raw.elementId);
    return Object.freeze({ type: "tween", elementId: element.id, durationMs: number(raw.durationMs, "アニメーション時間", Number.MIN_VALUE, Infinity),
      ...(raw.delayMs === undefined ? {} : { delayMs: number(raw.delayMs, "アニメーション遅延", 0, Infinity) }),
      ...(raw.easing === undefined ? {} : { easing: choice(raw.easing, ["linear", "ease-in", "ease-out", "ease-in-out", "spring", "bounce"] as const, "イージング") }),
      ...(raw.from === undefined ? {} : { from: properties(raw.from, element) }), to: properties(raw.to, element),
      ...(raw.repeat === undefined ? {} : { repeat: number(raw.repeat, "繰り返し回数", 1, Infinity, true) }),
      ...(raw.yoyo === undefined ? {} : { yoyo: boolean(raw.yoyo, "往復") }) });
  };
  const normalizeNode = (value: unknown): SlideAnimationNode => {
    type Work = { kind: "enter"; value: unknown; result: SlideAnimationNode[] }
      | { kind: "exit"; source: object; type: "sequence" | "parallel"; children: SlideAnimationNode[]; result: SlideAnimationNode[] };
    const result: SlideAnimationNode[] = [], stack: Work[] = [{ kind: "enter", value, result }], ancestors = new WeakSet<object>();
    while (stack.length) {
      const work = stack.pop()!;
      if (work.kind === "exit") {
        ancestors.delete(work.source);
        work.result.push(Object.freeze({ type: work.type, children: Object.freeze(work.children) as SlideAnimationNode[] }));
        continue;
      }
      const raw = record(work.value, "アニメーションノード", ["type", "children", "elementId", "durationMs", "delayMs", "easing", "from", "to", "repeat", "yoyo"]);
      if (ancestors.has(raw)) throw new Error("アニメーションに循環参照は指定できません");
      const type = choice(raw.type, ["sequence", "parallel", "tween"], "アニメーションノードの種類");
      if (type !== "tween") {
        record(raw, "アニメーショングループ", ["type", "children"]);
        const children = list(raw.children, "子アニメーション", Infinity, 1), normalized: SlideAnimationNode[] = [];
        ancestors.add(raw);
        stack.push({ kind: "exit", source: raw, type, children: normalized, result: work.result });
        for (let index = children.length - 1; index >= 0; index--) stack.push({ kind: "enter", value: children[index], result: normalized });
      } else work.result.push(normalizeTween(raw));
    }
    return result[0];
  };
  const ids = new Set<string>();
  const timelineWrites = new Map<string, Map<AnimationProperty, string | undefined>>();
  const result = source.map(value => {
    const raw = record(value, "アニメーションステップ", ["id", "name", "timelineId", "trigger", "animation"]);
    const id = identifier(raw.id);
    const timelineId = raw.timelineId === undefined ? undefined : identifier(raw.timelineId);
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
    const animation = normalizeNode(raw.animation);
    validateOverlaps(animation);
    // Independent click histories make cross-timeline ordering unknowable. Disjoint
    // properties may run together, but no timeline may overwrite another's property.
    for (const { tween } of scheduleAnimation(animation)) {
      let writes = timelineWrites.get(tween.elementId);
      if (!writes) timelineWrites.set(tween.elementId, writes = new Map());
      for (const key of tweenProperties(tween)) {
        if (writes.has(key) && writes.get(key) !== timelineId) throw new Error(`独立タイムラインが同じ要素の${key}を変更します`);
        writes.set(key, timelineId);
      }
    }
    const duration = addAnimationTime(animationNodeDuration(animation), trigger?.type === "after-delay" ? trigger.delayMs : 0);
    timelineDurations.set(timelineId, addAnimationTime(timelineDurations.get(timelineId) ?? 0, duration));
    return Object.freeze({ id, ...(raw.name === undefined ? {} : { name: text(raw.name, "アニメーション名", 1000) }),
      ...(timelineId === undefined ? {} : { timelineId }), ...(trigger ? { trigger } : {}), animation });
  });
  return Object.freeze(result) as SlideAnimationStep[];
}

/** Structural comparison is independent of property insertion order. */
export function sameAnimations(left: readonly SlideAnimationStep[] | undefined, right: readonly SlideAnimationStep[] | undefined): boolean {
  if (left === right) return true;
  return sameValue(left ?? [], right ?? []);
}
function sameValue(left: unknown, right: unknown): boolean {
  const work: [unknown, unknown][] = [[left, right]];
  while (work.length) {
    const [a, b] = work.pop()!;
    if (a === b) continue;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    if (Array.isArray(a)) {
      if (!Array.isArray(b) || a.length !== b.length) return false;
      for (let index = 0; index < a.length; index++) work.push([a[index], b[index]]);
    } else {
      if (Array.isArray(b)) return false;
      const keys = Object.keys(a);
      if (keys.length !== Object.keys(b).length) return false;
      for (const key of keys) {
        if (!Object.hasOwn(b, key)) return false;
        work.push([Reflect.get(a, key), Reflect.get(b, key)]);
      }
    }
  }
  return true;
}
/** Retain matching tweens and prune empty containers, preserving the remaining order. */
export function filterAnimationNode(node: SlideAnimationNode, include: (elementId: string) => boolean, remap?: ReadonlyMap<string, string>, offset = 0): SlideAnimationNode | undefined {
  type Work = { node: SlideAnimationNode; result: SlideAnimationNode[]; children?: SlideAnimationNode[] };
  const result: SlideAnimationNode[] = [], work: Work[] = [{ node, result }];
  const shift = (values: SlideAnimationProperties): SlideAnimationProperties => ({ ...values,
    ...(values.x === undefined ? {} : { x: values.x + offset }), ...(values.y === undefined ? {} : { y: values.y + offset }) });
  while (work.length) {
    const frame = work.pop()!, node = frame.node;
    if (node.type === "tween") {
      if (include(node.elementId)) frame.result.push({ ...node, elementId: remap?.get(node.elementId) ?? node.elementId,
        ...(offset === 0 ? {} : { ...(node.from ? { from: shift(node.from) } : {}), to: shift(node.to) }) });
    } else if (frame.children) {
      if (frame.children.length) frame.result.push({ type: node.type, children: frame.children });
    } else {
      const children: SlideAnimationNode[] = [];
      work.push({ ...frame, children });
      for (let index = node.children.length - 1; index >= 0; index--) work.push({ node: node.children[index], result: children });
    }
  }
  return result[0];
}
export function animationTargetIds(step: SlideAnimationStep): Set<string> {
  const ids = new Set(scheduleAnimation(step.animation).map(({ tween }) => tween.elementId));
  if (step.trigger?.type === "click" && step.trigger.elementId) ids.add(step.trigger.elementId);
  return ids;
}
