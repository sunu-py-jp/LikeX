import { appendText, boundedText, checked, fail, integerArgument, logical, number, text, type FunctionContext, type FunctionHandler } from "./runtime";
import { wildcardMatcher } from "./matching";

function edge(c: FunctionContext, right: boolean) {
  c.checkArity(1, 2); const value = [...c.text(0)], count = integerArgument(c, 1, 1);
  if (count < 0) return fail("#VALUE!");
  return right ? value.slice(Math.max(0, value.length - count)).join("") : value.slice(0, count).join("");
}
function find(c: FunctionContext, wildcard: boolean) {
  c.checkArity(2, 3);
  const needle = c.text(0), haystack = c.text(1), chars = [...haystack], start = integerArgument(c, 2, 1);
  if (start < 1 || start > Math.max(1, chars.length)) return fail("#VALUE!");
  if (!needle) return start;
  if (!wildcard) {
    const offset = chars.slice(0, start - 1).join("").length;
    const found = haystack.indexOf(needle, offset);
    return found === -1 ? fail("#VALUE!") : [...haystack.slice(0, found)].length + 1;
  }
  const matches = wildcardMatcher(needle, c.tick);
  for (let index = start - 1; index <= chars.length; index++) {
    c.tick(); if (matches(haystack, index, true)) return index + 1;
  }
  return fail("#VALUE!");
}
export const TEXT_FUNCTIONS = {
  LEFT: c => edge(c, false), RIGHT: c => edge(c, true),
  MID: c => {
    c.checkArity(3); const value = [...c.text(0)], start = integerArgument(c, 1), count = integerArgument(c, 2);
    if (start < 1 || count < 0) return fail("#VALUE!");
    return value.slice(start - 1, start - 1 + count).join("");
  },
  TRIM: c => { c.checkArity(1); return c.text(0).replace(/^ +| +$/g, "").replace(/ +/g, " "); },
  UPPER: c => { c.checkArity(1); return boundedText(c.text(0).toUpperCase()); },
  LOWER: c => { c.checkArity(1); return boundedText(c.text(0).toLowerCase()); },
  SUBSTITUTE: c => {
    c.checkArity(3, 4); const value = c.text(0), oldText = c.text(1), replacement = c.text(2);
    const occurrence = c.omitted(3) ? undefined : integerArgument(c, 3);
    if (occurrence !== undefined && occurrence <= 0) return fail("#VALUE!");
    if (!oldText) return value;
    let output = "", offset = 0, count = 0;
    while (offset < value.length) {
      c.tick(); const found = value.indexOf(oldText, offset);
      if (found === -1) break;
      count++; output = appendText(output, value.slice(offset, found));
      output = appendText(output, occurrence === undefined || count === occurrence ? replacement : oldText);
      offset = found + oldText.length;
    }
    return appendText(output, value.slice(offset));
  },
  FIND: c => find(c, false), SEARCH: c => find(c, true),
  TEXTJOIN: c => {
    c.checkArity(3, 254); const delimiter = c.text(0), ignore = logical(c.scalar(1));
    let output = "", count = 0;
    for (let index = 2; index < c.count; index++) for (const value of c.values(index)) {
      c.tick(); if (ignore && (value === null || value === "")) continue;
      const item = value === null ? "" : text(checked(value)); c.tick(Math.ceil(item.length / 64));
      if (count++) output = appendText(output, delimiter);
      output = appendText(output, item);
    }
    return output;
  },
  VALUE: c => {
    c.checkArity(1);
    // Locale-independent numeric text only; currency/group/date strings are intentionally rejected.
    if (c.raw(0) === null) return 0;
    const value = c.text(0).trim();
    return value ? number(value) : fail("#VALUE!");
  },
} satisfies Record<string, FunctionHandler>;
