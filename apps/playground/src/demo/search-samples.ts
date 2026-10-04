import { createWorkbook, type SpreadsheetCell, type SpreadsheetWorkbook } from "@likex/spreadsheet";
import type { ExplorerEntry } from "@likex/explorer";

export const searchSampleNames = ["Report.txt", "report.txt", "Report-final.txt", "REPORT.txt", "C++.txt", "C++ 入門.txt", "C.txt", "v1.2.txt", "v1X2.txt", "売上速報.txt", "売上速報_確定.txt"] as const;
export function createSearchEntries(): ExplorerEntry[] {
  const files: ExplorerEntry[] = searchSampleNames.map((name, index) => ({ id: `search-sample-${index}`, name, parent: index === 1 ? "lowercase" : index === 3 ? "uppercase" : "root", kind: "file", mime: "text/plain", size: 0,
    createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z", favorite: 0, source: { kind: "existing", id: `search-sample-${index}` } }));
  // Explorer forbids case-insensitive duplicate names within one folder.
  return [...files, ...[ ["lowercase", "小文字のサンプル"], ["uppercase", "大文字のサンプル"] ].map(([id, name]): ExplorerEntry => ({ id, name, parent: "root", kind: "folder", mime: "", size: 0, createdAt: "2026-09-01T09:00:00.000Z", updatedAt: "2026-09-01T09:00:00.000Z", favorite: 0, source: null }))];
}
export function createSearchWorkbook(): SpreadsheetWorkbook {
  const base = createWorkbook(), defaults = base.sheets[0];
  const heading = { background: "#216249", color: "#ffffff", bold: true };
  const sheet = (id: string, name: string, names: readonly string[]) => {
    const cells: Record<string, SpreadsheetCell> = { A1: { value: "検索対象", format: heading }, B1: { value: "比較するポイント", format: heading } };
    names.forEach((value, index) => {
      cells[`A${index + 2}`] = { value, format: { background: index % 2 ? "#f1f7f3" : "#ffffff" } };
      cells[`B${index + 2}`] = { value: value.includes("+") || value.includes(".") || value.includes("X") ? "記号も文字として一致" : value.includes("売上") ? "日本語の部分・全体一致" : "大小文字と部分・全体一致" };
    });
    return { ...defaults, id, name, cells, columnWidths: { 0: 250, 1: 270 }, rowHeights: { 0: 32 } };
  };
  return { ...base, sheets: [sheet("names", "検索サンプル", ["Report", "report", "Report-final", "REPORT", "C++", "C++ 入門", "C", "v1.2", "v1X2", "売上速報", "売上速報_確定"]), sheet("archive", "別シート", ["Report", "C++", "売上速報"])] };
}
