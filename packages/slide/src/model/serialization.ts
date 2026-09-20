import { serializeStableJson } from "../json";
import type { SlideDeck } from "./types";
import { SLIDE_LIMITS } from "./limits";
import { normalizeSlideDeck } from "./normalize";
import { compareSlideFileKeys, restoreSlideFile, toSlideFile } from "./file-format";

/** Reads only native version 1 files with a format marker and explicit element stacking. */
export function parseSlideDeck(json: string): SlideDeck {
  if (typeof json !== "string" || json.length > SLIDE_LIMITS.jsonLength) throw new Error("JSONのサイズが上限を超えています");
  return normalizeSlideDeck(restoreSlideFile(JSON.parse(json)));
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
