import type { SlideAnimationEasing, SlideAnimationNode, SlideAnimationProperties, SlideAnimationStep, SlideAnimationTrigger, SlideElement } from "../model/types";
import { normalizeSlideAnimations, animationNodeDuration, scheduleAnimation } from "../model/animation-validation";
import { resolveSlideAnimations, sampleSlideAnimationTween, type SlideAnimationPlanTween } from "../model/animations";
import { normalizeSlideElement } from "../model/normalize";
import { createOfficeTaskCheckpoint, type OfficeTaskCheckpoint } from "../office/cooperative-task";
import { child, children, localName, textContent, color, type Node, type PptxContext, type Theme } from "./pptx-reader";

type Properties = SlideAnimationProperties;
type Key = keyof Properties;
type Tween = Extract<SlideAnimationNode, { type: "tween" }>;
type RawTween = Tween & { source?: Node; visibility?: boolean; centerX?: boolean; centerY?: boolean; scale?: boolean; noOp?: boolean; relative?: Properties };
type RawNode = RawTween | { type: "sequence" | "parallel"; children: RawNode[] };
type Parsed = { node: RawNode; trigger?: SlideAnimationTrigger };
type Options = { context: PptxContext; theme: Theme; mapping: Record<string, string>; targets: ReadonlyMap<string, SlideElement>; width: number; height: number; pageNumber: number; slideId?: string; layoutId?: string;
  applyInitialValues?(element: SlideElement): void };
const unsupported = (message: string): never => { throw new Error(message); };
const numeric = (value: string | undefined, label: string): number => {
  if (value === undefined || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return unsupported(`${label}が数値ではありません`);
  const result = Number(value); if (!Number.isFinite(result)) return unsupported(`${label}が有限値ではありません`); return result;
};
const duration = (value: string | undefined, label: string, min = 0) => {
  const result = numeric(value, label);
  if (result < min) return unsupported(`${label}が有効な時間ではありません`);
  return result;
};
const truth = (value: string | undefined) => value === "1" || value === "true";
const timing = (node: Node) => localName(node.name) === "cTn" ? node : child(node, "cTn") ?? child(child(node, "cBhvr"), "cTn");
type Point = { at: number; value: number | string };
function pointComponents(value: number | string): number[] {
  if (typeof value === "number") return [value];
  return /^#[a-f\d]{6}$/i.test(value) ? [1, 3, 5].map(at => parseInt(value.slice(at, at + 2), 16)) : [];
}
function interpolatePoint(left: Point, right: Point, at: number): number | string {
  const fraction = (at - left.at) / (right.at - left.at), a = pointComponents(left.value), b = pointComponents(right.value);
  if (!a.length || a.length !== b.length) return fraction < 1 ? left.value : right.value;
  const values = a.map((value, index) => value + (b[index] - value) * fraction);
  return typeof left.value === "number" ? values[0] : `#${values.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}
/** Coalesce redundant linear subdivisions without imposing a sample count. */
function coalescedPoints(source: Point[]): Point[] {
  const points: Point[] = [];
  for (const point of source) {
    while (points.length > 1) {
      const left = points[points.length - 2], middle = points[points.length - 1];
      const expected = pointComponents(interpolatePoint(left, point, middle.at)), actual = pointComponents(middle.value);
      if (!expected.length || expected.length !== actual.length || expected.some((value, index) => Math.abs(value - actual[index]) > 1e-7)) break;
      points.pop();
    }
    points.push(point);
  }
  return points;
}
function shifted(node: RawNode, amount: number): RawNode {
  if (!amount) return node;
  if (node.type === "tween") return { ...node, delayMs: (node.delayMs ?? 0) + amount };
  return { ...node, children: node.children.map((item, index) => node.type === "parallel" || index === 0 ? shifted(item, amount) : item) };
}
function parallel(nodes: RawNode[]): RawNode {
  const flattened = nodes.flatMap(node => node.type === "parallel" ? node.children : [node]);
  const merged: RawNode[] = [];
  for (const node of flattened) {
    if (node.type === "sequence") {
      const compatible = (left: RawNode, right: RawNode): boolean => left.type === "tween" && right.type === "tween"
        ? !left.noOp && !right.noOp && !!left.visibility === !!right.visibility && left.elementId === right.elementId && left.durationMs === right.durationMs && (left.delayMs ?? 0) === (right.delayMs ?? 0) &&
          (left.repeat ?? 1) === (right.repeat ?? 1) && !!left.yoyo === !!right.yoyo && (left.easing ?? "linear") === (right.easing ?? "linear") &&
          !Object.keys({ ...left.from, ...left.to }).some(key => Object.hasOwn(right.from ?? {}, key) || Object.hasOwn(right.to, key))
        : left.type === "sequence" && right.type === "sequence" && left.children.length === right.children.length && left.children.every((item, index) => compatible(item, right.children[index]));
      const at = merged.findIndex(value => compatible(value, node));
      if (at !== -1) {
        const zip = (left: RawNode, right: RawNode): RawNode => left.type === "sequence" && right.type === "sequence"
          ? { type: "sequence", children: left.children.map((item, index) => zip(item, right.children[index])) } : parallel([left, right]);
        merged[at] = zip(merged[at], node); continue;
      }
    }
    const other = node.type === "tween" && !node.noOp ? merged.find((value): value is RawTween => value.type === "tween" && !value.noOp && !!value.visibility === !!node.visibility && value.elementId === node.elementId &&
      value.durationMs === node.durationMs && (value.delayMs ?? 0) === (node.delayMs ?? 0) && (value.repeat ?? 1) === (node.repeat ?? 1) &&
      !!value.yoyo === !!node.yoyo && (value.easing ?? "linear") === (node.easing ?? "linear") &&
      !Object.keys({ ...value.from, ...value.to }).some(key => Object.hasOwn(node.from ?? {}, key) || Object.hasOwn(node.to, key))) : undefined;
    if (other && node.type === "tween") {
      Object.assign(other.to, node.to);
      if (node.from) other.from = { ...other.from, ...node.from };
      if (node.relative) other.relative = { ...other.relative, ...node.relative };
      if (node.centerX) other.centerX = true;
      if (node.centerY) other.centerY = true;
      if (node.scale) other.scale = true;
    } else merged.push(node.type === "tween" ? { ...node, to: { ...node.to }, ...(node.from ? { from: { ...node.from } } : {}) } : node);
  }
  return merged.length === 1 ? merged[0] : { type: "parallel", children: merged };
}
async function repeated(node: RawNode, repeat: number, yoyo: boolean, checkpoint: OfficeTaskCheckpoint): Promise<RawNode> {
  if (repeat === 1 && !yoyo) return node;
  if (node.type === "tween" && !(node.delayMs ?? 0) && (node.repeat ?? 1) === 1 && !node.yoyo)
    return { ...node, ...(repeat !== 1 ? { repeat } : {}), ...(yoyo ? { yoyo: true } : {}) };
  const leaves = scheduleAnimation(node), span = animationNodeDuration(node);
  const reverse = (): RawNode => parallel(leaves.map(entry => {
    const leaf = entry.tween as RawTween;
    if (leaf.relative || Object.keys(leaf.to).some(key => !Object.hasOwn(leaf.from ?? {}, key))) return unsupported("開始値を特定できないグループの往復は未対応です");
    return { ...leaf, delayMs: span - entry.end, from: { ...leaf.to }, to: { ...leaf.from },
      easing: leaf.easing === "ease-in" ? "ease-out" : leaf.easing === "ease-out" ? "ease-in" : leaf.easing };
  }));
  const cycle = [node, ...(yoyo ? [reverse()] : [])];
  const expanded: RawNode[] = [];
  for (let index = 0; index < repeat; index++) { await checkpoint(); expanded.push(...cycle); }
  return { type: "sequence", children: expanded };
}

/** Import supported standard PresentationML timing; never read private extension metadata. */
export async function readSlideAnimations(root: Node | undefined, options: Options): Promise<SlideAnimationStep[] | undefined> {
  if (!root) return;
  const { context, pageNumber } = options;
  const checkpoint = createOfficeTaskCheckpoint(context.signal);
  const targets = new Map(options.targets);
  const baselineOpacity = new Map([...targets.values()].map(element => [element.id, element.opacity]));
  const visibilityTargets = new Set<string>();
  let activeAnimationId: string | undefined, activeTimelineId: string | undefined;
  let applyingInitialValues = false;
  const warn = (node: Node, message: string, details: Parameters<PptxContext["warn"]>[1] = {}) => {
    const common = child(node, "cBhvr"), target = child(child(common, "tgtEl"), "spTgt") ?? child(child(child(child(timing(node), "stCondLst"), "cond"), "tgtEl"), "spTgt"), element = target && targets.get(target.attributes.spid);
    context.warn(`スライド ${pageNumber} のアニメーション${timing(node)?.attributes.id ? ` (${timing(node)!.attributes.id})` : ""}: ${message}`, {
      code: "unsupported-animation", action: "omission", slideIndex: pageNumber - 1, slideId: options.slideId ?? `pptx-slide-${pageNumber}`,
      ...(activeAnimationId ? { animationId: activeAnimationId } : {}), ...(activeTimelineId ? { timelineId: activeTimelineId } : {}),
      ...(element ? { elementId: element.id, elementName: element.name } : {}), ...(timing(node)?.attributes.id ? { timingId: timing(node)!.attributes.id } : {}),
      ...(child(child(common, "attrNameLst"), "attrName") ? { property: textContent(child(child(common, "attrNameLst"), "attrName")!) } : {}), ...details,
    });
  };
  const ids = new Set<string>(), pending = [root];
  while (pending.length) {
    await checkpoint();
    const node = pending.pop()!;
    if (localName(node.name) === "cTn" && node.attributes.id) {
      if (ids.has(node.attributes.id)) { warn(node, "タイミングIDが重複しています。タイミングを省略しました"); return; }
      ids.add(node.attributes.id);
    }
    if (localName(node.name) === "set" && child(child(node, "to"), "strVal")?.attributes.val === "hidden") {
      const target = child(child(child(node, "cBhvr"), "tgtEl"), "spTgt");
      if (target) visibilityTargets.add(target.attributes.spid);
    }
    for (let index = node.children.length - 1; index >= 0; index--) pending.push(node.children[index]);
  }
  if (child(root, "bldLst")?.children.some(node => localName(node.name) !== "bldP" || node.attributes.build && node.attributes.build !== "allAtOnce"))
    warn(root, "段落・図表の個別ビルド設定を省略しました");
  const getTarget = (node: Node): SlideElement => {
    const target = child(node, "spTgt");
    if (!target || target.children.some(item => localName(item.name) !== "txEl" || item.children.some(range =>
      !["charRg", "pRg"].includes(localName(range.name)) || range.attributes.st !== "4294967295" || range.attributes.end !== "4294967295")))
      return unsupported("図形全体以外のアニメーション対象は未対応です");
    const element = targets.get(target.attributes.spid);
    if (!element) return unsupported(`対象の図形ID ${target.attributes.spid ?? "?"} を読み込めませんでした`);
    return element;
  };
  const start = (ctn: Node | undefined): { delay: number; trigger?: SlideAnimationTrigger } => {
    const conditions = children(child(ctn, "stCondLst"), "cond");
    if (conditions.length > 1) warn(ctn!, "複数の開始条件を最初の条件へ近似しました", { code: "animation-approximated", action: "approximation" });
    const condition = conditions[0]; if (!condition) return { delay: 0 };
    const event = condition.attributes.evt;
    if (condition.children.some(item => localName(item.name) !== "tgtEl")) return unsupported("他のタイミングを参照する開始条件は未対応です");
    if (event === "onClick" || !event && condition.attributes.delay === "indefinite") {
      const target = child(condition, "tgtEl");
      const element = target && child(target, "spTgt") ? getTarget(target) : undefined;
      if (target && !element && !child(target, "sldTgt")) return unsupported("クリック対象が未対応です");
      return { delay: condition.attributes.delay && condition.attributes.delay !== "indefinite" ? duration(condition.attributes.delay, "クリック後の遅延") : 0,
        trigger: { type: "click", ...(element ? { elementId: element.id } : {}) } };
    }
    if (event || child(condition, "tgtEl")) return unsupported(`開始イベント ${event ?? "target"} は未対応です`);
    return { delay: duration(condition.attributes.delay ?? "0", "開始遅延") };
  };
  const waiting = (node: Node): Parsed | undefined => {
    // Preserve a skipped behavior's known interval so later sequential effects keep their position.
    // Unresolved references and indefinite/repeating schedules cannot safely become a finite wait.
    try {
      const ctn = timing(node), condition = start(ctn);
      const repeat = ctn?.attributes.repeatCount === undefined ? 1 : numeric(ctn.attributes.repeatCount, "繰り返し回数") / 1000;
      if (!Number.isSafeInteger(repeat) || repeat < 1) return undefined;
      const span = duration(ctn?.attributes.dur, "待機時間", Number.MIN_VALUE) * repeat * (truth(ctn?.attributes.autoRev) ? 2 : 1);
      if (!Number.isFinite(span + condition.delay)) return undefined;
      const element = targets.values().next().value as SlideElement | undefined;
      return element ? { node: { source: node, type: "tween", noOp: true, elementId: element.id, durationMs: span,
        ...(condition.delay ? { delayMs: condition.delay } : {}), to: {} }, ...(condition.trigger ? { trigger: condition.trigger } : {}) } : undefined;
    } catch { return undefined; }
  };
  const modifiers = (ctn: Node | undefined, node: Node) => {
    if (!ctn) return unsupported("共通タイミング情報がありません");
    if (ctn.children.some(item => !["stCondLst", "childTnLst"].includes(localName(item.name)))) return unsupported("終了条件・反復単位・補助タイムラインは未対応です");
    for (const key of ["repeatDur", "tmFilter", "evtFilter"]) if (ctn.attributes[key] !== undefined) return unsupported(`${key}は未対応です`);
    if (ctn.attributes.spd !== undefined && Number(ctn.attributes.spd) !== 100000) return unsupported("再生速度の変更は未対応です");
    if (truth(ctn.attributes.afterEffect) || ctn.attributes.display === "0" || ctn.attributes.display === "false") return unsupported("再生後の効果・非表示タイミングは未対応です");
    if (ctn.attributes.fill && !["hold", "freeze"].includes(ctn.attributes.fill)) return unsupported(`終了後の状態 ${ctn.attributes.fill} は未対応です`);
    const repeat = ctn.attributes.repeatCount === undefined ? 1 : numeric(ctn.attributes.repeatCount, "繰り返し回数") / 1000;
    if (!Number.isSafeInteger(repeat) || repeat < 1) return unsupported("無限・端数・安全な整数でない繰り返しは未対応です");
    const accel = numeric(ctn.attributes.accel ?? "0", "加速"), decel = numeric(ctn.attributes.decel ?? "0", "減速");
    let easing: SlideAnimationEasing = "linear";
    if (accel === 100000 && decel === 0) easing = "ease-in";
    else if (accel === 0 && decel === 100000) easing = "ease-out";
    else if (accel === 50000 && decel === 50000) easing = "ease-in-out";
    else if (accel || decel) warn(node, "対応外の加速・減速を一定速度へ近似しました", { code: "animation-approximated", action: "approximation" });
    return { repeat, yoyo: truth(ctn.attributes.autoRev), easing };
  };
  const scalar = (value: string | undefined, element: SlideElement, name: string) => {
    const symbols: Record<string, number> = { "#ppt_x": (element.x + element.width / 2) / options.width,
      "#ppt_y": (element.y + element.height / 2) / options.height, "#ppt_w": element.width / options.width, "#ppt_h": element.height / options.height };
    return value && Object.hasOwn(symbols, value) ? symbols[value] : numeric(value, name);
  };
  const property = (name: string, element: SlideElement): { key: Key; factor: number; centerX?: true; centerY?: true; color?: true } => {
    switch (name) {
      case "ppt_x": return { key: "x", factor: options.width, centerX: true };
      case "ppt_y": return { key: "y", factor: options.height, centerY: true };
      case "ppt_w": return { key: "width", factor: options.width };
      case "ppt_h": return { key: "height", factor: options.height };
      case "r": case "style.rotation": return { key: "rotation", factor: 1 };
      case "style.opacity": return { key: "opacity", factor: 1 };
      case "style.fontSize": if (element.type !== "image") return { key: "fontSize", factor: element.fontSize }; break;
      case "stroke.weight": if (element.type === "shape") return { key: "strokeWidth", factor: 4 / 3 }; break;
      case "fillcolor": case "fill.color": if (element.type !== "image") return { key: "fill", factor: 1, color: true }; break;
      case "stroke.color": if (element.type === "shape") return { key: "stroke", factor: 1, color: true }; break;
      case "style.color": if (element.type !== "image") return { key: element.type === "text" ? "color" : "textColor", factor: 1, color: true }; break;
    }
    return unsupported(`プロパティ ${name} は未対応です`);
  };
  const readColor = (node: Node | undefined) => color(node, options.theme, options.mapping, context) ?? unsupported("アニメーションの色形式は未対応です");
  const behavior = async (node: Node): Promise<Parsed> => {
    await checkpoint();
    const common = child(node, "cBhvr"), ctn = child(common, "cTn"), type = localName(node.name);
    if (!common) return unsupported("アニメーションの共通設定がありません");
    if (common.attributes.additive && common.attributes.additive !== "base" || common.attributes.accumulate && common.attributes.accumulate !== "none")
      return unsupported("加算・累積するアニメーションは未対応です");
    const element = getTarget(child(common, "tgtEl") ?? common), mod = modifiers(ctn, node), condition = start(ctn);
    const base: RawTween = { source: node, type: "tween", elementId: element.id, durationMs: duration(ctn?.attributes.dur, "所要時間", Number.MIN_VALUE), to: {},
      ...(mod.repeat !== 1 ? { repeat: mod.repeat } : {}), ...(mod.yoyo ? { yoyo: true } : {}), ...(mod.easing !== "linear" ? { easing: mod.easing } : {}) };
    const names = children(child(common, "attrNameLst"), "attrName").map(textContent);
    if ((!applyingInitialValues && names.includes("style.opacity") || type === "animEffect" && node.attributes.filter === "fade") &&
      visibilityTargets.has(child(child(common, "tgtEl"), "spTgt")?.attributes.spid ?? ""))
      return unsupported("表示切り替えと独立した透明度の合成は未対応のため、透明度の動作を読み込めません");
    let result: RawNode = base;
    if (type === "set") {
      if (names.length !== 1) return unsupported("設定するプロパティを1つ指定してください");
      const visibility = child(child(node, "to"), "strVal")?.attributes.val;
      const visibilityTarget = child(child(common, "tgtEl"), "spTgt")?.attributes.spid;
      if ((names[0] === "style.visibility" && visibility === "visible" && !visibilityTargets.has(visibilityTarget ?? "")) ||
        ["fill.on", "stroke.on"].includes(names[0]) && truth(child(child(node, "to"), "boolVal")?.attributes.val)) {
        return { node: shifted({ ...base, noOp: true }, condition.delay), ...(condition.trigger ? { trigger: condition.trigger } : {}) };
      }
      if (names[0] === "style.visibility") {
        if (visibility !== "visible" && visibility !== "hidden") return unsupported("表示状態の設定値は未対応です");
        const opacity = visibility === "hidden" ? 0 : baselineOpacity.get(element.id)!;
        return { node: shifted({ ...base, visibility: true, from: { opacity }, to: { opacity } }, condition.delay), ...(condition.trigger ? { trigger: condition.trigger } : {}) };
      }
      const spec = property(names[0], element);
      const to = child(node, "to");
      let value: number | string;
      if (spec.color) value = readColor(child(to, "clrVal") ?? to);
      else value = scalar(to?.children.find(item => ["fltVal", "intVal", "strVal"].includes(localName(item.name)))?.attributes.val, element, "設定値") * spec.factor;
      base.centerX = "centerX" in spec ? spec.centerX : undefined; base.centerY = "centerY" in spec ? spec.centerY : undefined;
      base.from = { [spec.key]: value }; base.to = { [spec.key]: value };
    } else if (type === "anim" || type === "animClr") {
      if (names.length !== 1) return unsupported("複数または未指定の対象プロパティは未対応です");
      const spec = property(names[0], element);
      base.centerX = spec.centerX; base.centerY = spec.centerY;
      if (type === "animClr") {
        if (!spec.color || child(node, "by") || node.attributes.clrSpc && node.attributes.clrSpc !== "rgb") return unsupported("相対色・HSL色のアニメーションは未対応です");
        base.to = { [spec.key]: readColor(child(node, "to")) };
        if (child(node, "from")) base.from = { [spec.key]: readColor(child(node, "from")) };
      } else {
        if (node.attributes.calcmode && node.attributes.calcmode !== "lin") return unsupported("線形補間以外のキーフレームは未対応です");
        const values = children(child(node, "tavLst"), "tav");
        const decode = (item: Node): number | string => {
          if (item.attributes.fmla) return unsupported("キーフレームの数式は未対応です");
          const value = child(item, "val");
          if (spec.color) return readColor(child(value, "clrVal") ?? value);
          const scalarNode = value?.children.find(item => ["fltVal", "intVal", "strVal"].includes(localName(item.name)));
          return scalar(scalarNode?.attributes.val, element, "キーフレーム値") * spec.factor;
        };
        if (values.length) {
          if (values.length < 2) return unsupported("キーフレーム数が対応範囲外です");
          let points: Point[] = [];
          for (const item of values) { await checkpoint(); points.push({ at: numeric(item.attributes.tm, "キーフレーム時刻"), value: decode(item) }); }
          if (points[0].at !== 0 || points.at(-1)!.at !== 100000 || points.some((point, i) => i && point.at <= points[i - 1].at))
            return unsupported("キーフレームは0〜100000の昇順で指定してください");
          points = coalescedPoints(points);
          if (points.length === 2) { base.from = { [spec.key]: points[0].value }; base.to = { [spec.key]: points[1].value }; }
          else {
            if (mod.easing !== "linear") return unsupported("加減速付きの複数キーフレームは未対応です");
            const segments: RawTween[] = points.slice(1).map((point, i) => ({ ...base, repeat: undefined, yoyo: undefined,
              durationMs: base.durationMs * (point.at - points[i].at) / 100000, from: { [spec.key]: points[i].value }, to: { [spec.key]: point.value } }));
            const cycle = [...segments, ...(mod.yoyo ? [...segments].reverse().map(item => ({ ...item, from: item.to, to: item.from! })) : [])];
            const expanded: RawNode[] = [];
            for (let index = 0; index < mod.repeat; index++) for (const segment of cycle) { await checkpoint(); expanded.push(segment); }
            result = { type: "sequence", children: expanded };
          }
        } else {
          if (spec.color) return unsupported("色のキーフレームがありません");
          if (node.attributes.from !== undefined) base.from = { [spec.key]: scalar(node.attributes.from, element, "開始値") * spec.factor };
          if (node.attributes.to !== undefined) base.to = { [spec.key]: scalar(node.attributes.to, element, "終了値") * spec.factor };
          else if (node.attributes.by !== undefined && !spec.centerX && !spec.centerY) {
            base.to = { [spec.key]: 0 }; base.relative = { [spec.key]: scalar(node.attributes.by, element, "相対値") * spec.factor };
          } else return unsupported("終了値がない、または相対位置のプロパティ指定は未対応です");
        }
      }
    } else if (type === "animRot") {
      if (node.attributes.from !== undefined) base.from = { rotation: numeric(node.attributes.from, "開始角度") / 60000 };
      if (node.attributes.to !== undefined) base.to = { rotation: numeric(node.attributes.to, "終了角度") / 60000 };
      else if (node.attributes.by !== undefined) { base.to = { rotation: 0 }; base.relative = { rotation: numeric(node.attributes.by, "相対角度") / 60000 }; }
      else return unsupported("回転の終了値がありません");
    } else if (type === "animScale") {
      const from = child(node, "from"), to = child(node, "to") ?? child(node, "by");
      if (!to) return unsupported("拡大縮小の終了値がありません");
      const scale = (value: Node, fallback = 100000) => ({ width: element.width * numeric(value.attributes.x ?? String(fallback), "横倍率") / 100000,
        height: element.height * numeric(value.attributes.y ?? String(fallback), "縦倍率") / 100000 });
      base.from = from ? scale(from) : { width: element.width, height: element.height };
      base.to = scale(to);
      base.centerX = true; base.centerY = true;
      base.scale = true;
      Object.assign(base.from, { x: element.x + element.width / 2, y: element.y + element.height / 2 });
      Object.assign(base.to, { x: element.x + element.width / 2, y: element.y + element.height / 2 });
      if (element.type !== "image" && element.text) warn(node, "拡大縮小の文字倍率を維持せず、要素の位置とサイズへ変換しました", { code: "animation-approximated", action: "approximation" });
    } else if (type === "animMotion") {
      if (node.attributes.origin && node.attributes.origin !== "layout" || node.attributes.rAng && Number(node.attributes.rAng) || child(node, "rCtr"))
        return unsupported("親基準・回転する移動経路は未対応です");
      const path = node.attributes.path;
      if (path) {
        const n = "([+-]?(?:\\d+(?:\\.\\d*)?|\\.\\d+)(?:[eE][+-]?\\d+)?)";
        const match = new RegExp(`^\\s*M\\s+${n}[ ,]+${n}\\s+L\\s+${n}[ ,]+${n}\\s+E\\s*$`).exec(path);
        if (!match) return unsupported("直線1区間以外の移動経路は未対応です");
        base.from = { x: element.x + Number(match[1]) * options.width, y: element.y + Number(match[2]) * options.height };
        base.to = { x: element.x + Number(match[3]) * options.width, y: element.y + Number(match[4]) * options.height };
      } else {
        const position = (value: Node): Properties => ({ x: element.x + numeric(value.attributes.x, "移動の横位置") * options.width / 100000,
          y: element.y + numeric(value.attributes.y, "移動の縦位置") * options.height / 100000 });
        const from = child(node, "from"), to = child(node, "to"), by = child(node, "by");
        if (from) base.from = position(from);
        if (to) base.to = position(to);
        else if (by) { base.to = { x: 0, y: 0 }; base.relative = { x: numeric(by.attributes.x, "横移動量") * options.width / 100000, y: numeric(by.attributes.y, "縦移動量") * options.height / 100000 }; }
        else return unsupported("移動経路の終了値がありません");
      }
    } else if (type === "animEffect" && node.attributes.filter === "fade" && ["in", "out"].includes(node.attributes.transition)) {
      base.from = { opacity: node.attributes.transition === "in" ? 0 : element.opacity };
      base.to = { opacity: node.attributes.transition === "in" ? element.opacity : 0 };
    } else return unsupported(`動作 ${type} は未対応です`);
    return { node: shifted(result, condition.delay), ...(condition.trigger ? { trigger: condition.trigger } : {}) };
  };
  const parse = async (node: Node): Promise<Parsed | undefined> => {
    try {
      await checkpoint();
      const kind = localName(node.name);
      if (!["seq", "par"].includes(kind)) return await behavior(node);
      const ctn = child(node, "cTn"), mod = modifiers(ctn, node), condition = start(ctn);
      if (mod.easing !== "linear") return unsupported("グループ全体の加減速は未対応です");
      const source = child(ctn, "childTnLst")?.children ?? [];
      const entries: Parsed[] = [];
      for (const item of source) { const parsed = await parse(item); if (parsed) entries.push(parsed); }
      if (!entries.length) return undefined;
      let trigger = condition.trigger;
      const triggered = entries.filter(item => item.trigger);
      if (triggered.length) {
        if (entries.length !== 1 || trigger) return unsupported("グループ内部の独立したクリック開始は未対応です");
        trigger = triggered[0].trigger;
      }
      let group = kind === "par" ? parallel(entries.map(item => item.node)) : entries.length === 1 ? entries[0].node : { type: "sequence" as const, children: entries.map(item => item.node) };
      if (group.type === "parallel" && group.children.some(item => item.type !== "tween" || !item.noOp)) {
        const useful = group.children.filter(item => item.type !== "tween" || !item.noOp);
        const waits = group.children.filter((item): item is RawTween => item.type === "tween" && !!item.noOp).sort((left, right) => animationNodeDuration(right) - animationNodeDuration(left));
        group = parallel([...useful, ...(waits[0] && animationNodeDuration(waits[0]) > useful.reduce((span, item) => Math.max(span, animationNodeDuration(item)), 0) ? [waits[0]] : [])]);
      } else if (group.type === "parallel") group = [...group.children].sort((left, right) => animationNodeDuration(right) - animationNodeDuration(left))[0];
      if (ctn?.attributes.dur && ctn.attributes.dur !== "indefinite") {
        const explicit = duration(ctn.attributes.dur, "グループ所要時間");
        if (group.type === "tween" && group.noOp && explicit >= (group.delayMs ?? 0) + 1) group = { ...group, durationMs: explicit - (group.delayMs ?? 0) };
        else if (explicit > animationNodeDuration(group)) {
          const wait = waiting({ ...node, children: node.children.map(item => item === ctn ? { ...item, attributes: { ...item.attributes, repeatCount: "1000", autoRev: "0" }, children: [] } : item) });
          if (wait) group = parallel([group, wait.node]);
        } else if (explicit < animationNodeDuration(group) - .01) warn(node, "グループ所要時間を読み込めた動きの長さへ変更しました", { code: "animation-approximated", action: "approximation" });
      }
      const expanded = await repeated(group, mod.repeat, mod.yoyo, checkpoint);
      return { node: shifted(expanded, condition.delay), ...(trigger ? { trigger } : {}) };
    } catch (error) { context.signal?.throwIfAborted(); warn(node, `${(error as Error).message}。この動作を省略しました`); return waiting(node); }
  };

  const finalElements = (node: SlideAnimationNode, current: readonly SlideElement[]) => resolveSlideAnimations({ id: "pptx-animation-state", ...(options.layoutId ? { layoutId: options.layoutId } : {}), name: "", background: "#ffffff", notes: "", elements: [...current], animations: [{ id: "state", animation: node }] }).elements;
  const decouple = async (node: RawNode, current: readonly SlideElement[]): Promise<RawNode> => {
    await checkpoint();
    if (node.type !== "parallel") return node;
    const entries = node.children.flatMap((item, owner) => scheduleAnimation(item).map(entry => ({ ...entry, owner, tween: entry.tween as RawTween })));
    // A rejected dimension must not distort a valid center-position curve during conversion.
    let rejectedDimension = false;
    const sizes = new Map(current.map(element => [element.id, { width: element.width, height: element.height }]));
    for (const entry of [...entries].sort((left, right) => left.start - right.start)) for (const key of ["width", "height"] as const) {
      if (entry.tween.to[key] === undefined && entry.tween.from?.[key] === undefined) continue;
      const state = sizes.get(entry.tween.elementId)!, from = entry.tween.from?.[key] ?? state[key];
      const to = entry.tween.relative?.[key] === undefined ? entry.tween.to[key] ?? from : from + entry.tween.relative[key]!;
      if (from > 0 && from <= 100000 && to > 0 && to <= 100000) { state[key] = entry.tween.yoyo ? from : to; continue; }
      const cleaned = { ...entry.tween, from: { ...entry.tween.from }, to: { ...entry.tween.to }, relative: { ...entry.tween.relative } };
      delete cleaned.from[key]; delete cleaned.to[key]; delete cleaned.relative[key];
      if (!Object.keys(cleaned.from).length && !Object.keys(cleaned.to).length) cleaned.noOp = true;
      entry.tween = cleaned; rejectedDimension = true;
      warn(cleaned.source ?? root, "範囲外のサイズを省略し、対応する位置の動きを保持しました", { property: key, elementId: cleaned.elementId });
    }
    if (rejectedDimension) node = parallel(entries.map(entry => ({ ...entry.tween, delayMs: entry.start })));
    const affected = new Map<string, Set<"x" | "y">>();
    for (const entry of entries) for (const other of entries) if (entry.owner !== other.owner && entry.tween.elementId === other.tween.elementId && entry.start < other.end && other.start < entry.end) {
      for (const [axis, size, marker] of [["x", "width", "centerX"], ["y", "height", "centerY"]] as const) {
        if (!entry.tween[marker] || other.tween.to[size] === undefined && other.tween.from?.[size] === undefined) continue;
        const axes = affected.get(entry.tween.elementId) ?? new Set<"x" | "y">(); axes.add(axis); affected.set(entry.tween.elementId, axes);
      }
    }
    if (!affected.size) return node;
    const replacements: RawNode[] = [];
    const span = animationNodeDuration(node);
    for (const [elementId, axes] of affected) for (const axis of axes) {
      const element = current.find(item => item.id === elementId)!, size = axis === "x" ? "width" : "height";
      const plans = (key: "x" | "y" | "width" | "height", initial: number): SlideAnimationPlanTween[] => {
        let value = initial;
        return entries.filter(entry => entry.tween.elementId === elementId && (entry.tween.to[key] !== undefined || entry.tween.from?.[key] !== undefined))
          .sort((left, right) => left.start - right.start).map(entry => {
            const from = Number(entry.tween.from?.[key] ?? value), to = entry.tween.relative?.[key] !== undefined ? from + Number(entry.tween.relative[key]) : Number(entry.tween.to[key] ?? from);
            value = entry.tween.yoyo ? from : to;
            // Rotation's wider numeric range avoids clamping a valid center just outside the canvas bounds.
            return { ...entry, tween: { ...entry.tween, from: { rotation: from }, to: { rotation: to } }, from: { rotation: from }, to: { rotation: to }, initialElement: element };
          });
      };
      const centerBase = element[axis] + element[size] / 2, centers = plans(axis, centerBase), sizes = plans(size, element[size]);
      const sample = (items: SlideAnimationPlanTween[], at: number, initial: number): number => {
        let value = initial;
        for (const entry of items) { if (entry.start > at) break; value = Number(sampleSlideAnimationTween(entry, at).rotation); }
        return value;
      };
      const coordinate = (at: number) => sample(centers, at, centerBase) - sample(sizes, at, element[size]) / 2;
      const times = new Set([0, span]);
      for (const entry of [...centers, ...sizes]) {
        times.add(entry.start); times.add(entry.end);
        const count = (entry.tween.repeat ?? 1) * (entry.tween.yoyo ? 2 : 1);
        for (let cycle = 0; cycle < count; cycle++) {
          await checkpoint();
          const samples = entry.tween.easing && entry.tween.easing !== "linear" ? 16 : 1;
          for (let index = 0; index <= samples; index++) times.add(entry.start + (cycle + index / samples) * entry.tween.durationMs);
        }
      }
      let ordered = [...times].sort((a, b) => a - b).filter((time, index, all) => !index || time > all[index - 1]);
      if (ordered.at(-1) !== span) ordered[ordered.length - 1] = span;
      const critical = new Set(ordered.filter(time => time === 0 || time === span || Math.abs(coordinate(time) - coordinate(time - 0.0000001)) > .0001));
      const simplified: number[] = [];
      for (const at of ordered) {
        while (simplified.length > 1) {
          const left = simplified[simplified.length - 2], middle = simplified[simplified.length - 1];
          const expected = coordinate(left) + (coordinate(at === span ? at : at - 0.0000001) - coordinate(left)) * (middle - left) / (at - left);
          if (critical.has(middle) || Math.abs(coordinate(middle) - expected) > .00001) break;
          simplified.pop();
        }
        simplified.push(at);
      }
      ordered = simplified;
      for (let index = 0; index < ordered.length - 1; index++) {
        await checkpoint();
        const begin = ordered[index], end = ordered[index + 1];
        if (!(end > begin)) continue;
        replacements.push({ source: entries.find(entry => entry.tween.elementId === elementId)?.tween.source, type: "tween", elementId, durationMs: end - begin, ...(begin ? { delayMs: begin } : {}),
          from: { [axis]: coordinate(begin) }, to: { [axis]: coordinate(end === span ? end : end - 0.0000001) } });
      }
    }
    const retained = entries.flatMap(entry => {
      const axes = affected.get(entry.tween.elementId), from = { ...entry.tween.from }, to = { ...entry.tween.to }, relative = { ...entry.tween.relative };
      for (const axis of axes ?? []) { delete from[axis]; delete to[axis]; delete relative[axis]; }
      if (!Object.keys(to).length && !Object.keys(from).length && !entry.tween.noOp) return [];
      return [{ ...entry.tween, ...(axes?.has("x") ? { centerX: undefined } : {}), ...(axes?.has("y") ? { centerY: undefined } : {}),
        from: Object.keys(from).length ? from : undefined, to: Object.keys(to).length ? to : from,
        relative: Object.keys(relative).length ? relative : undefined, delayMs: entry.start }];
    });
    warn(root, "中心位置とサイズの異なる時間設定を、左上座標の有限キーフレームへ近似しました", { code: "animation-approximated", action: "approximation" });
    return parallel([...retained, ...replacements]);
  };
  const provenance = new WeakMap<SlideAnimationNode, Node>();
  const neutralNodes = new WeakSet<SlideAnimationNode>();
  const visibilityNodes = new WeakSet<SlideAnimationNode>();
  const allWrites = new Map<string, Set<Key>>(), waitClaims = new Map<string, string>();
  const tag = <T extends SlideAnimationNode>(value: T, source?: Node): T => { if (source) provenance.set(value, source); return value; };
  const neutralWait = (span: number, current: readonly SlideElement[], writes: Map<string, Set<Key>>, source?: Node): Tween | undefined => {
    if (!(span > 0) || !Number.isFinite(span)) return undefined;
    for (const element of current) for (const key of ["opacity", "rotation", "x", "y", "width", "height", "fill", "stroke", "fontSize"] as const) {
      const claim = `${element.id}:${key}`, owner = waitClaims.get(claim), lane = activeTimelineId ?? "main";
      if (writes.get(element.id)?.has(key) || allWrites.get(element.id)?.has(key) || owner !== undefined && owner !== lane || !Reflect.has(element, key)) continue;
      waitClaims.set(claim, lane);
      const value = Reflect.get(element, key) as number | string;
      const wait = tag({ type: "tween" as const, elementId: element.id, durationMs: span, from: { [key]: value }, to: { [key]: value } }, source);
      neutralNodes.add(wait);
      return wait;
    }
    return undefined;
  };
  const materialize = async (node: RawNode, current: readonly SlideElement[], writes = new Map<string, Set<Key>>()): Promise<SlideAnimationNode> => {
    await checkpoint();
    node = await decouple(node, current);
    if (!writes.size) for (const { tween } of scheduleAnimation(node)) if (!(tween as RawTween).noOp) {
      const keys = writes.get(tween.elementId) ?? new Set<Key>();
      for (const key of Object.keys({ ...tween.from, ...tween.to }) as Key[]) keys.add(key);
      writes.set(tween.elementId, keys);
    }
    if (node.type !== "tween") {
      let state = current;
      let omittedDuration = 0;
      const nodes: SlideAnimationNode[] = [];
      for (const item of node.children) {
        try {
          let converted = await materialize(item, state, writes);
          if (node.type === "sequence" && omittedDuration) {
            converted = shifted(converted, omittedDuration);
            omittedDuration = 0;
          }
          if (node.type === "sequence") state = finalElements(converted, state);
          nodes.push(converted);
        } catch (error) {
          context.signal?.throwIfAborted();
          warn(item.type === "tween" ? item.source ?? root : root, `${(error as Error).message}。この動作を省略しました`);
          omittedDuration = node.type === "sequence" ? omittedDuration + animationNodeDuration(item) : Math.max(omittedDuration, animationNodeDuration(item));
        }
      }
      if (omittedDuration) {
        const wait = neutralWait(omittedDuration, state, writes);
        if (wait) nodes.push(wait);
      }
      if (!nodes.length) return unsupported("読み込める動作がありません");
      const group: SlideAnimationNode = nodes.length === 1 ? nodes[0] : { type: node.type, children: nodes };
      const intervals = new Map<string, { start: number; end: number }[]>(), retained: Tween[] = [];
      let conflicts = false;
      for (const scheduled of scheduleAnimation(group)) {
        await checkpoint();
        const from = { ...scheduled.tween.from }, to = { ...scheduled.tween.to };
        for (const key of Object.keys({ ...from, ...to }) as Key[]) {
          const target = `${scheduled.tween.elementId}:${key}`, prior = intervals.get(target) ?? [];
          if (prior.some(interval => scheduled.start < interval.end && interval.start < scheduled.end)) {
            delete from[key]; delete to[key]; conflicts = true;
            if (!neutralNodes.has(scheduled.tween)) warn(provenance.get(scheduled.tween) ?? root, "同じ要素を同時に変更するプロパティを省略しました", { code: "animation-conflict", elementId: scheduled.tween.elementId, property: key });
          } else intervals.set(target, [...prior, scheduled]);
        }
        if (Object.keys(from).length || Object.keys(to).length) {
          const copied = tag({ ...scheduled.tween, delayMs: scheduled.start, from: Object.keys(from).length ? from : undefined, to: Object.keys(to).length ? to : from }, provenance.get(scheduled.tween));
          if (visibilityNodes.has(scheduled.tween)) visibilityNodes.add(copied);
          if (neutralNodes.has(scheduled.tween)) neutralNodes.add(copied);
          retained.push(copied);
        }
      }
      if (!conflicts) return group;
      if (!retained.length || retained.reduce((span, item) => Math.max(span, animationNodeDuration(item)), 0) < animationNodeDuration(group)) {
        const wait = neutralWait(animationNodeDuration(group), current, writes);
        if (wait) retained.push(wait);
      }
      if (!retained.length) return unsupported("競合しない動作がありません");
      return retained.length === 1 ? retained[0] : { type: "parallel", children: retained };
    }
    const { source, visibility, centerX, centerY, scale, noOp, relative, ...result } = node;
    const element = current.find(item => item.id === node.elementId)!;
    if (noOp) {
      return neutralWait(animationNodeDuration(node), current, writes, source) ?? unsupported("他の動きと競合せずに待機状態を保持できません");
    }
    const from = { ...node.from }, to = { ...node.to };
    if (scale && centerX) from.x = to.x = element.x + element.width / 2;
    if (scale && centerY) from.y = to.y = element.y + element.height / 2;
    if (relative) for (const key of Object.keys(relative) as Key[]) Reflect.set(to, key, Number(from[key] ?? Reflect.get(element, key)) + Number(relative[key]));
    for (const key of ["width", "height"] as const) {
      if (from[key] === undefined && to[key] === undefined) continue;
      const begin = from[key] ?? element[key], end = to[key] ?? begin;
      if (begin > 0 && begin <= 100000 && end > 0 && end <= 100000) continue;
      delete from[key]; delete to[key];
      warn(source ?? root, "範囲外のサイズを省略し、対応する位置の動きを保持しました", { property: key, elementId: node.elementId });
    }
    if (centerX) { if (from.x !== undefined) from.x -= (from.width ?? element.width) / 2; if (to.x !== undefined) to.x -= (to.width ?? from.width ?? element.width) / 2; }
    if (centerY) { if (from.y !== undefined) from.y -= (from.height ?? element.height) / 2; if (to.y !== undefined) to.y -= (to.height ?? from.height ?? element.height) / 2; }
    const validFrom: Properties = {}, validTo: Properties = {};
    for (const key of Object.keys({ ...from, ...to }) as Key[]) {
      try {
        normalizeSlideAnimations([{ id: "validate-property", animation: { ...result, from: from[key] !== undefined ? { [key]: from[key] } : undefined, to: { [key]: to[key] ?? from[key] } } }], [element]);
        if (from[key] !== undefined) Reflect.set(validFrom, key, from[key]);
        if (to[key] !== undefined) Reflect.set(validTo, key, to[key]);
      } catch (error) { warn(source ?? root, `${(error as Error).message}。このプロパティを省略しました`, { property: key, elementId: node.elementId }); }
    }
    if (!Object.keys(validTo).length && !Object.keys(validFrom).length)
      return neutralWait(animationNodeDuration(node), current, writes, source) ?? unsupported("有効なプロパティも安全な待機状態もありません");
    const converted = tag({ ...result, from: Object.keys(validFrom).length ? validFrom : undefined, to: Object.keys(validTo).length ? validTo : validFrom }, source);
    if (visibility) visibilityNodes.add(converted);
    return converted;
  };
  const top = child(root, "tnLst")?.children ?? [];
  if (!top.length) { warn(root, "タイミングに動作がないため省略しました"); return; }
  // A root-level zero-time set is standard slide-initialization timing, not private metadata.
  applyingInitialValues = true;
  for (const container of top.filter(node => timing(node)?.attributes.nodeType === "tmRoot")) {
    for (const node of child(timing(container), "childTnLst")?.children ?? []) {
      if (localName(node.name) !== "set") continue;
      const parsed = await parse(node);
      if (!parsed || parsed.trigger || parsed.node.type !== "tween" || (parsed.node.delayMs ?? 0) !== 0 || parsed.node.durationMs !== 1 || (parsed.node.repeat ?? 1) !== 1 || parsed.node.yoyo) {
        warn(node, "スライド開始時以外の独立した設定動作を省略しました"); continue;
      }
      try {
        const raw = await materialize(parsed.node, [...targets.values()]) as Tween;
        const entry = [...targets].find(([, element]) => element.id === raw.elementId)!;
        const updated = normalizeSlideElement({ ...entry[1], ...raw.to });
        targets.set(entry[0], updated); options.applyInitialValues?.(updated);
        if (textContent(child(child(child(node, "cBhvr"), "attrNameLst"), "attrName")) === "style.opacity") baselineOpacity.set(updated.id, updated.opacity);
      } catch (error) { context.signal?.throwIfAborted(); warn(node, `${(error as Error).message}。初期設定を省略しました`); }
    }
  }
  applyingInitialValues = false;
  const initialElements = [...targets.values()];
  const sequences: Node[] = [];
  const findSequence = (node: Node) => {
    const ctn = timing(node), type = ctn?.attributes.nodeType;
    if (type === "mainSeq" || type === "interactiveSeq") { sequences.push(node); return; }
    for (const item of child(ctn, "childTnLst")?.children ?? []) findSequence(item);
  };
  top.forEach(findSequence);
  const lanes: { id?: string; entries: { candidate: Node; node: RawNode; id: string; trigger?: SlideAnimationTrigger }[] }[] = [];
  for (const [index, sequence] of (sequences.length ? sequences : [undefined]).entries()) {
    await checkpoint();
    const id = sequences.length > 1 ? `pptx-timeline-${timing(sequence!)?.attributes.id ?? index + 1}` : undefined;
    activeTimelineId = id;
    let condition: ReturnType<typeof start> = { delay: 0 };
    if (sequence) try { condition = start(timing(sequence)); }
    catch (error) { warn(sequence, `${(error as Error).message}。この系列を省略しました`); continue; }
    const candidates = sequence ? child(timing(sequence), "childTnLst")?.children ?? [] : top;
    const entries: typeof lanes[number]["entries"] = [];
    for (const [index, candidate] of candidates.entries()) {
      activeAnimationId = sequences.length > 1 ? `pptx-animation-${pageNumber}-${id}-${index + 1}` : `pptx-animation-${pageNumber}-${index + 1}`;
      const parsed = await parse(candidate);
      if (!parsed) continue;
      if (index === 0 && condition.trigger && parsed.trigger) {
        warn(candidate, "系列とステップの複数開始条件を系列の開始条件へ近似しました", { code: "animation-approximated", action: "approximation" });
      }
      const node = index === 0 ? shifted(parsed.node, condition.delay) : parsed.node;
      for (const { tween } of scheduleAnimation(node)) if (!(tween as RawTween).noOp) {
        const keys = allWrites.get(tween.elementId) ?? new Set<Key>();
        for (const key of Object.keys({ ...tween.from, ...tween.to }) as Key[]) keys.add(key);
        allWrites.set(tween.elementId, keys);
      }
      entries.push({ candidate, node, id: activeAnimationId, trigger: index === 0 ? condition.trigger ?? parsed.trigger : parsed.trigger });
    }
    lanes.push({ id, entries });
  }

  const steps: SlideAnimationStep[] = [];
  const ownership = new Map<string, string>();
  for (const lane of lanes) {
    activeTimelineId = lane.id;
    let current = initialElements;
    for (const entry of lane.entries) {
      context.signal?.throwIfAborted();
      activeAnimationId = entry.id;
      try {
        const materialized = await materialize(entry.node, current), span = animationNodeDuration(materialized);
        const kept: Tween[] = [], intervals = new Map<string, { start: number; end: number }[]>();
        for (const scheduled of scheduleAnimation(materialized)) {
          await checkpoint();
          const source = provenance.get(scheduled.tween) ?? entry.candidate;
          const from: Properties = {}, to: Properties = {};
          for (const key of Object.keys({ ...scheduled.tween.from, ...scheduled.tween.to }) as Key[]) {
            const target = `${scheduled.tween.elementId}:${key}`, owner = ownership.get(target), prior = intervals.get(target) ?? [];
            if (owner !== undefined && owner !== (lane.id ?? "main") || prior.some(interval => scheduled.start < interval.end && interval.start < scheduled.end)) {
              warn(source, "同じ要素を変更する他の動きと競合するプロパティを省略しました", { code: "animation-conflict", property: key, elementId: scheduled.tween.elementId });
              continue;
            }
            if (scheduled.tween.from?.[key] !== undefined) Reflect.set(from, key, scheduled.tween.from[key]);
            if (scheduled.tween.to[key] !== undefined) Reflect.set(to, key, scheduled.tween.to[key]);
            intervals.set(target, [...prior, { start: scheduled.start, end: scheduled.end }]);
          }
          if (!Object.keys(from).length && !Object.keys(to).length) continue;
          // Flattening reduces structural overhead and retains original offsets after selective omissions.
          kept.push({ ...scheduled.tween, delayMs: scheduled.start, from: Object.keys(from).length ? from : undefined, to: Object.keys(to).length ? to : from });
        }
        if (!kept.length || kept.reduce((span, item) => Math.max(span, animationNodeDuration(item)), 0) < span) {
          const wait = neutralWait(span, current, allWrites, entry.candidate);
          if (wait) kept.push(wait);
          else warn(entry.candidate, "省略した動作の待機時間を安全に保持できませんでした", { code: "unsupported-animation" });
        }
        if (!kept.length) continue;
        const animation: SlideAnimationNode = kept.length === 1 ? kept[0] : { type: "parallel", children: kept };
        const step: SlideAnimationStep = { id: entry.id, ...(lane.id ? { timelineId: lane.id } : {}), ...(entry.trigger ? { trigger: entry.trigger } : {}), animation };
        const normalized = normalizeSlideAnimations([step], initialElements)!;
        const accepted = normalized.at(-1)!;
        for (const { tween } of scheduleAnimation(accepted.animation)) for (const key of Object.keys({ ...tween.from, ...tween.to })) ownership.set(`${tween.elementId}:${key}`, lane.id ?? "main");
        current = finalElements(accepted.animation, current);
        steps.push(accepted);
      } catch (error) { context.signal?.throwIfAborted(); warn(entry.candidate, `${(error as Error).message}。このステップを省略しました`); }
    }
  }
  return steps.length ? normalizeSlideAnimations(steps, initialElements) : undefined;
}
