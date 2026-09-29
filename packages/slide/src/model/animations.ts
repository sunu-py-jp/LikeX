import type { Slide, SlideAnimationActiveStep, SlideAnimationClick, SlideAnimationEvaluationOptions, SlideAnimationFrame, SlideAnimationStep, SlideAnimationWaitingStep, SlideElement } from "./types";
import { addAnimationTime, animationNodeDuration, clampAnimationNumber, scheduleAnimation, tweenProperties, type AnimationProperty, type ScheduledTween } from "./animation-validation";
import { normalizeSlide } from "./normalize";
import { isSlideLine, slideLineGeometry, transformSlideLine } from "./lines";
import { SLIDE_LIMITS } from "./limits";
import { identifier, list, number, record } from "./validation";

type Values = Record<string, number | string>;
type CompiledTween = ScheduledTween & { from: Values; to: Values; initialElement: SlideElement };
type CompiledStep = { definition: SlideAnimationStep; duration: number; initial: Slide; final: Slide; tweens: CompiledTween[] };
type CompiledTimeline = { timelineId?: string; initial: Slide; final: Slide; steps: CompiledStep[]; writes: ReadonlyMap<string, ReadonlySet<AnimationProperty>> };
type CompiledSlide = { initial: Slide; final: Slide; steps: CompiledStep[]; timelines: CompiledTimeline[] };
/** Internal shared plan for Office output; not part of the public model entry. */
export type SlideAnimationPlanTween = Readonly<CompiledTween>;
export type SlideAnimationPlanStep = Readonly<Omit<CompiledStep, "tweens">> & { readonly tweens: readonly SlideAnimationPlanTween[] };
export type SlideAnimationPlanTimeline = { readonly timelineId?: string; readonly initial: Slide; readonly final: Slide; readonly steps: readonly SlideAnimationPlanStep[] };
export function getSlideAnimationPlan(slide: Slide): { readonly initial: Slide; readonly final: Slide; readonly steps: readonly SlideAnimationPlanStep[]; readonly timelines: readonly SlideAnimationPlanTimeline[] } {
  return compile(slide);
}
const compiled = new WeakMap<Slide, CompiledSlide>();
function withoutAnimations(slide: Slide, elements = slide.elements): Slide {
  const resolvedElements = elements.map(element => {
    const previous = slide.elements.find(item => item.id === element.id);
    if (!previous || !isSlideLine(previous) || !previous.line || !["x", "y", "width", "height", "rotation"].some(key => Reflect.get(previous, key) !== Reflect.get(element, key))) return element;
    const line = transformSlideLine(previous, element);
    return { ...element, ...slideLineGeometry(line), line };
  });
  return normalizeSlide({ ...slide, animations: undefined, elements: resolvedElements });
}
function compile(slide: Slide): CompiledSlide {
  const source = normalizeSlide(slide);
  const cached = compiled.get(source);
  if (cached) return cached;
  const initial = source.animations ? withoutAnimations(source) : source;
  const definitions = new Map<string | undefined, SlideAnimationStep[]>();
  for (const step of source.animations ?? []) {
    const timeline = definitions.get(step.timelineId) ?? [];
    timeline.push(step);
    definitions.set(step.timelineId, timeline);
  }
  const timelines = [...definitions].map(([timelineId, steps]) => compileTimeline(initial, steps, timelineId));
  const byId = new Map(timelines.flatMap(timeline => timeline.steps.map(step => [step.definition.id, step] as const)));
  const steps = (source.animations ?? []).map(step => byId.get(step.id)!);
  const final = mergeTimelines(initial, timelines.map(timeline => ({ timeline, slide: timeline.final })));
  const result = Object.freeze({ initial, final, steps: Object.freeze(steps) as CompiledStep[], timelines: Object.freeze(timelines) as CompiledTimeline[] });
  compiled.set(source, result);
  return result;
}
function compileTimeline(initial: Slide, definitions: readonly SlideAnimationStep[], timelineId?: string): CompiledTimeline {
  let current = initial;
  // Keep unwrapped endpoints between steps: normalizing the presentation frame
  // must not turn a subsequent 360 -> 720 degree tween into a 0 -> 720 tween.
  const rotations = new Map(initial.elements.map(element => [element.id, element.rotation]));
  const steps: CompiledStep[] = [];
  const writes = new Map<string, Set<AnimationProperty>>();
  for (const definition of definitions) {
    const initialElements = new Map(current.elements.map(element => [element.id, element]));
    const elements = new Map(initialElements);
    const changed = new Set<string>();
    const tweens = scheduleAnimation(definition.animation).sort((a, b) => a.start - b.start).map(entry => {
      const id = entry.tween.elementId;
      const element = changed.has(id) ? elements.get(id)! : { ...elements.get(id)!, rotation: rotations.get(id)! };
      changed.add(id);
      elements.set(id, element);
      const from: Values = {}, to: Values = {};
      const properties = writes.get(id) ?? new Set<AnimationProperty>();
      writes.set(id, properties);
      // Validation excludes overlapping writes, so an earlier property's final value
      // is exactly its value when this tween begins, even inside nested groups.
      for (const key of tweenProperties(entry.tween)) {
        properties.add(key);
        from[key] = entry.tween.from?.[key] ?? Reflect.get(element, key) as number | string;
        to[key] = entry.tween.to[key] ?? from[key];
        Reflect.set(element, key, entry.tween.yoyo ? from[key] : to[key]);
      }
      return Object.freeze({ ...entry, from: Object.freeze(from), to: Object.freeze(to), initialElement: initialElements.get(id)! });
    });
    const final = withoutAnimations(current, [...elements.values()]);
    for (const id of changed) rotations.set(id, elements.get(id)!.rotation);
    steps.push(Object.freeze({ definition, duration: animationNodeDuration(definition.animation), initial: current, final, tweens: Object.freeze(tweens) as CompiledTween[] }));
    current = final;
  }
  return Object.freeze({ ...(timelineId === undefined ? {} : { timelineId }), initial, final: current,
    steps: Object.freeze(steps) as CompiledStep[], writes });
}
function mergeTimelines(initial: Slide, frames: readonly { timeline: CompiledTimeline; slide: Slide }[]): Slide {
  if (!frames.length) return initial;
  if (frames.length === 1) return frames[0].slide;
  const elements = new Map(initial.elements.map(element => [element.id, element]));
  for (const { timeline, slide } of frames) for (const element of slide.elements) {
    const properties = timeline.writes.get(element.id);
    if (!properties) continue;
    const merged = { ...elements.get(element.id)! };
    for (const key of properties) Reflect.set(merged, key, Reflect.get(element, key));
    elements.set(element.id, merged);
  }
  return withoutAnimations(initial, [...elements.values()]);
}
function ease(kind: CompiledTween["tween"]["easing"], fraction: number): number {
  if (fraction <= 0 || fraction >= 1) return fraction;
  if (kind === "ease-in") return fraction * fraction;
  if (kind === "ease-out") return 1 - (1 - fraction) ** 2;
  if (kind === "ease-in-out") return fraction < 0.5 ? 2 * fraction * fraction : 1 - (-2 * fraction + 2) ** 2 / 2;
  // Unit-mass underdamped spring: damping ratio 0.5, natural frequency 12 rad/s.
  if (kind === "spring") return 1 - Math.exp(-6 * fraction) * (Math.cos(6 * Math.sqrt(3) * fraction) + Math.sin(6 * Math.sqrt(3) * fraction) / Math.sqrt(3));
  if (kind === "bounce") {
    const n = 7.5625, d = 2.75;
    if (fraction < 1 / d) return n * fraction * fraction;
    if (fraction < 2 / d) return n * (fraction - 1.5 / d) ** 2 + 0.75;
    if (fraction < 2.5 / d) return n * (fraction - 2.25 / d) ** 2 + 0.9375;
    return n * (fraction - 2.625 / d) ** 2 + 0.984375;
  }
  return fraction;
}
function rgba(value: string): number[] {
  if (value === "transparent") return [0, 0, 0, 0];
  const hex = value.slice(1);
  return [0, 2, 4].map(index => parseInt(hex.slice(index, index + 2), 16)).concat(hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1);
}
function interpolateColor(from: string, to: string, fraction: number): string {
  if (fraction === 0) return from;
  if (fraction === 1) return to;
  const start = rgba(from), end = rgba(to), p = Math.max(0, Math.min(1, fraction));
  const alpha = start[3] + (end[3] - start[3]) * p;
  // Premultiplied alpha keeps transparent fades from introducing a black fringe.
  const bytes = [0, 1, 2].map(index => alpha === 0 ? 0 : (start[index] * start[3] * (1 - p) + end[index] * end[3] * p) / alpha);
  bytes.push(alpha * 255);
  return `#${bytes.map(value => Math.round(Math.max(0, Math.min(255, value))).toString(16).padStart(2, "0")).join("")}`;
}
function tweenFraction(entry: CompiledTween, elapsed: number): number {
  if (elapsed >= entry.end) return entry.tween.yoyo ? 0 : 1;
  const local = elapsed - entry.start, duration = entry.tween.durationMs;
  const cycle = duration * (entry.tween.yoyo ? 2 : 1);
  const within = local % cycle;
  const fraction = entry.tween.yoyo && within > duration ? 2 - within / duration : within / duration;
  return ease(entry.tween.easing, fraction);
}
/** Sample at a time relative to the containing step, retaining unwrapped rotations. */
export function sampleSlideAnimationTween(entry: SlideAnimationPlanTween, elapsed: number): Values {
  return sampleTweenValues(entry, tweenFraction(entry, elapsed));
}
/** Sample one outward pass, before repeat/auto-reverse timing is applied by an Office player. */
export function sampleSlideAnimationTweenProgress(entry: SlideAnimationPlanTween, progress: number): Values {
  return sampleTweenValues(entry, ease(entry.tween.easing, progress));
}
function sampleTweenValues(entry: SlideAnimationPlanTween, fraction: number): Values {
  const values: Values = {};
  for (const key of Object.keys(entry.from) as AnimationProperty[]) {
    const from = entry.from[key], to = entry.to[key];
    values[key] = typeof from === "number" && typeof to === "number" ? clampAnimationNumber(key, from + (to - from) * fraction)
      : interpolateColor(from as string, to as string, fraction);
  }
  return values;
}
/** Shared raw-value sampling for coupled Office properties, such as center = x + width / 2. */
export function sampleSlideAnimationElement(step: SlideAnimationPlanStep, elementId: string, elapsed: number): SlideElement {
  const element = { ...step.initial.elements.find(element => element.id === elementId)! };
  for (const entry of step.tweens) {
    if (entry.start > elapsed) break;
    if (entry.tween.elementId === elementId) Object.assign(element, sampleSlideAnimationTween(entry, elapsed));
  }
  return element;
}
function renderStep(step: CompiledStep, elapsed: number): Slide {
  if (elapsed >= step.duration) return step.final;
  const elements = new Map<string, SlideElement>();
  for (const entry of step.tweens) {
    if (elapsed < entry.start) break;
    const element = elements.get(entry.tween.elementId) ?? { ...entry.initialElement };
    Object.assign(element, sampleSlideAnimationTween(entry, elapsed));
    elements.set(element.id, element);
  }
  if (!elements.size) return step.initial;
  return withoutAnimations(step.initial, step.initial.elements.map(element => elements.get(element.id) ?? element));
}
/** Complete every step, ignoring trigger waits; the returned immutable slide has no animation definitions. */
export function resolveSlideAnimations(slide: Slide): Slide {
  return compile(slide).final;
}
/** Evaluate independent page-relative timelines without modifying the slide or caller's click list. */
export function evaluateSlideAnimations(slide: Slide, options: SlideAnimationEvaluationOptions): SlideAnimationFrame {
  const raw = record(options, "アニメーション評価", ["elapsedMs", "clicks"]);
  const elapsed = number(raw.elapsedMs, "経過時間", 0, Infinity);
  let previous = -1;
  const clicks: SlideAnimationClick[] = raw.clicks === undefined ? [] : list(raw.clicks, "アニメーションクリック", SLIDE_LIMITS.animationClicks).map(value => {
    const click = record(value, "アニメーションクリック", ["elapsedMs", "elementId"]);
    const elapsedMs = number(click.elapsedMs, "クリック時刻", 0, Infinity);
    if (elapsedMs < previous) throw new Error("クリックは時刻順に指定してください");
    previous = elapsedMs;
    return { elapsedMs, ...(click.elementId === undefined ? {} : { elementId: identifier(click.elementId) }) };
  });
  const plan = compile(slide);
  const frames = plan.timelines.map(timeline => ({ timeline, frame: evaluateTimeline(timeline, elapsed, clicks) }));
  if (frames.length === 1 && frames[0].timeline.timelineId === undefined) return frames[0].frame;
  if (!frames.length) return Object.freeze({ slide: plan.final, finished: true, waitingForClick: false });
  const waitingSteps: SlideAnimationWaitingStep[] = [], activeSteps: SlideAnimationActiveStep[] = [];
  for (const { timeline, frame } of frames) {
    if (frame.finished) continue;
    const step = { stepId: frame.stepId!, ...(timeline.timelineId === undefined ? {} : { timelineId: timeline.timelineId }) };
    if (frame.waitingForClick) waitingSteps.push(Object.freeze({ ...step, ...(frame.waitingTargetId === undefined ? {} : { waitingTargetId: frame.waitingTargetId }) }));
    else activeSteps.push(Object.freeze({ ...step, stepStartMs: frame.stepStartMs!, stepEndMs: frame.stepEndMs! }));
  }
  const order = new Map(plan.steps.map((step, index) => [step.definition.id, index]));
  waitingSteps.sort((a, b) => order.get(a.stepId)! - order.get(b.stepId)!);
  activeSteps.sort((a, b) => order.get(a.stepId)! - order.get(b.stepId)!);
  const primary = waitingSteps[0] ?? activeSteps[0];
  return Object.freeze({ slide: mergeTimelines(plan.initial, frames.map(({ timeline, frame }) => ({ timeline, slide: frame.slide }))),
    finished: !primary, waitingForClick: waitingSteps.length > 0,
    ...(primary ? { stepId: primary.stepId } : {}),
    ...(waitingSteps.length ? (waitingSteps[0].waitingTargetId === undefined ? {} : { waitingTargetId: waitingSteps[0].waitingTargetId })
      : activeSteps.length ? { stepStartMs: activeSteps[0].stepStartMs, stepEndMs: activeSteps[0].stepEndMs } : {}),
    waitingSteps: Object.freeze(waitingSteps), activeSteps: Object.freeze(activeSteps) });
}
function evaluateTimeline(plan: CompiledTimeline, elapsed: number, clicks: readonly SlideAnimationClick[]): SlideAnimationFrame {
  let end = 0, clickIndex = 0;
  for (const step of plan.steps) {
    const trigger = step.definition.trigger;
    let start = end;
    if (trigger?.type === "after-delay") start = addAnimationTime(start, trigger.delayMs);
    if (trigger?.type === "click") {
      let matched: SlideAnimationClick | undefined;
      while (clickIndex < clicks.length) {
        const click = clicks[clickIndex];
        if (click.elapsedMs > elapsed) break;
        clickIndex++;
        if (click.elapsedMs >= end && (trigger.elementId === undefined || trigger.elementId === click.elementId)) { matched = click; break; }
      }
      if (!matched) return Object.freeze({ slide: step.initial, finished: false, waitingForClick: true, stepId: step.definition.id,
        ...(trigger.elementId === undefined ? {} : { waitingTargetId: trigger.elementId }) });
      start = matched.elapsedMs;
    }
    end = addAnimationTime(start, step.duration);
    if (elapsed < end) return Object.freeze({ slide: elapsed < start ? step.initial : renderStep(step, elapsed - start), finished: false,
      waitingForClick: false, stepId: step.definition.id, stepStartMs: start, stepEndMs: end });
  }
  return Object.freeze({ slide: plan.final, finished: true, waitingForClick: false });
}
