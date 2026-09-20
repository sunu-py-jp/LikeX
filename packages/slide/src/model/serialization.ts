import { serializeStableJson } from "../json";
import type { SlideDeck } from "./types";
import { SLIDE_LIMITS } from "./limits";
import { normalizeSlideDeck } from "./normalize";
import { compareSlideFileKeys, toSlideFile } from "./file-format";

/** Reads native version 2 files and legacy version 1 .slon/.json documents. */
export function parseSlideDeck(json: string): SlideDeck {
  if (typeof json !== "string" || json.length > SLIDE_LIMITS.jsonLength) throw new Error("JSONのサイズが上限を超えています");
  return normalizeSlideDeck(JSON.parse(json));
}

/** Stable, readable JSON: page order, then top-to-bottom/left-to-right elements with explicit stacking. */
export function serializeSlideDeck(deck: SlideDeck): string {
  try {
    return serializeStableJson(toSlideFile(normalizeSlideDeck(deck)), {
      maxLength: SLIDE_LIMITS.jsonLength, space: 2, compareKeys: compareSlideFileKeys,
    });
  } catch (error) {
    if (error instanceof RangeError) throw new Error("JSONのサイズが上限を超えています");
    throw error;
  }
}
