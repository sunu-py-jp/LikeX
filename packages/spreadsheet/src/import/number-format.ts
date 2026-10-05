import type { SpreadsheetCellFormat } from "../model/types";
import type { ImportContext } from "./types";

// Bound custom formatting work before even the General/text fast paths.
const maxNumberFormatLength = 4096;
const builtins: Record<number, string> = { 0: "General", 1: "0", 2: "0.00", 3: "#,##0", 4: "#,##0.00", 5: '"$"#,##0', 6: '"$"#,##0;[Red]("$"#,##0)', 7: '"$"#,##0.00', 8: '"$"#,##0.00;[Red]("$"#,##0.00)', 9: "0%", 10: "0.00%", 11: "0.00E+00", 12: "# ?/?", 13: "# ??/??", 14: "mm-dd-yy", 15: "d-mmm-yy", 16: "d-mmm", 17: "mmm-yy", 18: "h:mm AM/PM", 19: "h:mm:ss AM/PM", 20: "h:mm", 21: "h:mm:ss", 22: "m/d/yy h:mm", 37: "#,##0;(#,##0)", 38: "#,##0;[Red](#,##0)", 39: "#,##0.00;(#,##0.00)", 40: "#,##0.00;[Red](#,##0.00)", 45: "mm:ss", 46: "[h]:mm:ss", 47: "mmss.0", 48: "##0.0E+0", 49: "@" };

type FormatTokens = { plain: string; sections: number; red: boolean; elapsed: boolean; conditional: boolean;
  currency: boolean; foreignCurrency: boolean; literal: boolean; negativeParentheses: boolean };

/** Visit each character once. Unclosed literals/brackets must not restart a regex at every offset. */
function tokenize(code: string): FormatTokens | undefined {
  const tokens: FormatTokens = { plain: "", sections: 1, red: false, elapsed: false, conditional: false,
    currency: false, foreignCurrency: false, literal: false, negativeParentheses: false };
  const plain: string[] = [];
  const visible = (character: string, quoted = false) => {
    if ("$¥￥€£".includes(character)) tokens.currency = true;
    if ("$€£".includes(character)) tokens.foreignCurrency = true;
    if (quoted && !"¥￥$€£".includes(character)) tokens.literal = true;
    if (tokens.sections === 2 && character === "(") tokens.negativeParentheses = true;
  };
  let index = 0;
  while (index < code.length) {
    const character = code[index++];
    if (character === '"') {
      while (index < code.length && code[index] !== '"') visible(code[index++], true);
      if (index === code.length) return;
      index++;
    } else if (character === "\\" || character === "_" || character === "*") {
      if (index === code.length) return;
      const literal = code[index++];
      if (character === "\\") visible(literal);
    } else if (character === "[") {
      const start = index;
      while (index < code.length && code[index] !== "]") { if (code[index] === "[") return; index++; }
      if (index === code.length) return;
      const bracket = code.slice(start, index++).toLowerCase();
      tokens.red ||= bracket === "red";
      tokens.elapsed ||= /^(?:h{1,2}|m{1,2}|s{1,2})$/.test(bracket);
      tokens.conditional ||= /^[<>=]/.test(bracket);
      if (bracket.startsWith("$")) {
        tokens.currency = true;
        // Locale-only [$-409] is not a visible dollar sign.
        if (!/^\$-?\w+$/.test(bracket) && /[$€£]/.test(bracket)) tokens.foreignCurrency = true;
      }
    } else if (character === "]") return;
    else {
      if (character === ";") tokens.sections++;
      visible(character); plain.push(character);
    }
  }
  tokens.plain = plain.join("").toLowerCase();
  return tokens;
}

export function numberFormat(id: number, custom: Map<number, string>, context: ImportContext): SpreadsheetCellFormat {
  const code = custom.get(id) ?? builtins[id] ?? (id >= 27 && id <= 36 || id >= 50 && id <= 58 ? "yyyy/mm/dd" : undefined);
  if (code === undefined) { context.warn({ code: "adjusted", message: "未対応の数値書式を標準表示へ変更しました" }); return {}; }
  if (code.length > maxNumberFormatLength) {
    context.warn({ code: "adjusted", message: "数値書式が4,096文字の上限を超えているため、標準表示へ変更しました" }); return {};
  }
  const tokens = tokenize(code);
  if (!tokens) { context.warn({ code: "adjusted", message: "数値書式の引用符・角括弧・エスケープが不正なため、標準表示へ変更しました" }); return {}; }
  const { plain: cleaned, red, negativeParentheses: parentheses } = tokens;
  if (code.toLowerCase() === "general") return {};
  if (/^General;/i.test(code)) {
    return red || parentheses ? { negativeFormat: red ? parentheses ? "red-parentheses" : "red" : "parentheses" } : {};
  }
  if (code === "@") return { numberFormat: "text" };
  const date = /[yd]/.test(cleaned), time = /[hs]/.test(cleaned) || tokens.elapsed;
  if (date || time || /m/.test(cleaned)) {
    if (code !== "yyyy/mm/dd" && code !== "hh:mm:ss" && code !== "yyyy/mm/dd hh:mm:ss") context.warn({ code: "adjusted", message: "日付・時刻の表示書式をLikeXの書式へ変更しました" });
    return { numberFormat: date && time ? "datetime" : time ? "time" : "date" };
  }
  if (!/[0#]/.test(cleaned) || /[?e]/.test(cleaned) || tokens.conditional) { context.warn({ code: "adjusted", message: "未対応の数値書式を標準表示へ変更しました" }); return {}; }
  const places = /\.([0#]+)/.exec(cleaned)?.[1];
  if (tokens.foreignCurrency) context.warn({ code: "adjusted", message: "通貨の表示記号を円へ変更しました" });
  if (tokens.sections > 2 || tokens.literal) context.warn({ code: "adjusted", message: "独自の数値書式を対応する書式へ近似しました" });
  return { numberFormat: tokens.currency ? "currency" : cleaned.includes("%") ? "percent" : "number", useGrouping: cleaned.includes(","),
    ...(places && /^0+$/.test(places) ? { decimalPlaces: Math.min(places.length, 10) } : places ? {} : { decimalPlaces: 0 }),
    ...(red || parentheses ? { negativeFormat: red ? parentheses ? "red-parentheses" : "red" : "parentheses" } : {}) };
}
