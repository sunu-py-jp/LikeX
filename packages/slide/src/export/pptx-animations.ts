import type { Slide, SlideAnimationNode, SlideElement } from "../model/types";
import { getSlideAnimationPlan, sampleSlideAnimationElement, sampleSlideAnimationTweenProgress, type SlideAnimationPlanStep, type SlideAnimationPlanTween } from "../model/animations";
import { xml } from "./pptx-xml";
import { createPptxAnimationSnapshots, type AnimationSnapshot } from "./pptx-animation-snapshots";
import type { SlidePptxDiagnosticDetails } from "../office/types";
import type { OfficeTaskCheckpoint } from "../office/cooperative-task";
import { OFFICE_PACKAGE_LIMITS } from "../ooxml";

// PresentationML timing: https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-animation
// PowerPoint's five-level timing-tree restriction: MS-OI29500 19.5.87 (tnLst).
const CURVE_SAMPLES = 32;
// ST_TLTime and ST_TLTimeNodeID use XML Schema unsignedInt. This is a
// PresentationML type boundary, not an application animation-count budget.
// https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/64f8422b-a72a-43ce-b44b-4b437c8fe2a5
const pptxTime = (value: number, label: string): string => {
  if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) throw new Error(`PowerPointの${label}を標準XMLの符号なし32ビット整数で表せません`);
  return String(value);
};
type Warning = (message: string, details?: SlidePptxDiagnosticDetails) => void;
type Axis = "x" | "y";
type Channel = { name: string; value: (element: SlideElement) => number };
const has = (entry: SlideAnimationPlanTween, key: string): boolean => Object.hasOwn(entry.from, key);
const numeric = (value: number): string => Number(value.toFixed(9)).toString();
const delay = (value: number): string => `<p:stCondLst><p:cond delay="${pptxTime(value, "開始遅延")}"/></p:stCondLst>`;
const easing = (entry: SlideAnimationPlanTween): string => entry.tween.easing === "ease-in" ? ' accel="100000"'
  : entry.tween.easing === "ease-out" ? ' decel="100000"' : entry.tween.easing === "ease-in-out" ? ' accel="50000" decel="50000"' : "";
const curved = (entry: SlideAnimationPlanTween): boolean => entry.tween.easing === "spring" || entry.tween.easing === "bounce";
async function integerTiming(slide: Slide, warn: Warning, checkpoint: OfficeTaskCheckpoint): Promise<Slide> {
  const time = (value: number, minimum = 0): number => {
    const result = Math.max(minimum, Math.round(value));
    if (result !== value) warn("PowerPointの時間単位に合わせてアニメーションの小数ミリ秒を整数に丸めました。", { code: "animation-approximated", action: "adjustment", property: "durationMs" });
    pptxTime(result, "時間");
    return result;
  };
  const animations = [];
  for (const step of slide.animations ?? []) {
    const pending: { node: SlideAnimationNode; visited: boolean }[] = [{ node: step.animation, visited: false }];
    const converted = new Map<SlideAnimationNode, SlideAnimationNode>();
    while (pending.length) {
      await checkpoint();
      const { node, visited } = pending.pop()!;
      if (node.type === "tween") {
        pptxTime((node.repeat ?? 1) * 1000, "繰り返し回数");
        converted.set(node, { ...node, durationMs: time(node.durationMs, 1), ...(node.delayMs === undefined ? {} : { delayMs: time(node.delayMs) }) });
      } else if (visited) converted.set(node, { ...node, children: node.children.map(child => converted.get(child)!) });
      else {
        pending.push({ node, visited: true });
        for (let index = node.children.length - 1; index >= 0; index--) pending.push({ node: node.children[index], visited: false });
      }
    }
    animations.push({ ...step, animation: converted.get(step.animation)!,
      ...(step.trigger?.type === "after-delay" ? { trigger: { type: "after-delay" as const, delayMs: time(step.trigger.delayMs) } } : {}) });
  }
  return { ...slide, animations };
}

/** Writes standard timing; initial shape IDs are the same cNvPr IDs as the slide tree. */
export async function exportPptxAnimations(slide: Slide, width: number, height: number, sourceIds: ReadonlyMap<string, number>, warn: Warning, snapshotTextBudget: number, checkpoint: OfficeTaskCheckpoint): Promise<{ timing: string; opacityTargets: ReadonlySet<string>; snapshots: ReadonlyMap<string, readonly AnimationSnapshot[]> }> {
  if (!slide.animations?.length) return { timing: "", opacityTargets: new Set(), snapshots: new Map() };
  const plan = getSlideAnimationPlan(await integerTiming(slide, warn, checkpoint));
  for (const step of plan.steps) pptxTime(step.duration, "ステップの時間");
  const snapshots = await createPptxAnimationSnapshots(slide, plan.steps, sourceIds, warn, snapshotTextBudget, checkpoint);
  const ids = new Map(sourceIds);
  for (const shapes of snapshots.shapes.values()) for (const shape of shapes) ids.set(shape.id, shape.shapeId);
  const aliases = (elementId: string): string[] => [elementId, ...(snapshots.shapes.get(elementId)?.map(shape => shape.id) ?? [])];
  const colorKeys = ["fill", "stroke", "color", "textColor"];
  const opacityTargets = new Set(plan.steps.flatMap(step => step.tweens.filter(entry => has(entry, "opacity") ||
    (entry.initialElement.opacity !== 1 || snapshots.shapes.get(entry.tween.elementId)?.some(shape => shape.element.opacity !== 1)) && colorKeys.some(key => has(entry, key) &&
      typeof entry.from[key] === "string" && entry.from[key].length === 7 && typeof entry.to[key] === "string" && entry.to[key].length === 7)).map(entry => entry.tween.elementId)));
  for (const elementId of opacityTargets) warn("アニメーション対象の透明度は再生開始時に適用されます。対象図形の編集画面では透明度が1になります。", { code: "appearance-adjusted", action: "adjustment", elementId, elementName: slide.elements.find(element => element.id === elementId)?.name, property: "opacity" });
  const centerOmissions = new Map<SlideAnimationPlanTween, Set<Axis>>();
  for (const step of plan.steps) for (const entry of step.tweens) for (const axis of ["x", "y"] as const) {
    const size = axis === "x" ? "width" : "height";
    if (!has(entry, size) || !plan.steps.some(other => other.definition.timelineId !== step.definition.timelineId &&
      other.tweens.some(tween => tween.tween.elementId === entry.tween.elementId && has(tween, axis)))) continue;
    const omitted = centerOmissions.get(entry) ?? new Set<Axis>(); omitted.add(axis); centerOmissions.set(entry, omitted);
    warn("独立したタイムラインの位置変更とサイズ変更が同じPowerPoint中心座標を使用するため、サイズ変更側の中心補正を省略しました。位置変更とサイズ変更は残りますが、サイズ変更時に図形の端が移動する場合があります。", { code: "animation-conflict", action: "adjustment", elementId: entry.tween.elementId, elementName: entry.initialElement.name, animationId: step.definition.id, timelineId: step.definition.timelineId, property: size });
  }
  let nextId = 3, bytes = 0;
  const timeId = (): string => pptxTime(nextId++, "タイミングID");
  const bounded = (value: string): string => {
    bytes += value.length;
    if (bytes > OFFICE_PACKAGE_LIMITS.entryBytes) throw new Error("PowerPointのパッケージ項目のサイズが上限を超えています");
    return value;
  };
  const target = (id: string): string => `<p:tgtEl><p:spTgt spid="${ids.get(id)!}"/></p:tgtEl>`;
  const behavior = (elementId: string, name: string, duration: number, offset = 0, attrs = ""): string =>
    `<p:cBhvr additive="base" override="childStyle"><p:cTn id="${timeId()}" dur="${Math.max(1, duration)}" fill="hold"${attrs}>${delay(offset)}</p:cTn>${target(elementId)}<p:attrNameLst><p:attrName>${name}</p:attrName></p:attrNameLst></p:cBhvr>`;
  const setTarget = (elementId: string, name: string, value: number | boolean | string, offset: number): string => {
    return bounded(`<p:set>${behavior(elementId, name, 1, offset)}<p:to>${typeof value === "boolean" ? `<p:boolVal val="${value ? 1 : 0}"/>` : typeof value === "string" ? `<p:strVal val="${xml(value)}"/>` : `<p:fltVal val="${numeric(value)}"/>`}</p:to></p:set>`);
  };
  const set = (elementId: string, name: string, value: number | boolean | string, offset: number): string =>
    aliases(elementId).map(id => setTarget(id, name, value, offset)).join("");
  const numericAnimation = (elementId: string, name: string, duration: number, offset: number, values: readonly { time: number; value: number }[], attrs = ""): string => {
    return aliases(elementId).map(id => bounded(`<p:anim calcmode="lin" valueType="num">${behavior(id, name, duration, offset, attrs)}<p:tavLst>${values.map(value => `<p:tav tm="${value.time}"><p:val><p:fltVal val="${numeric(value.value)}"/></p:val></p:tav>`).join("")}</p:tavLst></p:anim>`)).join("");
  };
  const group = (duration: number, offset: number, children: string, attrs = ""): string =>
    `<p:par><p:cTn id="${timeId()}" dur="${Math.max(1, duration)}" fill="hold"${attrs}>${delay(offset)}<p:childTnLst>${children}</p:childTnLst></p:cTn></p:par>`;
  const channels = (entry: SlideAnimationPlanTween, omit: ReadonlySet<Axis>): Channel[] => {
    const result: Channel[] = [];
    if (!omit.has("x") && (has(entry, "x") || has(entry, "width"))) result.push({ name: "ppt_x", value: element => (element.x + element.width / 2) / width });
    if (!omit.has("y") && (has(entry, "y") || has(entry, "height"))) result.push({ name: "ppt_y", value: element => (element.y + element.height / 2) / height });
    if (has(entry, "width")) result.push({ name: "ppt_w", value: element => element.width / width });
    if (has(entry, "height")) result.push({ name: "ppt_h", value: element => element.height / height });
    if (has(entry, "rotation")) result.push({ name: "r", value: element => element.rotation });
    return result;
  };
  const colorValue = (value: string): string => {
    return value === "transparent" ? "000000" : value.slice(1, 7).toUpperCase();
  };
  const colorAnimation = async (entry: SlideAnimationPlanTween, key: string, name: string): Promise<string> => {
    const segments = curved(entry) ? CURVE_SAMPLES : 1, values: string[] = [];
    const times = [...new Set(Array.from({ length: segments + 1 }, (_, index) => Math.round(index * entry.tween.durationMs / segments)))];
    for (let index = 0; index < times.length - 1; index++) {
      const start = times[index], end = times[index + 1];
      const from = String(sampleSlideAnimationTweenProgress(entry, start / entry.tween.durationMs)[key]);
      const to = String(sampleSlideAnimationTweenProgress(entry, end / entry.tween.durationMs)[key]);
      for (const id of aliases(entry.tween.elementId)) {
        await checkpoint();
        values.push(bounded(`<p:animClr clrSpc="rgb" dir="cw">${behavior(id, name, end - start, start, segments === 1 ? easing(entry) : "")}<p:from><a:srgbClr val="${colorValue(from)}"/></p:from><p:to><a:srgbClr val="${colorValue(to)}"/></p:to></p:animClr>`));
      }
    }
    return values.join("");
  };
  const coupledAxes = (step: SlideAnimationPlanStep): Map<string, Set<Axis>> => {
    const result = new Map<string, Set<Axis>>();
    for (const axis of ["x", "y"] as const) {
      const size = axis === "x" ? "width" : "height";
      for (const entry of step.tweens) if (has(entry, axis) || has(entry, size)) {
        if (!step.tweens.some(other => other !== entry && other.tween.elementId === entry.tween.elementId && other.start < entry.end && entry.start < other.end &&
          ((has(entry, axis) && has(other, size)) || (has(entry, size) && has(other, axis))))) continue;
        const axes = result.get(entry.tween.elementId) ?? new Set<Axis>(); axes.add(axis); result.set(entry.tween.elementId, axes);
      }
    }
    return result;
  };
  const coupledCenter = async (step: SlideAnimationPlanStep, elementId: string, axis: Axis): Promise<string> => {
    warn("並列の位置とサイズ変更は、PowerPointの中心座標へ有限キーフレームで合成しました。", { code: "animation-approximated", action: "approximation", elementId, elementName: step.initial.elements.find(element => element.id === elementId)?.name, animationId: step.definition.id, timelineId: step.definition.timelineId, property: axis });
    const size = axis === "x" ? "width" : "height", dimension = axis === "x" ? width : height;
    const entries = step.tweens.filter(entry => entry.tween.elementId === elementId && (has(entry, axis) || has(entry, size)));
    const points = new Set<number>();
    for (const entry of entries) {
      points.add(entry.start); points.add(entry.end);
      const passes = (entry.tween.repeat ?? 1) * (entry.tween.yoyo ? 2 : 1);
      for (let pass = 0; pass < passes; pass++) for (let sample = 0; sample <= CURVE_SAMPLES; sample++) {
        await checkpoint();
        points.add(Math.round(entry.start + (pass + sample / CURVE_SAMPLES) * entry.tween.durationMs));
      }
    }
    // Separate curves at explicit starts and iteration jumps; no interpolation across an instantaneous reset.
    const boundaries = new Set<number>();
    for (const entry of entries) {
      boundaries.add(entry.start); boundaries.add(entry.end);
      const passes = (entry.tween.repeat ?? 1) * (entry.tween.yoyo ? 2 : 1);
      for (let index = 0; index < passes; index++) { await checkpoint(); boundaries.add(entry.start + index * entry.tween.durationMs); }
    }
    const ordered = [...boundaries].sort((a, b) => a - b), curves: string[] = [];
    const coordinate = (elapsed: number): number => {
      const element = sampleSlideAnimationElement(step, elementId, elapsed);
      return (element[axis] + element[size] / 2) / dimension;
    };
    for (let index = 0; index < ordered.length - 1; index++) {
      await checkpoint();
      const start = ordered[index], end = ordered[index + 1];
      const values = [...points].filter(time => time > start && time < end).sort((a, b) => a - b);
      const all = [start, ...values, end];
      curves.push(numericAnimation(elementId, axis === "x" ? "ppt_x" : "ppt_y", end - start, start,
        all.map(time => ({ time: Math.round((time - start) / (end - start) * 100000), value: coordinate(time === end ? Math.max(start, end - 0.000001) : time) }))));
    }
    return group(step.duration, 0, curves.join(""));
  };
  const renderStep = async (step: SlideAnimationPlanStep): Promise<string> => {
    const coupled = coupledAxes(step), children: string[] = [];
    for (const entry of step.tweens) {
      await checkpoint();
      const base = sampleSlideAnimationElement(step, entry.tween.elementId, entry.start);
      const count = curved(entry) ? CURVE_SAMPLES : 1;
      const details = { elementId: entry.tween.elementId, elementName: entry.initialElement.name, animationId: step.definition.id, timelineId: step.definition.timelineId };
      if (count > 1) warn("spring/bounceはPowerPoint用の有限キーフレームに近似しました。", { ...details, code: "animation-approximated", action: "approximation", property: Object.keys(entry.from).join(",") });
      const pieces: string[] = [];
      for (const channel of channels(entry, new Set([...(coupled.get(entry.tween.elementId) ?? []), ...(centerOmissions.get(entry) ?? [])]))) {
        const values = Array.from({ length: count + 1 }, (_, index) => ({ time: Math.round(index / count * 100000), value: channel.value({ ...base, ...sampleSlideAnimationTweenProgress(entry, index / count) } as SlideElement) }));
        pieces.push(numericAnimation(entry.tween.elementId, channel.name, entry.tween.durationMs, 0, values, count === 1 ? easing(entry) : ""));
      }
      for (const [key, name] of [["fill", "fillcolor"], ["stroke", "stroke.color"], ["color", "style.color"], ["textColor", "style.color"]]) if (has(entry, key)) {
        if (snapshots.properties.get(entry.tween.elementId)?.has(key)) continue;
        if (key === "fill") pieces.push(set(entry.tween.elementId, "fill.on", true, 0));
        if (key === "stroke") pieces.push(set(entry.tween.elementId, "stroke.on", true, 0));
        pieces.push(await colorAnimation(entry, key, name));
      }
      if (has(entry, "opacity") && !snapshots.properties.get(entry.tween.elementId)?.has("opacity")) {
        warn("透明度のアニメーションはPowerPoint用の段階的な値の切り替えに近似しました。", { ...details, code: "animation-approximated", action: "approximation", property: "opacity" });
        if (snapshots.shapes.has(entry.tween.elementId)) warn("独立した透明度アニメーションを各フレーム図形へ適用しました。PPTXの再読み込みでは非表示の切り替えと透明度変更を同時に復元できません。", { ...details, code: "animation-approximated", action: "approximation", property: "opacity" });
        const values = new Map<number, number>();
        for (let index = 0; index <= CURVE_SAMPLES; index++) {
          const time = Math.round(index / CURVE_SAMPLES * entry.tween.durationMs);
          values.set(Math.min(time, entry.tween.durationMs - 1), Number(sampleSlideAnimationTweenProgress(entry, time / entry.tween.durationMs).opacity));
        }
        for (const [time, value] of values) { await checkpoint(); pieces.push(set(entry.tween.elementId, "style.opacity", value, time)); }
      }
      if (pieces.length) children.push(group(entry.tween.durationMs, entry.start, pieces.join(""), ` repeatCount="${(entry.tween.repeat ?? 1) * 1000}"${entry.tween.yoyo ? ' autoRev="1"' : ""}`));
    }
    for (const [id, axes] of coupled) for (const axis of axes) children.push(await coupledCenter(step, id, axis));
    const switches = snapshots.switches.get(step.definition.id);
    if (switches?.length) {
      const values: string[] = [];
      for (const event of switches) { await checkpoint(); values.push(setTarget(event.previous, "style.visibility", "hidden", event.time), setTarget(event.current, "style.visibility", "visible", event.time)); }
      children.push(group(step.duration, 0, values.join("")));
    }
    const trigger = step.definition.trigger;
    if (trigger?.type === "click" && trigger.elementId && aliases(trigger.elementId).length > 1) warn("図形クリックの開始条件をアニメーションの各フレーム図形へ展開しました。再読み込みでは複数のクリック対象を一つに復元できません。", { code: "animation-approximated", action: "approximation", elementId: trigger.elementId, elementName: slide.elements.find(element => element.id === trigger.elementId)?.name, animationId: step.definition.id, timelineId: step.definition.timelineId });
    const condition = trigger?.type === "click" ? `<p:stCondLst>${(trigger.elementId ? aliases(trigger.elementId).map(id => `<p:spTgt spid="${ids.get(id)!}"/>`) : ["<p:sldTgt/>"]).map(target => `<p:cond evt="onClick" delay="0"><p:tgtEl>${target}</p:tgtEl></p:cond>`).join("")}</p:stCondLst>` : delay(trigger?.type === "after-delay" ? trigger.delayMs : 0);
    return `<p:par><p:cTn id="${timeId()}" dur="${step.duration}" fill="hold">${condition}${children.length ? `<p:childTnLst>${children.join("")}</p:childTnLst>` : ""}</p:cTn></p:par>`;
  };
  const initialOpacity = slide.elements.filter(element => opacityTargets.has(element.id)).flatMap(element => [
    setTarget(element.id, "style.opacity", element.opacity, 0),
    ...(snapshots.shapes.get(element.id)?.map(shape => setTarget(shape.id, "style.opacity", shape.element.opacity, 0)) ?? []),
  ]).join("");
  const initialVisibility = [...snapshots.shapes.values()].flatMap(shapes => shapes.map(shape => setTarget(shape.id, "style.visibility", "hidden", 0))).join("");
  const main = plan.timelines.find(timeline => timeline.timelineId === undefined) ?? plan.timelines[0];
  const sequences: string[] = [];
  for (const [index, timeline] of [main, ...plan.timelines.filter(timeline => timeline !== main)].entries()) {
    const id = index === 0 ? "2" : timeId(), steps: string[] = [];
    for (const step of timeline.steps) steps.push(await renderStep(step));
    sequences.push(`<p:seq concurrent="0"><p:cTn id="${id}" dur="indefinite" nodeType="${index === 0 ? "mainSeq" : "interactiveSeq"}"><p:childTnLst>${steps.join("")}</p:childTnLst></p:cTn></p:seq>`);
  }
  const timing = `<p:timing><p:tnLst><p:par><p:cTn id="1" dur="indefinite" restart="never" nodeType="tmRoot"><p:childTnLst>${initialOpacity}${initialVisibility}${sequences.join("")}</p:childTnLst></p:cTn></p:par></p:tnLst></p:timing>`;
  if (timing.length > OFFICE_PACKAGE_LIMITS.entryBytes) throw new Error("PowerPointのパッケージ項目のサイズが上限を超えています");
  return { timing, opacityTargets, snapshots: snapshots.shapes };
}
