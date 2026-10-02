import type { SlideCommand, SlideCommandResult, SlideDeck } from "../model/types";
import { applySlideCommands } from "../model/commands";
import { createSlideDeck, normalizeSlideDeck } from "../model/normalize";
import { sameSlideDeck } from "../model/query";
import { SLIDE_LIMITS } from "../model/limits";
import { boolean, record } from "../model/validation";
import { applySlideConditionalEdit } from "../model/conditional-edit";
import type { SlideConditionalEdit, SlideConditionalEditResult, SlideMutationSnapshot, SlideMutationToken } from "../model/conditional-edit";

export type SlideSessionSnapshot = Readonly<{ deck: SlideDeck; dirty: boolean; canUndo: boolean; canRedo: boolean }>;
export type SlideSession = Readonly<{
  getSnapshot(): SlideSessionSnapshot;
  getMutationSnapshot(): SlideMutationSnapshot;
  subscribe(listener: () => void): () => void;
  execute(commands: SlideCommand | readonly SlideCommand[]): SlideCommandResult;
  executeConditional(edit: SlideConditionalEdit, expected?: SlideMutationToken): SlideConditionalEditResult;
  replace(deck: SlideDeck, options?: Readonly<{ saved?: boolean }>): void;
  undo(): boolean;
  redo(): boolean;
  markSaved(deck?: SlideDeck): void;
  discard(): void;
}>;

/** One local immutable workspace; saving updates its baseline without dropping Undo/Redo. */
export function createSlideSession(initialDeck?: SlideDeck): SlideSession {
  let deck = initialDeck === undefined ? createSlideDeck() : normalizeSlideDeck(initialDeck);
  let baseline = deck;
  const sessionId = crypto.randomUUID();
  let structureRevision = 0;
  const structure = (value: SlideDeck) => JSON.stringify({ id: value.id,
    slides: value.slides.map(slide => ({ id: slide.id, layoutId: slide.layoutId,
      elements: slide.elements.map(element => ({ id: element.id, type: element.type, layoutPlaceholderId: element.layoutPlaceholderId })) })),
    masters: value.masters?.map(master => master.id), layouts: value.layouts?.map(layout => ({ id: layout.id, masterId: layout.masterId })) });
  let previousStructure = structure(deck);
  const past: SlideDeck[] = [], future: SlideDeck[] = [];
  const listeners = new Set<() => void>();
  let snapshot: SlideSessionSnapshot = Object.freeze({ deck, dirty: false, canUndo: false, canRedo: false });
  const publish = () => {
    const currentStructure = structure(deck);
    if (currentStructure !== previousStructure) { structureRevision++; previousStructure = currentStructure; }
    const next = { deck, dirty: !sameSlideDeck(deck, baseline), canUndo: past.length > 0, canRedo: future.length > 0 };
    if (snapshot.deck === next.deck && snapshot.dirty === next.dirty && snapshot.canUndo === next.canUndo && snapshot.canRedo === next.canRedo) return;
    snapshot = Object.freeze(next);
    for (const listener of [...listeners]) { try { listener(); } catch { /* Observers cannot undo a completed local operation. */ } }
  };
  const remember = () => {
    past.push(deck);
    if (past.length > SLIDE_LIMITS.history) past.shift();
    future.length = 0;
  };
  const structuralCommands = new Set(["masters.import", "slide.add", "slide.delete", "slide.duplicate", "slide.move", "slide.applyLayout", "slide.detachLayout", "slide.replaceContent", "element.add", "element.delete", "element.duplicate", "element.order", "line.add"]);
  const markStructuralCommands = (commands: SlideCommand | readonly SlideCommand[]) => {
    if ((Array.isArray(commands) ? commands : [commands]).some(command => structuralCommands.has(command.type))) structureRevision++;
  };
  return Object.freeze({
    getSnapshot: () => snapshot,
    getMutationSnapshot: () => Object.freeze({ deck, token: Object.freeze({ sessionId, structureRevision }) }),
    subscribe(listener: () => void) {
      if (typeof listener !== "function") throw new Error("通知先を関数で指定してください");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    execute(commands: SlideCommand | readonly SlideCommand[]) {
      const result = applySlideCommands(deck, commands);
      markStructuralCommands(commands);
      if (result.changed) { remember(); deck = result.deck; publish(); }
      return result;
    },
    executeConditional(edit: SlideConditionalEdit, expected?: SlideMutationToken) {
      if (expected && (expected.sessionId !== sessionId || expected.structureRevision !== structureRevision))
        return { ok: false as const, code: "conflict" as const, conflicts: [{ path: "token", expected, actual: { sessionId, structureRevision } }] };
      const result = applySlideConditionalEdit(deck, edit);
      if (result.ok) markStructuralCommands(edit.commands);
      if (result.ok && result.changed) { remember(); deck = result.deck; publish(); }
      return result;
    },
    replace(nextDeck: SlideDeck, options: Readonly<{ saved?: boolean }> = {}) {
      const raw = record(options, "置き換えの設定", ["saved"]);
      const saved = raw.saved === undefined ? false : boolean(raw.saved, "保存済み");
      const next = normalizeSlideDeck(nextDeck);
      // Replacing/importing a document invalidates work prepared against the
      // previous document, even if its IDs and coordinates were reused.
      structureRevision++;
      if (saved) { deck = next; baseline = next; past.length = 0; future.length = 0; }
      else if (!sameSlideDeck(deck, next)) { remember(); deck = next; }
      publish();
    },
    undo() {
      const previous = past.pop();
      if (!previous) return false;
      structureRevision++;
      future.push(deck);
      deck = previous;
      publish();
      return true;
    },
    redo() {
      const next = future.pop();
      if (!next) return false;
      structureRevision++;
      past.push(deck);
      deck = next;
      publish();
      return true;
    },
    markSaved(nextDeck?: SlideDeck) {
      if (nextDeck !== undefined) { deck = normalizeSlideDeck(nextDeck); structureRevision++; }
      baseline = deck;
      publish();
    },
    discard() {
      structureRevision++;
      deck = baseline;
      past.length = 0;
      future.length = 0;
      publish();
    },
  });
}
