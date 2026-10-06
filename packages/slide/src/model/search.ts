import { createKeywordSearchMatcher, type KeywordSearchQuery, type KeywordTextMatch } from "./core-text-search";
import type { SlideDeck, SlideElement } from "./types";
import { normalizeSlideDeck } from "./normalize";
import { resolveSlideAppearance } from "./layouts";
import { boolean, choice, number, record } from "./validation";

export type { KeywordSearchQuery, KeywordTextMatch } from "./core-text-search";

export type SlideSearchOptions = {
  /** AND may span text on the same page (default), or fields on one element. */
  matchBy?: "page" | "element";
  /** Include page notes. Default false. */
  includeNotes?: boolean;
  /** Include page and element names. Deck/catalog names are not searched. Default false. */
  includeNames?: boolean;
  /** Include embedded image alternative text, without OCR or decoding images. Default false. */
  includeImageAlt?: boolean;
  /** Maximum matching fields to return, 1–10,000. Default 1,000. */
  limit?: number;
};

export type SlideSearchMatch = {
  slideId: string;
  /** One-based page number in the input deck. */
  pageNumber: number;
  elementId?: string;
  source: "text" | "notes" | "name" | "alt";
  /** Inherited elements belong to their master/layout and are not editable local elements. */
  owner: "slide" | "master" | "layout";
  ownerId: string;
  text: string;
  /** UTF-16 offsets within text, with an exclusive end. */
  matches: KeywordTextMatch[];
};

export type SlideSearchResult = {
  /** Page order, then name, inherited/local artwork in model order, and notes. */
  matches: SlideSearchMatch[];
  /** True when another matching field exists beyond limit. */
  truncated: boolean;
};

type Fragment = Omit<SlideSearchMatch, "matches"> & { unit: string };

function searchOptions(options: SlideSearchOptions) {
  const raw = record(options, "スライド検索オプション", ["matchBy", "includeNotes", "includeNames", "includeImageAlt", "limit"]);
  return {
    matchBy: raw.matchBy === undefined ? "page" : choice(raw.matchBy, ["page", "element"], "検索の一致単位"),
    includeNotes: raw.includeNotes === undefined ? false : boolean(raw.includeNotes, "ノートの検索"),
    includeNames: raw.includeNames === undefined ? false : boolean(raw.includeNames, "名前の検索"),
    includeImageAlt: raw.includeImageAlt === undefined ? false : boolean(raw.includeImageAlt, "代替テキストの検索"),
    limit: raw.limit === undefined ? 1_000 : number(raw.limit, "検索結果の上限", 1, 10_000, true),
  };
}

/**
 * Search literal keywords without React, DOM, image decoding or network access.
 * Page matching never joins element strings: a keyword must occur inside one field,
 * while separate AND keywords may occur in different fields on that page.
 */
export function searchSlides(input: SlideDeck, query: KeywordSearchQuery, options: SlideSearchOptions = {}): SlideSearchResult {
  const settings = searchOptions(options), matcher = createKeywordSearchMatcher(query);
  const deck = normalizeSlideDeck(input), matches: SlideSearchMatch[] = [];
  let occurrenceCount = 0;
  const owners = new Map<string, Pick<SlideSearchMatch, "owner" | "ownerId">>();
  for (const master of deck.masters ?? []) for (const element of master.elements)
    owners.set(element.id, { owner: "master", ownerId: master.id });
  for (const layout of deck.layouts ?? []) for (const element of layout.elements)
    owners.set(element.id, { owner: "layout", ownerId: layout.id });

  for (const [index, slide] of deck.slides.entries()) {
    const page = { slideId: slide.id, pageNumber: index + 1 };
    const local = { owner: "slide" as const, ownerId: slide.id };
    const fragments: Fragment[] = [];
    if (settings.includeNames && slide.name) fragments.push({ ...page, ...local, source: "name", text: slide.name, unit: "page-name" });
    const appearance = resolveSlideAppearance(deck, slide), seen = new Set<string>();
    const append = (element: SlideElement, owner: Pick<SlideSearchMatch, "owner" | "ownerId">) => {
      if (seen.has(element.id)) return;
      seen.add(element.id);
      const base = { ...page, ...owner, elementId: element.id, unit: `element:${element.id}` };
      if (element.type !== "image" && element.text) fragments.push({ ...base, source: "text", text: element.text });
      if (settings.includeNames && element.name) fragments.push({ ...base, source: "name", text: element.name });
      if (settings.includeImageAlt && element.type === "image" && element.alt) fragments.push({ ...base, source: "alt", text: element.alt });
    };
    for (const element of appearance.inheritedElements) append(element, owners.get(element.id)!);
    for (const element of appearance.localElements) append(element, local);
    if (settings.includeNotes && slide.notes) fragments.push({ ...page, ...local, source: "notes", text: slide.notes, unit: "page-notes" });

    const groups = new Map<string, string[]>();
    for (const fragment of fragments) {
      const unit = settings.matchBy === "page" ? "page" : fragment.unit;
      const fields = groups.get(unit) ?? [];
      fields.push(fragment.text);
      groups.set(unit, fields);
    }
    const matchedGroups = new Set([...groups].filter(([, fields]) => matcher.test(fields)).map(([unit]) => unit));
    for (const { unit, ...fragment } of fragments) {
      if (!matchedGroups.has(settings.matchBy === "page" ? "page" : unit)) continue;
      const occurrences = matcher.find(fragment.text);
      if (!occurrences.length) continue;
      if (matches.length === settings.limit) return { matches, truncated: true };
      occurrenceCount += occurrences.length;
      if (occurrenceCount > 100_000) throw new Error("検索結果の一致箇所が100,000件を超えました。検索条件を絞ってください");
      matches.push({ ...fragment, matches: occurrences.map(match => ({ ...match })) });
    }
  }
  return { matches, truncated: false };
}
