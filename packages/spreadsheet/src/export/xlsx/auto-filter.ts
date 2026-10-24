import { cellAddress } from "../../model/address";
import type { SpreadsheetAutoFilter } from "../../model/types";
import { xlsxText } from "./xml";

export function autoFilterXml(filter: SpreadsheetAutoFilter | undefined): string {
  if (!filter) return "";
  const { range } = filter;
  const columns = (filter.columns ?? []).map(item => {
    const blank = item.values.includes("");
    const values = item.values.filter(value => value !== "").map(value => `<filter val="${xlsxText(value)}"/>`).join("");
    return `<filterColumn colId="${item.column - range.left}"><filters${blank ? ' blank="1"' : ""}>${values}</filters></filterColumn>`;
  }).join("");
  return `<autoFilter ref="${cellAddress(range.top, range.left)}:${cellAddress(range.bottom, range.right)}">${columns}</autoFilter>`;
}
