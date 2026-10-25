import { SLIDE_LIMITS } from "./limits";
import { choice, list, record } from "./validation";

/** A resource bound on materialized work, independent of playback duration/repeat values. */
export class SlideAnimationExpansionError extends Error {
  constructor(message = "アニメーションの展開後のノード数が安全な処理上限を超えています") { super(message); this.name = "SlideAnimationExpansionError"; }
}
export function assertAnimationExpansion(count: number, repeat = 1, maximum: number = SLIDE_LIMITS.animationExpandedNodes): number {
  if (!Number.isSafeInteger(count) || count < 0 || !Number.isSafeInteger(repeat) || repeat < 1 || count > Math.floor(maximum / repeat))
    throw new SlideAnimationExpansionError();
  return count * repeat;
}

/** Count occurrences before copying shared subtrees; a compact DAG must not expand exponentially. */
export function expandedAnimationNodes(value: unknown, maximum: number = SLIDE_LIMITS.animationExpandedNodes): number {
  type Frame = { source: Record<string, unknown>; children: unknown[]; index: number; count: number };
  const memo = new Map<object, number>(), ancestors = new Set<object>(), stack: Frame[] = [];
  const enter = (input: unknown): number | undefined => {
    const raw = record(input, "アニメーションノード", ["type", "children", "elementId", "durationMs", "delayMs", "easing", "from", "to", "repeat", "yoyo", "source", "visibility", "centerX", "centerY", "scale", "noOp", "relative"]);
    if (ancestors.has(raw)) throw new Error("アニメーションに循環参照は指定できません");
    const existing = memo.get(raw); if (existing !== undefined) return existing;
    assertAnimationExpansion(1, 1, maximum);
    const type = choice(raw.type, ["sequence", "parallel", "tween"], "アニメーションノードの種類");
    if (type === "tween") { memo.set(raw, 1); return 1; }
    if (Array.isArray(raw.children)) assertAnimationExpansion(raw.children.length + 1, 1, maximum);
    const children = list(raw.children, "子アニメーション", maximum, 1);
    assertAnimationExpansion(children.length + 1, 1, maximum);
    ancestors.add(raw); stack.push({ source: raw, children, index: 0, count: 1 });
  };
  const leaf = enter(value); if (leaf !== undefined) return leaf;
  while (stack.length) {
    const frame = stack[stack.length - 1];
    if (frame.index < frame.children.length) {
      const count = enter(frame.children[frame.index]);
      if (count === undefined) continue;
      frame.count = assertAnimationExpansion(frame.count + count, 1, maximum); frame.index++;
    } else {
      memo.set(frame.source, frame.count); ancestors.delete(frame.source); stack.pop();
      if (!stack.length) return frame.count;
    }
  }
  return 0;
}
