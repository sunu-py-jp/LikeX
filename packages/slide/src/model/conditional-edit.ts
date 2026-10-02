import { collectConditionalConflicts } from "../json";
import type { ConditionalEditConflict } from "../json";
import { applySlideCommands } from "./commands";
import { normalizeSlideDeck } from "./normalize";
import { list, record } from "./validation";
import { SLIDE_LIMITS } from "./limits";
import type { SlideCommand, SlideCommandResult, SlideDeck } from "./types";

/** Keep this snapshot in the host. It is not a replacement document or an LLM prompt. */
export type SlideConditionalEdit = Readonly<{ before: SlideDeck; commands: readonly SlideCommand[]; scope?: "targets" | "deck" }>;
export type SlideConditionalEditResult =
  | ({ ok: true } & SlideCommandResult)
  | { ok: false; code: "conflict"; conflicts: ConditionalEditConflict[] };
export type SlideMutationToken = Readonly<{ sessionId: string; structureRevision: number }>;
export type SlideMutationSnapshot = Readonly<{ deck: SlideDeck; token: SlideMutationToken }>;
export type { ConditionalEditConflict } from "../json";

/** Capture and validate an atomic batch before sending it to an asynchronous worker. */
export function prepareSlideConditionalEdit(before: SlideDeck, commands: SlideCommand | readonly SlideCommand[], options: Readonly<{ scope?: "targets" | "deck" }> = {}): SlideConditionalEdit {
  record(options, "条件付き編集の設定", ["scope"]);
  if (options.scope !== undefined && options.scope !== "targets" && options.scope !== "deck") throw new Error("比較範囲が正しくありません");
  const source = normalizeSlideDeck(before);
  applySlideCommands(source, commands);
  return Object.freeze({ before: source, commands: Object.freeze(structuredClone(Array.isArray(commands) ? commands : [commands])), ...(options.scope ? { scope: options.scope } : {}) });
}

const geometryKeys = new Set(["x", "y", "width", "height", "rotation", "shape", "line", "layoutPlaceholderId"]);

/**
 * Checks are derived from commands, never supplied by an untrusted caller.
 * Structural/relationship edits compare the full deck conservatively. Simple
 * field patches compare only their target identity, lock and written fields.
 */
export function applySlideConditionalEdit(deck: SlideDeck, input: SlideConditionalEdit): SlideConditionalEditResult {
  const raw = record(input, "条件付き編集", ["before", "commands", "scope"]);
  if (raw.scope !== undefined && raw.scope !== "targets" && raw.scope !== "deck") throw new Error("比較範囲が正しくありません");
  const before = normalizeSlideDeck(raw.before as SlideDeck), current = normalizeSlideDeck(deck);
  const commands = list(raw.commands, "条件付き編集の操作", SLIDE_LIMITS.commands) as SlideCommand[];
  // Validate even a stale batch, before inspecting its operation-specific fields.
  applySlideCommands(before, commands);
  const conflicts: ConditionalEditConflict[] = [];
  const compare = (expected: unknown, actual: unknown, path: string) => {
    if (conflicts.length < 100) conflicts.push(...collectConditionalConflicts(expected, actual, path).slice(0, 100 - conflicts.length));
  };
  compare(before.id, current.id, "id");
  if (raw.scope === "deck") compare(before, current, "deck");
  for (const command of commands) {
    if (command.type === "deck.rename") { compare(before.title, current.title, "title"); continue; }
    if (command.type === "slide.update") {
      const oldSlide = before.slides.find(slide => slide.id === command.slideId), liveSlide = current.slides.find(slide => slide.id === command.slideId);
      if (!oldSlide || !liveSlide) { compare(oldSlide, liveSlide, `slides.${command.slideId}`); continue; }
      for (const key of Object.keys(command.patch)) compare(Reflect.get(oldSlide, key), Reflect.get(liveSlide, key), `slides.${command.slideId}.${key}`);
      if (Object.hasOwn(command.patch, "background")) {
        compare(oldSlide.layoutId, liveSlide.layoutId, `slides.${command.slideId}.layoutId`);
        compare(oldSlide.inheritBackground, liveSlide.inheritBackground, `slides.${command.slideId}.inheritBackground`);
      }
      continue;
    }
    if (command.type === "element.update" && !Object.keys(command.patch).some(key => geometryKeys.has(key))) {
      const oldSlide = before.slides.find(slide => slide.id === command.slideId), liveSlide = current.slides.find(slide => slide.id === command.slideId);
      const oldElement = oldSlide?.elements.find(element => element.id === command.elementId), liveElement = liveSlide?.elements.find(element => element.id === command.elementId);
      const path = `slides.${command.slideId}.elements.${command.elementId}`;
      if (!oldElement || !liveElement) { compare(oldElement, liveElement, path); continue; }
      compare(oldElement.type, liveElement.type, `${path}.type`);
      compare(oldElement.locked, liveElement.locked, `${path}.locked`);
      for (const key of Object.keys(command.patch)) compare(Reflect.get(oldElement, key), Reflect.get(liveElement, key), `${path}.${key}`);
      continue;
    }
    // Includes add/delete/duplicate/reorder, lines, geometry, animations,
    // layouts/masters, resize and page replacement. Their effects cross fields.
    compare(before, current, "deck");
    break;
  }
  if (conflicts.length) return { ok: false, code: "conflict", conflicts };
  return { ok: true, ...applySlideCommands(current, commands) };
}
