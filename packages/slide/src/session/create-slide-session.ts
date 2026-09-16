import type { SlideCommand, SlideCommandResult, SlideDeck } from "../model/types";
import { applySlideCommands } from "../model/commands";
import { createSlideDeck, normalizeSlideDeck } from "../model/normalize";
import { sameSlideDeck } from "../model/query";
import { SLIDE_LIMITS } from "../model/limits";
import { boolean, record } from "../model/validation";

export type SlideSessionSnapshot = Readonly<{ deck: SlideDeck; dirty: boolean; canUndo: boolean; canRedo: boolean }>;
export type SlideSession = Readonly<{
  getSnapshot(): SlideSessionSnapshot;
  subscribe(listener: () => void): () => void;
  execute(commands: SlideCommand | readonly SlideCommand[]): SlideCommandResult;
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
  const past: SlideDeck[] = [], future: SlideDeck[] = [];
  const listeners = new Set<() => void>();
  let snapshot: SlideSessionSnapshot = Object.freeze({ deck, dirty: false, canUndo: false, canRedo: false });
  const publish = () => {
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
  return Object.freeze({
    getSnapshot: () => snapshot,
    subscribe(listener: () => void) {
      if (typeof listener !== "function") throw new Error("通知先を関数で指定してください");
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    execute(commands: SlideCommand | readonly SlideCommand[]) {
      const result = applySlideCommands(deck, commands);
      if (result.changed) { remember(); deck = result.deck; publish(); }
      return result;
    },
    replace(nextDeck: SlideDeck, options: Readonly<{ saved?: boolean }> = {}) {
      const raw = record(options, "置き換えの設定", ["saved"]);
      const saved = raw.saved === undefined ? false : boolean(raw.saved, "保存済み");
      const next = normalizeSlideDeck(nextDeck);
      if (saved) { deck = next; baseline = next; past.length = 0; future.length = 0; }
      else if (!sameSlideDeck(deck, next)) { remember(); deck = next; }
      publish();
    },
    undo() {
      const previous = past.pop();
      if (!previous) return false;
      future.push(deck);
      deck = previous;
      publish();
      return true;
    },
    redo() {
      const next = future.pop();
      if (!next) return false;
      past.push(deck);
      deck = next;
      publish();
      return true;
    },
    markSaved(nextDeck?: SlideDeck) {
      if (nextDeck !== undefined) deck = normalizeSlideDeck(nextDeck);
      baseline = deck;
      publish();
    },
    discard() {
      deck = baseline;
      past.length = 0;
      future.length = 0;
      publish();
    },
  });
}
