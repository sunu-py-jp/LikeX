import { AIError } from "./provider.ts";

export const spreadsheetSearchProperties = {
  search: { type: "string", enum: ["sheets", "cells"], description: "Read-only keyword search. sheets searches sheet names; cells searches stored cells across the workbook or sheetId/range." },
  text: { type: "string", minLength: 1, maxLength: 100000, description: "Literal keyword, not a regular expression." },
  matchCase: { type: "boolean" },
  exact: { type: "boolean", description: "Match the whole sheet name or cell text instead of a substring." },
  lookIn: { type: "string", enum: ["values", "formulas"], description: "Cell search only: formatted calculated values (default), or raw formulas/input." },
  offset: { type: "integer", minimum: 0 },
  limit: { type: "integer", minimum: 1, maximum: 1000, description: "Page size for search or sheetId/includeData cell reads (default 100). Use hasMore/total to retrieve further pages." },
  previewLength: { type: "integer", minimum: 1, maximum: 10000, description: "Cell search only. Maximum characters per value/matchedText (default 200); truncated fields include explicit length and truncation metadata." },
};

/** Translate only validated inspect search options to the shared, public skill CLI. */
export function spreadsheetSearchArguments(args: Record<string, unknown>): string[] {
  const fields = Object.keys(spreadsheetSearchProperties);
  if (args.search === undefined) {
    if (fields.filter(key => !["offset", "limit"].includes(key)).some(key => args[key] !== undefined)) throw new AIError("検索引数には search: sheets または cells が必要です。");
    if (args.offset !== undefined || args.limit !== undefined) {
      if (!args.sheetId || args.includeData !== true || args.range !== undefined || args.drawingId !== undefined) throw new AIError("ページ指定は検索、または sheetId / includeData によるセル一覧取得で使えます。");
      return paginationArguments(args);
    }
    return [];
  }
  if (args.search !== "sheets" && args.search !== "cells") throw new AIError("search は sheets または cells を指定してください。");
  if (typeof args.text !== "string" || !args.text.length || args.text.length > 100000 || args.text.includes("\0")) throw new AIError("text には1〜100,000文字の検索語を指定してください。");
  if (args.drawingId !== undefined || args.includeData !== undefined) throw new AIError("検索と drawingId / includeData は併用できません。");
  if (args.search === "sheets" && ["sheetId", "range", "lookIn", "previewLength"].some(key => args[key] !== undefined)) throw new AIError("シート名検索に sheetId / range / lookIn / previewLength は指定できません。");
  if (args.range !== undefined && args.sheetId === undefined) throw new AIError("range を指定するときは sheetId が必要です。");
  const result = ["--search", args.search, "--text", args.text];
  for (const [key, flag] of [["matchCase", "match-case"], ["exact", "exact"]]) if (args[key] !== undefined) {
    if (typeof args[key] !== "boolean") throw new AIError(`${key} には true / false を指定してください。`);
    if (args[key]) result.push(`--${flag}`);
  }
  if (args.lookIn !== undefined) {
    if (args.lookIn !== "values" && args.lookIn !== "formulas") throw new AIError("lookIn は values または formulas を指定してください。");
    result.push("--look-in", args.lookIn);
  }
  result.push(...paginationArguments(args));
  if (args.previewLength !== undefined) {
    if (!Number.isSafeInteger(args.previewLength) || (args.previewLength as number) < 1 || (args.previewLength as number) > 10000) throw new AIError("previewLength は1〜10,000の整数にしてください。");
    result.push("--preview-length", String(args.previewLength));
  }
  return result;
}

function paginationArguments(args: Record<string, unknown>): string[] {
  const result: string[] = [];
  for (const key of ["offset", "limit"]) if (args[key] !== undefined) {
    const value = args[key];
    if (!Number.isSafeInteger(value) || (value as number) < (key === "limit" ? 1 : 0) || key === "limit" && (value as number) > 1000) throw new AIError("offset は0以上、limit は1〜1,000の整数にしてください。");
    result.push(`--${key}`, String(value));
  }
  return result;
}
