import type { Slide, SlideAnimationClick, SlideAnimationEvaluationOptions, SlideAnimationFrame, SlideAnimationStep, SlideElement } from "./types";
import { animationNodeDuration, clampAnimationNumber, scheduleAnimation, tweenProperties, type AnimationProperty, type ScheduledTween } from "./animation-validation";
import { normalizeSlide } from "./normalize";
import { SLIDE_LIMITS } from "./limits";
import { identifier, list, number, record } from "./validation";

type Values = Record<string, number | string>;
type CompiledTween = ScheduledTween & { from: Values; to: Values; initialElement: SlideElement };
type CompiledStep = { definition: SlideAnimationStep; duration: number; initial: Slide; final: Slide; tweens: CompiledTween[] };
type CompiledSlide = { initial: Slide; final: Slide; steps: CompiledStep[] };
const compiled = new WeakMap<Slide, CompiledSlide>();
function withoutAnimations(slide: Slide, elements = slide.elements): Slide {
  return normalizeSlide({ ...slide, animations: undefined, elements });
}
function compile(slide: Slide): CompiledSlide {
  const source = normalizeSlide(slide);
  const cached = compiled.get(source);
  if (cached) return cached;
  const initial = source.animations ? withoutAnimations(source) : source;
  let current = initial;
  // Keep unwrapped endpoints between steps: normalizing the presentation frame
  // must not turn a subsequent 360 -> 720 degree tween into a 0 -> 720 tween.
  const rotations = new Map(initial.elements.map(element => [element.id, element.rotation]));
  const steps: CompiledStep[] = [];
  for (const definition of source.animations ?? []) {
    const initialElements = new Map(current.elements.map(element => [element.id, element]));
    const elements = new Map(initialElements);
    const changed = new Set<string>();
    const tweens = scheduleAnimation(definition.animation).sort((a, b) => a.start - b.start).map(entry => {
      const id = entry.tween.elementId;
      const element = changed.has(id) ? elements.get(id)! : { ...elements.get(id)!, rotation: rotations.get(id)! };
      changed.add(id);
      elements.set(id, element);
      const from: Values = {}, to: Values = {};
      // Validation excludes overlapping writes, so an earlier property's final value
      // is exactly its value when this tween begins, even inside nested groups.
      for (const key of tweenProperties(entry.tween)) {
        from[key] = entry.tween.from?.[key] ?? Reflect.get(element, key) as number | string;
        to[key] = entry.tween.to[key] ?? from[key];
        Reflect.set(element, key, entry.tween.yoyo ? from[key] : to[key]);
      }
      return { ...entry, from, to, initialElement: initialElements.get(id)! };
    });
    const final = withoutAnimations(current, [...elements.values()]);
    for (const id of changed) rotations.set(id, elements.get(id)!.rotation);
    steps.push({ definition, duration: animationNodeDuration(definition.animation), initial: current, final, tweens });
    current = final;
  }
  const result = { initial, final: current, steps };
  compiled.set(source, result);
  return result;
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
function renderStep(step: CompiledStep, elapsed: number): Slide {
  if (elapsed >= step.duration) return step.final;
  const elements = new Map<string, SlideElement>();
  for (const entry of step.tweens) {
    if (elapsed < entry.start) break;
    const element = elements.get(entry.tween.elementId) ?? { ...entry.initialElement };
    const fraction = tweenFraction(entry, elapsed);
    for (const key of Object.keys(entry.from) as AnimationProperty[]) {
      const from = entry.from[key], to = entry.to[key];
      const value = typeof from === "number" && typeof to === "number" ? clampAnimationNumber(key, from + (to - from) * fraction)
        : interpolateColor(from as string, to as string, fraction);
      Reflect.set(element, key, value);
    }
    elements.set(element.id, element);
  }
  if (!elements.size) return step.initial;
  return withoutAnimations(step.initial, step.initial.elements.map(element => elements.get(element.id) ?? element));
}
/** Complete every step, ignoring trigger waits; the returned immutable slide has no animation definitions. */
export function resolveSlideAnimations(slide: Slide): Slide {
  return compile(slide).final;
}
/** Evaluate one page-relative timeline without modifying the slide or consuming the caller's click list. */
export function evaluateSlideAnimations(slide: Slide, options: SlideAnimationEvaluationOptions): SlideAnimationFrame {
  const raw = record(options, "アニメーション評価", ["elapsedMs", "clicks"]);
  const elapsed = number(raw.elapsedMs, "経過時間", 0, Number.MAX_SAFE_INTEGER);
  let previous = -1;
  const clicks: SlideAnimationClick[] = raw.clicks === undefined ? [] : list(raw.clicks, "アニメーションクリック", SLIDE_LIMITS.animationClicks).map(value => {
    const click = record(value, "アニメーションクリック", ["elapsedMs", "elementId"]);
    const elapsedMs = number(click.elapsedMs, "クリック時刻", 0, Number.MAX_SAFE_INTEGER);
    if (elapsedMs < previous) throw new Error("クリックは時刻順に指定してください");
    previous = elapsedMs;
    return { elapsedMs, ...(click.elementId === undefined ? {} : { elementId: identifier(click.elementId) }) };
  });
  const plan = compile(slide);
  let end = 0, clickIndex = 0;
  for (const step of plan.steps) {
    const trigger = step.definition.trigger;
    let start = end;
    if (trigger?.type === "after-delay") start += trigger.delayMs;
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
    end = start + step.duration;
    if (elapsed < end) return Object.freeze({ slide: elapsed < start ? step.initial : renderStep(step, elapsed - start), finished: false,
      waitingForClick: false, stepId: step.definition.id, stepStartMs: start, stepEndMs: end });
  }
  return Object.freeze({ slide: plan.final, finished: true, waitingForClick: false });
}
