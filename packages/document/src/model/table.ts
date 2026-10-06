import type { DOMOutputSpec, Node as ProseMirrorNode } from "prosemirror-model";
import type { DocumentTableMargins, DocumentTableWidth } from "./types";
import { choice, number, record } from "./validation";

export const tableMarginSides = ["top", "right", "bottom", "left"] as const;
export function normalizeTableWidth(input: unknown): DocumentTableWidth | null {
  if (input == null) return null;
  const value = record(input, "Table width", ["unit", "value"]);
  const unit = choice(value.unit, ["px", "percent"], "Table width unit");
  return { unit, value: number(value.value, "Table width", 0.01, unit === "px" ? 5000 : 500) };
}
export function normalizeTableMargins(input: unknown): DocumentTableMargins | null {
  if (input == null) return null;
  const value = record(input, "Cell margins", tableMarginSides), output: DocumentTableMargins = {};
  for (const side of tableMarginSides) if (value[side] != null) output[side] = number(value[side], "Cell margin", 0, 5000);
  return output;
}
export function tableBoolean(input: unknown): boolean | null {
  if (input == null) return null;
  if (typeof input !== "boolean") throw new Error("Table cell flags must be boolean.");
  return input;
}

type GridCell = { attrs?: { [key: string]: unknown } };
type GridRow = { content?: readonly GridCell[] };
/** Shared column grid reconstruction, accounting for cells spanning several rows. */
export function documentTableGrid(rows: readonly GridRow[]): (number | null)[] {
  const grid: (number | null)[] = [], occupied: number[] = [];
  rows.forEach((row, rowIndex) => {
    let column = 0;
    for (const cell of row.content ?? []) {
      while ((occupied[column] ?? 0) > rowIndex) column++;
      const span = Number(cell.attrs?.colspan ?? 1), rowspan = Number(cell.attrs?.rowspan ?? 1);
      const widths = cell.attrs?.colwidth;
      for (let offset = 0; offset < span; offset++) {
        const width = Array.isArray(widths) ? widths[offset] : null;
        grid[column + offset] ??= typeof width === "number" && width >= 1 && width <= 5000 ? width : null;
        occupied[column + offset] = rowIndex + rowspan;
      }
      column += span;
    }
  });
  return grid;
}
export const tableWidthCss = (width: DocumentTableWidth) => `${width.value}${width.unit === "px" ? "px" : "%"}`;
const jsonAttribute = (dom: HTMLElement, name: string): unknown => {
  const value = dom.getAttribute(name);
  if (!value) return null;
  try { return JSON.parse(value); } catch { return null; }
};
const cssWidth = (value: string): DocumentTableWidth | null => {
  const match = /^(\d+(?:\.\d+)?)(px|%)$/.exec(value);
  return match ? normalizeTableWidth({ unit: match[2] === "px" ? "px" : "percent", value: Number(match[1]) }) : null;
};
const parseFlag = (dom: HTMLElement, name: string) => dom.getAttribute(name) === "true" ? true : dom.getAttribute(name) === "false" ? false : null;
export function parseTableDom(dom: HTMLElement) {
  try {
    const own = dom.hasAttribute("data-document-table");
    const layout = dom.getAttribute("data-document-layout") ?? (own ? null : dom.style.tableLayout || null);
    return { id: dom.getAttribute("data-document-id"), width: normalizeTableWidth(own ? jsonAttribute(dom, "data-document-width") : cssWidth(dom.style.width)),
      layout: layout == null ? null : choice(layout, ["fixed", "auto"], "Table layout"), cellMargins: normalizeTableMargins(jsonAttribute(dom, "data-document-cell-margins")) };
  } catch { return false; }
}
export function parseTableCellDom(dom: HTMLElement) {
  try {
    const colwidth = jsonAttribute(dom, "data-document-colwidth");
    return { id: dom.getAttribute("data-document-id"), colspan: Number(dom.getAttribute("colspan") || 1), rowspan: Number(dom.getAttribute("rowspan") || 1),
      colwidth: Array.isArray(colwidth) && colwidth.every(width => typeof width === "number" && width >= 1 && width <= 5000) ? colwidth : null,
      backgroundColor: dom.style.backgroundColor || null, preferredWidth: normalizeTableWidth(jsonAttribute(dom, "data-document-preferred-width")),
      margins: normalizeTableMargins(jsonAttribute(dom, "data-document-margins")), noWrap: parseFlag(dom, "data-document-nowrap"), fitText: parseFlag(dom, "data-document-fit-text") };
  } catch { return false; }
}
export function tableDom(node: ProseMirrorNode): DOMOutputSpec {
  const rows: GridRow[] = [];
  node.forEach(row => { const cells: GridCell[] = []; row.forEach(cell => cells.push({ attrs: cell.attrs })); rows.push({ content: cells }); });
  const grid = documentTableGrid(rows), width = node.attrs.width as DocumentTableWidth | null;
  const margins = node.attrs.cellMargins as DocumentTableMargins | null;
  const styles = [width ? `width:${tableWidthCss(width)}` : node.attrs.layout != null && grid.length && grid.every(value => value != null) ? `width:${grid.reduce<number>((sum, value) => sum + (value ?? 0), 0)}px` : null,
    node.attrs.layout ? `table-layout:${node.attrs.layout}` : null,
    ...tableMarginSides.map(side => margins?.[side] == null ? null : `--lxd-cell-padding-${side}:${margins[side]}px`)].filter(Boolean).join(";");
  const attrs = { "data-document-id": node.attrs.id, "data-document-table": "true", "data-document-width": width ? JSON.stringify(width) : null,
    "data-document-layout": node.attrs.layout, "data-document-cell-margins": margins ? JSON.stringify(margins) : null, style: styles || null };
  const columns: DOMOutputSpec[] = grid.map(value => ["col", value == null ? {} : { style: `width:${value}px` }]);
  return columns.some((_, index) => grid[index] != null) ? ["table", attrs, ["colgroup", ...columns], ["tbody", 0]] : ["table", attrs, ["tbody", 0]];
}
export function tableCellDom(node: ProseMirrorNode, tag: "td" | "th"): DOMOutputSpec {
  const width = node.attrs.preferredWidth as DocumentTableWidth | null, margins = node.attrs.margins as DocumentTableMargins | null;
  const columns = node.attrs.colwidth as number[] | null, columnWidth = columns?.reduce((sum, value) => sum + value, 0);
  const style = [node.attrs.backgroundColor ? `background-color:${node.attrs.backgroundColor}` : null,
    width ? `width:${tableWidthCss(width)}` : columnWidth ? `width:${columnWidth}px` : null,
    width?.unit === "px" ? `--lxd-cell-preferred-width:${width.value}px` : null,
    ...tableMarginSides.map(side => margins?.[side] == null ? null : `padding-${side}:${margins[side]}px`)].filter(Boolean).join(";");
  return [tag, { colspan: node.attrs.colspan, rowspan: node.attrs.rowspan, style, "data-document-id": node.attrs.id,
    "data-document-colwidth": columns ? JSON.stringify(columns) : null, "data-document-preferred-width": width ? JSON.stringify(width) : null,
    "data-document-width-unit": width?.unit ?? "auto", "data-document-margins": margins ? JSON.stringify(margins) : null,
    "data-document-nowrap": node.attrs.noWrap == null ? null : String(node.attrs.noWrap), "data-document-fit-text": node.attrs.fitText == null ? null : String(node.attrs.fitText) }, 0];
}
