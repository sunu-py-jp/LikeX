import { createDataView, normalizeDataView, normalizeDataViewValue, DATAVIEW_LIMITS } from "./data";
import type { DataViewFieldInput, DataViewModel, DataViewValue } from "./types";
export type DataViewCsvImportOptions = { title?: string; delimiter?: "," | "\t"; fields?: DataViewFieldInput[] };
export type DataViewCsvExportOptions = { delimiter?: "," | "\t"; preventFormulaInjection?: boolean };
function readCsv(input: string, delimiter: string): string[][] {
  if (typeof input !== "string" || input.length > DATAVIEW_LIMITS.jsonLength) throw new Error("CSV is too large.");
  const text = input.replace(/^\uFEFF/, ""), rows: string[][] = []; let row: string[] = [], cell = "", quoted = false, closed = false;
  const finishCell = () => { if (cell.length > DATAVIEW_LIMITS.textLength) throw new Error("CSV cell is too large."); row.push(cell); cell = ""; closed = false; if (row.length > DATAVIEW_LIMITS.fields) throw new Error("Too many CSV columns."); };
  const finishRow = () => { finishCell(); rows.push(row); row = []; if (rows.length > DATAVIEW_LIMITS.rows + 1) throw new Error("Too many CSV rows."); };
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) { if (char === '"') { if (text[index + 1] === '"') { cell += '"'; index++; } else { quoted = false; closed = true; } } else cell += char; }
    else if (char === delimiter) finishCell();
    else if (char === "\r" || char === "\n") { if (char === "\r" && text[index + 1] === "\n") index++; finishRow(); }
    else if (char === '"' && cell === "" && !closed) quoted = true;
    else { if (closed || char === '"') throw new Error("CSV quoting is invalid."); cell += char; }
  }
  if (quoted) throw new Error("CSV contains an unclosed quote."); if (cell || row.length || closed) finishRow(); return rows;
}
export function importDataViewCsv(csv: string, options: DataViewCsvImportOptions = {}): DataViewModel {
  const delimiter = options.delimiter ?? ","; if (delimiter !== "," && delimiter !== "\t") throw new Error("Unsupported delimiter.");
  const [header, ...body] = readCsv(csv, delimiter); if (!header?.length) throw new Error("CSV needs a header row.");
  if (new Set(header).size !== header.length || header.some(name => !name.trim())) throw new Error("CSV headers must be non-empty and unique.");
  const data = createDataView({ title: options.title ?? "CSVデータ", fields: options.fields ?? header.map(name => ({ name, type: "text" })) });
  if (data.fields.length !== header.length || data.fields.some((field, index) => field.name !== header[index])) throw new Error("CSV headers must match the supplied fields in order.");
  const rows = body.map((values, index) => { if (values.length !== header.length) throw new Error(`CSV row ${index + 2} has a different column count.`); return { id: crypto.randomUUID(), values: Object.fromEntries(data.fields.map((field, column) => {
    const source = values[column]; let value: DataViewValue = source;
    if (source === "" && field.type !== "text") value = null;
    else if (field.type === "number") { if (!source.trim() || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(source.trim())) throw new Error(`CSV row ${index + 2}: invalid number.`); value = Number(source); }
    else if (field.type === "boolean") { if (!/^(true|false)$/i.test(source)) throw new Error(`CSV row ${index + 2}: use true or false.`); value = source.toLowerCase() === "true"; }
    return [field.id, normalizeDataViewValue(value, field)];
  })) }; });
  return normalizeDataView({ ...data, rows });
}
export function exportDataViewCsv(input: DataViewModel, options: DataViewCsvExportOptions = {}): string {
  const data = normalizeDataView(input), delimiter = options.delimiter ?? ","; if (delimiter !== "," && delimiter !== "\t") throw new Error("Unsupported delimiter.");
  const cell = (value: DataViewValue) => { let text = value == null ? "" : String(value); if (options.preventFormulaInjection !== false && typeof value === "string" && /^[\t\r\n ]*[=+\-@]/.test(text)) text = "'" + text; return /["\r\n,\t]/.test(text) ? '"' + text.replaceAll('"', '""') + '"' : text; };
  return [data.fields.map(field => cell(field.name)).join(delimiter), ...data.rows.map(row => data.fields.map(field => cell(row.values[field.id])).join(delimiter))].join("\r\n") + "\r\n";
}
