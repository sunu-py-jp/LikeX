import { RE2JS } from "re2js";

/** Literal by default. Regex uses RE2 syntax, without lookaround or backreferences. */
export type TextSearchQuery = Readonly<{
  text: string;
  matchCase?: boolean;
  wholeText?: boolean;
  useRegex?: boolean;
}>;

/** Stateless operations; replacement text is literal, including $1 and $&. */
export type TextSearchMatcher = Readonly<{
  test(text: string): boolean;
  replace(text: string, replacement: string): string;
}>;

const MAX_REGEX_PROGRAM_SIZE = 20_000;

type RegexCostFrame = { prefix: number; atom: number; hasAtom: boolean; repeated: boolean; alternatives: number; branches: number; capture: number };
/** Bound repeat expansion before invoking the engine compiler. This is a cost
 * scanner, not a second syntax validator: RE2JS still diagnoses invalid syntax.
 * Alternatives/independent repetitions add costs; only the repeated atom or
 * group is multiplied. Saturation avoids allocating an AST or expanded strings. */
function assertRegexExpansionBudget(source: string): void {
  const cap = (value: number) => Math.min(MAX_REGEX_PROGRAM_SIZE + 1, value);
  const frame = (capture = 0): RegexCostFrame => ({ prefix: 0, atom: 0, hasAtom: false, repeated: false, alternatives: 0, branches: 0, capture });
  const stack = [frame()];
  const cost = (item: RegexCostFrame) => cap(item.alternatives + Math.max(1, item.prefix + item.atom) + item.branches + item.capture);
  const append = (value: number) => {
    const item = stack[stack.length - 1];
    item.prefix = cap(item.prefix + item.atom); item.atom = value; item.hasAtom = true; item.repeated = false;
  };
  const repeat = (minimum: number, maximum: number | null) => {
    const item = stack[stack.length - 1];
    // Invalid repeat counts or repeated operators are rejected by RE2JS itself.
    if (!item.hasAtom || item.repeated || minimum > 1000 || maximum !== null && (maximum > 1000 || maximum < minimum)) return;
    item.atom = cap(maximum === null ? minimum === 0 ? item.atom + 2 : minimum * item.atom + 1
      : maximum * item.atom + maximum - minimum);
    item.repeated = true;
  };
  for (let index = 0; index < source.length;) {
    const character = source[index];
    if (character === "\\") {
      const escaped = source[index + 1];
      index += 2;
      if (escaped === "Q") {
        // Even an empty quoted segment separates repetition operators in RE2.
        stack[stack.length - 1].repeated = false;
        while (index < source.length && source.slice(index, index + 2) !== "\\E") {
          append(1); index += source.codePointAt(index)! > 0xffff ? 2 : 1;
        }
        if (index < source.length) index += 2;
        continue;
      }
      if (["p", "P", "x"].includes(escaped ?? "") && source[index] === "{") {
        const close = source.indexOf("}", index + 1); index = close < 0 ? source.length : close + 1;
      } else if (escaped === "x") index = Math.min(source.length, index + 2);
      else if (escaped === "u") index = Math.min(source.length, index + 4);
      append(1); continue;
    }
    if (character === "[") {
      index++;
      if (source[index] === "^") index++;
      if (source[index] === "]") index++;
      while (index < source.length) {
        if (source[index] === "\\") { index += 2; continue; }
        // POSIX classes have an inner closing bracket, e.g. [[:alpha:]].
        if (source.slice(index, index + 2) === "[:") {
          const close = source.indexOf(":]", index + 2);
          if (close >= 0) { index = close + 2; continue; }
        }
        if (source[index++] === "]") break;
      }
      append(1); continue;
    }
    if (character === "(") {
      const flags = /^\(\?[imsU-]+([:)])/.exec(source.slice(index));
      if (flags?.[1] === ")") {
        // Flag-only groups produce no atom but allow another repeat on the
        // previous expression (e.g. a*(?i){1000}). Include that nested cost.
        stack[stack.length - 1].repeated = false;
        index += flags[0].length; continue;
      }
      let capture = 2;
      if (flags) { capture = 0; index += flags[0].length; }
      else if (source.slice(index, index + 3) === "(?:") { capture = 0; index += 3; }
      else if (source.slice(index, index + 4) === "(?P<" || source.slice(index, index + 3) === "(?<" && !["=", "!"].includes(source[index + 3])) {
        const close = source.indexOf(">", index + 3); index = close < 0 ? index + 1 : close + 1;
      } else index++;
      stack.push(frame(capture)); continue;
    }
    if (character === ")" && stack.length > 1) { const closed = stack.pop()!; append(cost(closed)); index++; continue; }
    if (character === "|") {
      const item = stack[stack.length - 1];
      item.alternatives = cap(item.alternatives + Math.max(1, item.prefix + item.atom)); item.branches++;
      item.prefix = 0; item.atom = 0; item.hasAtom = false; item.repeated = false; index++; continue;
    }
    if (character === "*" || character === "+" || character === "?") {
      repeat(character === "+" ? 1 : 0, character === "?" ? 1 : null); index++;
      if (source[index] === "?") index++; // Reluctant repeat: same expansion cost.
      continue;
    }
    if (character === "{") {
      // RE2 treats counts with leading zeroes as literal text, including {00}.
      const count = /^\{(0|[1-9]\d*)(?:,((?:0|[1-9]\d*)?))?\}/.exec(source.slice(index));
      if (count) {
        repeat(Number(count[1]), count[2] === undefined ? Number(count[1]) : count[2] === "" ? null : Number(count[2]));
        index += count[0].length; if (source[index] === "?") index++; continue;
      }
    }
    append(1); index += source.codePointAt(index)! > 0xffff ? 2 : 1;
  }
  // Unclosed groups are syntax errors; the engine rejects them before compiling.
  if (stack.length === 1 && cost(stack[0]) + 2 > MAX_REGEX_PROGRAM_SIZE)
    throw new Error("パターンの繰り返し展開が大きすぎます（上限20,000命令相当）");
}

/** Compile once for a collection. Does not retain matches or a mutable lastIndex. */
export function createTextSearchMatcher(query: TextSearchQuery): TextSearchMatcher {
  if (!query || typeof query.text !== "string" || query.text.length > 100_000)
    throw new Error("検索する文字列は100,000文字以内で指定してください");
  for (const key of ["matchCase", "wholeText", "useRegex"] as const) {
    if (query[key] !== undefined && typeof query[key] !== "boolean")
      throw new Error("検索の設定が正しくありません");
  }
  const { text: source, matchCase = false, wholeText = false, useRegex = false } = query;
  let test: (text: string) => boolean;
  let replace: (text: string, replacement: string) => string;
  if (!source) {
    test = () => false;
    replace = text => text;
  } else if (useRegex) {
    if (source.length > 4096) throw new Error("正規表現は4,096文字以内で指定してください");
    let pattern: RE2JS;
    try {
      assertRegexExpansionBudget(source);
      pattern = RE2JS.compile(source, matchCase ? 0 : RE2JS.CASE_INSENSITIVE);
      if (pattern.programSize() > MAX_REGEX_PROGRAM_SIZE) throw new Error("パターンが複雑すぎます");
    } catch (error) {
      const reason = error instanceof Error ? error.message : "構文が正しくありません";
      throw new Error(`正規表現が正しくないか、対応していない構文です（RE2形式）。${reason}`);
    }
    test = wholeText ? text => pattern.testExact(text) : text => pattern.test(text);
    replace = wholeText
      ? (text, replacement) => test(text) ? replacement : text
      : (text, replacement) => pattern.matcher(text).replaceAll(() => replacement);
  } else {
    // Escaped literal matching preserves the existing Unicode case-folding behavior.
    const escaped = source.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const pattern = new RegExp(wholeText ? `^(?:${escaped})$` : escaped, matchCase ? "gu" : "giu");
    test = text => {
      pattern.lastIndex = 0;
      const match = pattern.exec(text);
      return match !== null && (!wholeText || match[0].length === text.length);
    };
    replace = wholeText
      ? (text, replacement) => test(text) ? replacement : text
      : (text, replacement) => { pattern.lastIndex = 0; return text.replace(pattern, () => replacement); };
  }
  return Object.freeze({
    test(text: string) {
      if (typeof text !== "string") throw new Error("検索対象は文字列で指定してください");
      return test(text);
    },
    replace(text: string, replacement: string) {
      if (typeof text !== "string" || typeof replacement !== "string" || replacement.length > 100_000)
        throw new Error("置換対象と置換後の文字列を正しく指定してください");
      return replace(text, replacement);
    },
  });
}
