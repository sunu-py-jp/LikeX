import { isDeepStrictEqual } from "node:util";
import { AIError } from "./provider.ts";
import { AIToolError } from "./tool-errors.ts";
import { canonicalSlideDeck } from "./slide-snapshot.ts";

type NativePage = { id: string; [key: string]: unknown };
type NativeDeck = { slides: NativePage[]; [key: string]: unknown };
const pageCommands = new Set(["slide.update", "slide.replaceContent", "slide.applyLayout", "slide.detachLayout", "element.add", "line.add", "line.update", "element.update", "element.delete", "element.duplicate", "element.order", "animation.set", "animation.remove"]);
const structureCommands = new Set(["slide.delete", "slide.duplicate", "slide.move"]);
const fail = () => { throw new AIToolError("Slide AI の1回の書き込みは1ページまでです。ページごとに apply を分けて順番に実行してください。", { code: "slide_page_limit" }); };

/** This is a host restriction, independent of prompts and the public model's batch capabilities. */
export function checkSlideWrite(source: string, operation: string, values: unknown): NativeDeck {
  const before = JSON.parse(source) as NativeDeck;
  if (!Array.isArray(before.slides)) throw new AIError("Slide ファイルの構造が不正です。");
  const commands = (values ?? []) as Record<string, unknown>[];
  if (!Array.isArray(commands) || commands.some(command => !command || typeof command !== "object" || Array.isArray(command))) fail();
  if (operation === "create") {
    if (before.slides.length > 1 || commands.some(command => command.type !== "deck.rename" && command.type !== "deck.resize")) {
      throw new AIError("Slide AI の create は既存資料が1ページ以下の場合に空の1ページへ置換する操作です。複数ページはページごとの apply で編集・削除し、新規ページも1ページずつ追加してください。");
    }
    return before;
  }
  const types = commands.map(command => String(command.type));
  if (types.some(type => type === "deck.rename" || type === "deck.resize" || type === "masters.import" || structureCommands.has(type))) {
    if (commands.length !== 1) fail();
    if (types[0] === "deck.resize" && before.slides.length > 1) throw new AIError("複数ページの deck.resize は全ページへ影響するため Slide AI では実行できません。画面のサイズ設定を使ってください。");
    return before;
  }
  const additions = commands.filter(command => command.type === "slide.add");
  if (additions.length > 1) fail();
  const newId = additions.length && additions[0].slide && typeof additions[0].slide === "object"
    ? (additions[0].slide as Record<string, unknown>).id : undefined;
  const targets = new Set<string>();
  for (const command of commands) {
    if (command.type === "slide.add") continue;
    if (!pageCommands.has(String(command.type)) || typeof command.slideId !== "string" || !command.slideId) fail();
    targets.add(command.slideId as string);
  }
  if (targets.size > 1 || additions.length && targets.size && (!newId || !targets.has(newId as string))) fail();
  return before;
}

/** Verify actual output as well as command intent before replacing the staged file. */
export function checkSlideWriteResult(before: NativeDeck, serialized: string, operation: string) {
  const after = JSON.parse(serialized) as NativeDeck;
  if (!Array.isArray(after.slides)) fail();
  if (operation === "create") {
    if (before.slides.length > 1 || after.slides.length !== 1) fail();
    return;
  }
  // The CLI reparses the entire file. A valid noncanonical native array or a
  // connector angle such as 209.99999999999997 can normalize on an untouched
  // page; only changes to canonical page content count toward the page limit.
  const previous = new Map(canonicalSlideDeck(JSON.stringify(before)).slides.map(page => [page.id, page]));
  const current = new Map(canonicalSlideDeck(serialized).slides.map(page => [page.id, page]));
  const changed = new Set([...previous.keys(), ...current.keys()].filter(id => !isDeepStrictEqual(previous.get(id), current.get(id))));
  if (changed.size > 1) fail();
}
