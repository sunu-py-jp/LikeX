/** Pure text layout shared by authoring diagnostics and the DOM/PNG renderers. */
export const SLIDE_TEXT_STYLE = Object.freeze({ paddingX: 10, paddingY: 8, lineHeight: 1.2 });
export const SHAPE_TEXT_STYLE = Object.freeze({ paddingX: 12, paddingY: 8, lineHeight: 1.2, fontFamily: 'Arial, "Yu Gothic", sans-serif' });

const graphemes = typeof Intl.Segmenter === "function" ? new Intl.Segmenter(undefined, { granularity: "grapheme" }) : undefined;
const clusters = (text: string): string[] => graphemes ? [...graphemes.segment(text)].map(value => value.segment) : Array.from(text);
/** Preserve explicit lines, break Western words as a unit, and wrap CJK/long words without splitting a grapheme. */
export function wrapSlideText(text: string, maxWidth: number, measure: (text: string) => number): string[] {
  if (!(maxWidth > 0)) return [];
  const result: string[] = [];
  for (const paragraph of text.replace(/\r\n?/g, "\n").split("\n")) {
    const tokens: string[] = []; let word: string[] = [];
    for (const part of clusters(paragraph.replace(/\t/g, "        "))) {
      if (/^[\p{Script=Latin}\p{N}\p{M}_]+$/u.test(part)) word.push(part);
      else { if (word.length) { tokens.push(word.join("")); word = []; } tokens.push(part); }
    }
    if (word.length) tokens.push(word.join(""));
    let line = "", lineWidth = 0;
    const widths = new Map<string, number>();
    const widthOf = (value: string) => { let width = widths.get(value); if (width === undefined) { width = measure(value); widths.set(value, width); } return width; };
    for (const token of tokens) {
      const tokenWidth = widthOf(token);
      if (lineWidth + tokenWidth <= maxWidth) { line += token; lineWidth += tokenWidth; continue; }
      // Keep common Japanese closing punctuation with the preceding character,
      // and do not strand an opening bracket at the end of a line.
      if (line) {
        const parts = clusters(line), last = parts.at(-1)!;
        if ((/^[、。，．！？：；）］｝〕〉》」』】]/u.test(token) || /^[（［｛〔〈《「『【]$/u.test(last)) && parts.length > 1) {
          result.push(parts.slice(0, -1).join("")); line = last; lineWidth = widthOf(last);
          if (lineWidth + tokenWidth <= maxWidth) { line += token; lineWidth += tokenWidth; continue; }
        }
        result.push(line); line = ""; lineWidth = 0;
      }
      if (tokenWidth <= maxWidth) { line = token; lineWidth = tokenWidth; continue; }
      // Grow a bounded prefix before searching, so narrow boxes with a long word
      // do not repeatedly measure the entire unconsumed suffix.
      const parts = clusters(token);
      for (let start = 0; start < parts.length;) {
        const remaining = parts.length - start;
        let low = 1, high = 1;
        while (high < remaining && measure(parts.slice(start, start + high).join("")) <= maxWidth) { low = high; high = Math.min(remaining, high * 2); }
        // An oversized single glyph is retained and clipped by the element.
        while (low < high) { const middle = Math.ceil((low + high) / 2); if (measure(parts.slice(start, start + middle).join("")) <= maxWidth) low = middle; else high = middle - 1; }
        const piece = parts.slice(start, start + low).join(""); start += low;
        if (start < parts.length) result.push(piece); else { line = piece; lineWidth = widthOf(piece); }
      }
    }
    result.push(line);
  }
  return result;
}
