import type { Slide, SlideElement } from "../model/types";
import { sampleSlideAnimationElement, type SlideAnimationPlanStep } from "../model/animations";
import { SLIDE_LIMITS } from "../model/limits";
import { slideElementTextLength } from "../model/text-length";
import type { SlidePptxDiagnosticDetails } from "../office/types";
import type { OfficeTaskCheckpoint } from "../office/cooperative-task";

type Warning = (message: string, details?: SlidePptxDiagnosticDetails) => void;
export type AnimationSnapshot = { id: string; shapeId: number; element: SlideElement };
export type SnapshotSwitch = { time: number; previous: string; current: string };
export type PptxAnimationSnapshots = {
  shapes: ReadonlyMap<string, readonly AnimationSnapshot[]>;
  properties: ReadonlyMap<string, ReadonlySet<string>>;
  switches: ReadonlyMap<string, readonly SnapshotSwitch[]>;
};
const COLOR_KEYS = ["fill", "stroke", "color", "textColor"];
const SNAPSHOT_SAMPLES = 32;
const has = (entry: SlideAnimationPlanStep["tweens"][number], key: string): boolean => Object.hasOwn(entry.from, key);
const alpha = (value: unknown): boolean => value === "transparent" || typeof value === "string" && value.length === 9;

/** Native static shapes plus visibility are used instead of runtime properties
 * such as stroke.weight, whose XML validity does not establish playback support.
 * Only styles are sampled: native geometry/opacity channels target every alias.
 */
export async function createPptxAnimationSnapshots(slide: Slide, steps: readonly SlideAnimationPlanStep[], ids: ReadonlyMap<string, number>, warn: Warning, textBudget: number, checkpoint: OfficeTaskCheckpoint): Promise<PptxAnimationSnapshots> {
  const properties = new Map<string, Set<string>>();
  for (const step of steps) for (const entry of step.tweens) {
    await checkpoint();
    const keys = ["fontSize", "strokeWidth"].filter(key => has(entry, key));
    keys.push(...COLOR_KEYS.filter(key => has(entry, key) && (alpha(entry.from[key]) || alpha(entry.to[key]))));
    if (!keys.length) continue;
    const current = properties.get(entry.tween.elementId) ?? new Set<string>();
    for (const key of keys) current.add(key);
    properties.set(entry.tween.elementId, current);
  }
  // Sampling opacity together with other styles in the same lane avoids a
  // Cartesian expansion of per-frame opacity sets across every shape alias.
  // An independent opacity lane still uses native opacity on all aliases.
  for (const [elementId, keys] of properties) {
    await checkpoint();
    const styleLanes = new Set(steps.filter(step => step.tweens.some(entry => entry.tween.elementId === elementId && [...keys].some(key => has(entry, key))))
      .map(step => step.definition.timelineId));
    const opacitySteps = steps.filter(step => step.tweens.some(entry => entry.tween.elementId === elementId && has(entry, "opacity")));
    if (styleLanes.size === 1 && opacitySteps.length && opacitySteps.every(step => styleLanes.has(step.definition.timelineId))) keys.add("opacity");
  }
  const conflicts = new Set<string>();
  for (const [elementId, keys] of properties) {
    await checkpoint();
    const lanes = new Set(steps.filter(step => step.tweens.some(entry => entry.tween.elementId === elementId && [...keys].some(key => has(entry, key))))
      .map(step => step.definition.timelineId));
    if (lanes.size > 1) conflicts.add(elementId);
    for (const step of steps) for (const entry of step.tweens) if (entry.tween.elementId === elementId) for (const property of keys) if (has(entry, property)) {
      const details = { elementId, elementName: entry.initialElement.name, animationId: step.definition.id, timelineId: step.definition.timelineId, property };
      if (conflicts.has(elementId)) warn("同じ図形の複数タイムラインで文字サイズ・線幅・アルファ付き色を同時に変更する組み合わせは近似できないため、対象プロパティは元の値を保持しました。", { ...details, code: "animation-conflict", action: "omission" });
      else {
        const label = property === "fontSize" ? "文字サイズ" : property === "strokeWidth" ? "線幅" : property === "opacity" ? "透明度" : "アルファ値を含む色";
        warn(`${label}のアニメーションは編集可能な図形の段階的な切り替えに近似しました。PPTXの編集画面と再読み込みでは複数の図形になります。`, { ...details, code: "animation-approximated", action: "approximation" });
      }
    }
  }
  if (!properties.size || conflicts.size === properties.size) return { shapes: new Map(), properties, switches: new Map() };
  const originals = new Map(slide.elements.map(element => [element.id, element]));
  const budget = SLIDE_LIMITS.elementsPerSlide - slide.elements.length;
  const failBudget = (): never => {
    warn("PPTXの追加図形を含む要素数または文字数が資料全体の上限を超えています。", { code: "animation-limit", action: "omission" });
    throw new Error("PowerPointの追加図形を含む要素数または文字数が資料全体の上限を超えています");
  };
  const shapes = new Map<string, AnimationSnapshot[]>(), switches = new Map<string, SnapshotSwitch[]>();
  const current = new Map<string, string>(), cache = new Map<string, Map<string, string>>();
  let nextId = 2, count = 0, textLength = 0;
  for (const id of ids.values()) nextId = Math.max(nextId, id + 1);
  const snapshot = (elementId: string, sampled: SlideElement): string => {
    const source = originals.get(elementId)!, keys = [...properties.get(elementId)!].sort();
    const values = keys.map(key => {
      const value = Reflect.get(sampled, key) as string | number;
      return typeof value === "number" ? Number(value.toFixed(6)) : value;
    });
    let states = cache.get(elementId);
    if (!states) {
      states = new Map([[JSON.stringify(keys.map(key => Reflect.get(source, key))), elementId]]);
      cache.set(elementId, states);
    }
    const signature = JSON.stringify(values), existing = states.get(signature);
    if (existing) return existing;
    if (++count > budget) return failBudget();
    textLength += slideElementTextLength(source);
    if (textLength > textBudget) return failBudget();
    const shapeId = nextId++;
    let id = `pptx-snapshot-${shapeId}`;
    while (originals.has(id)) id = `_${id}`;
    const element = { ...source, ...Object.fromEntries(keys.map((key, index) => [key, values[index]])), id } as SlideElement;
    const variants = shapes.get(elementId) ?? [];
    variants.push({ id, shapeId, element }); shapes.set(elementId, variants); states.set(signature, id);
    return id;
  };
  for (const step of steps) {
    const events: SnapshotSwitch[] = [];
    for (const [elementId, keys] of properties) {
      await checkpoint();
      if (conflicts.has(elementId)) continue;
      const entries = step.tweens.filter(entry => entry.tween.elementId === elementId && [...keys].some(key => has(entry, key)));
      if (!entries.length) continue;
      const points = new Map<number, number>();
      for (const entry of entries) {
        const passes = (entry.tween.repeat ?? 1) * (entry.tween.yoyo ? 2 : 1), duration = entry.tween.durationMs;
        points.set(entry.start, entry.start);
        for (let pass = 0; pass < passes; pass++) {
          await checkpoint();
          const start = entry.start + pass * duration, end = start + duration;
          for (let index = 0; index < SNAPSHOT_SAMPLES; index++) {
            const time = Math.round(start + duration * index / SNAPSHOT_SAMPLES);
            points.set(time, time);
          }
          // Repeated non-reversing tweens jump to their source at each boundary.
          // Keep the preceding endpoint so the reset never erases a pass.
          if (!entry.tween.yoyo && pass < passes - 1 && duration > 1) points.set(end - 1, end - 0.000001);
          points.set(Math.min(end, step.duration - 1), end);
        }
      }
      for (const [time, sampleTime] of [...points].sort(([a], [b]) => a - b)) {
        await checkpoint();
        const target = snapshot(elementId, sampleSlideAnimationElement(step, elementId, sampleTime));
        const previous = current.get(elementId) ?? elementId;
        if (previous === target) continue;
        events.push({ time, previous, current: target }); current.set(elementId, target);
      }
    }
    if (events.length) switches.set(step.definition.id, events.sort((a, b) => a.time - b.time));
  }
  return { shapes, properties, switches };
}
