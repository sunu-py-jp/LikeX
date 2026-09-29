import { parseSlideDeck, serializeSlideDeck, type SlideFile } from "@likex/slide/model";

/**
 * Compare and preview public-model meaning, not a caller's JSON representation.
 * The native round trip restores stacking, normalizes colors/angles and fixes
 * object/element storage order without rounding geometry or dropping animations.
 */
export function canonicalSlideDeck(source: string): SlideFile {
  return JSON.parse(serializeSlideDeck(parseSlideDeck(source))) as SlideFile;
}
