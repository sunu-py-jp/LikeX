import { serializeStableJson } from "../json";
import type { DataViewCommand, DataViewCommandResult, DataViewField, DataViewFieldType, DataViewGroup, DataViewInput, DataViewModel, DataViewQuery, DataViewRow, DataViewValue } from "./types";
export const DATAVIEW_LIMITS = Object.freeze({ fields: 100, rows: 20_000, commands: 1000, textLength: 50_000, jsonLength: 32 * 1024 * 1024 });
const normalized = new WeakSet<DataViewModel>(), serialized = new WeakMap<DataViewModel, string>();
function object(value: unknown, keys?: readonly string[]): Record<string, unknown> { if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error("Expected a plain object."); for (const key of Reflect.ownKeys(value)) if (typeof key !== "string" || (keys && !keys.includes(key)) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) throw new Error("Unsupported object property."); return value as Record<string, unknown>; }
function text(value: unknown, maximum: number, empty = false): string { if (typeof value !== "string" || value.length > maximum || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) throw new Error("Invalid text value."); return value; }
function id(value: unknown): string { const key = text(value, 200); if (/\s/.test(key) || ["__proto__", "constructor", "prototype"].includes(key)) throw new Error("Invalid resource ID."); return key; }
function list(value: unknown, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw new Error("Too many records or fields."); return value; }
function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
export function normalizeDataViewValue(value: unknown, field: DataViewField): DataViewValue {
  if (value === null || value === undefined) return null;
  if (field.type === "text") return text(value, DATAVIEW_LIMITS.textLength, true);
  if (field.type === "number") { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${field.name}: 数値を入力してください。`); return value; }
  if (field.type === "boolean") { if (typeof value !== "boolean") throw new Error(`${field.name}: 真偽値を指定してください。`); return value; }
  if (field.type === "date") { if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value) throw new Error(`${field.name}: 正しい日付を指定してください。`); return value; }
  if (typeof value !== "string" || !field.options.includes(value)) throw new Error(`${field.name}: 選択肢から指定してください。`);
  return value;
}
export function normalizeDataView(input: unknown): DataViewModel {
  if (normalized.has(input as DataViewModel)) return input as DataViewModel;
  const raw = object(input, ["format", "version", "id", "title", "fields", "rows"]);
  if (raw.format !== "likex.dataview" || raw.version !== 1) throw new Error("Unsupported LikeDataView file format.");
  const seen = new Set<string>(); const unique = (value: unknown) => { const key = id(value); if (seen.has(key)) throw new Error("Duplicate resource ID."); seen.add(key); return key; };
  const fields: DataViewField[] = list(raw.fields, DATAVIEW_LIMITS.fields).map(item => { const value = object(item, ["id", "name", "type", "options"]); if (!["text", "number", "date", "boolean", "select"].includes(String(value.type))) throw new Error("Unsupported field type."); const options = list(value.options, 100).map(item => text(item, 500)); if (new Set(options).size !== options.length || (value.type !== "select" && options.length)) throw new Error("Only select fields can have unique options."); return { id: unique(value.id), name: text(value.name, 200), type: value.type as DataViewFieldType, options }; });
  if (new Set(fields.map(field => field.name)).size !== fields.length) throw new Error("Field names must be unique.");
  const keys = fields.map(field => field.id);
  const rows: DataViewRow[] = list(raw.rows, DATAVIEW_LIMITS.rows).map(item => { const row = object(item, ["id", "values"]), values = object(row.values, keys); return { id: unique(row.id), values: Object.fromEntries(fields.map(field => [field.id, normalizeDataViewValue(values[field.id], field)])) }; });
  const data = freeze<DataViewModel>({ format: "likex.dataview", version: 1, id: id(raw.id), title: text(raw.title, 500), fields, rows }); normalized.add(data); return data;
}
export function createDataView(input: DataViewInput = {}): DataViewModel {
  object(input, ["id", "title", "fields", "rows"]);
  return normalizeDataView({ format: "likex.dataview", version: 1, id: input.id ?? crypto.randomUUID(), title: input.title ?? "新しいデータベース", fields: (input.fields ?? [{ name: "名前", type: "text" }]).map(field => ({ id: crypto.randomUUID(), options: [], ...field })), rows: (input.rows ?? []).map(row => ({ id: crypto.randomUUID(), values: {}, ...row })) });
}
export function parseDataView(json: string): DataViewModel { if (typeof json !== "string" || json.length > DATAVIEW_LIMITS.jsonLength) throw new Error("The data file is too large."); return normalizeDataView(JSON.parse(json)); }
export function serializeDataView(input: DataViewModel): string { const data = normalizeDataView(input); let result = serialized.get(data); if (!result) { result = serializeStableJson(data, { space: 2, maxLength: DATAVIEW_LIMITS.jsonLength }) + "\n"; serialized.set(data, result); } return result; }
export function getDataViewField(data: DataViewModel, fieldId: string): DataViewField | undefined { return normalizeDataView(data).fields.find(field => field.id === fieldId); }
export function getDataViewRow(data: DataViewModel, rowId: string): DataViewRow | undefined { return normalizeDataView(data).rows.find(row => row.id === rowId); }
export function getDataViewCell(data: DataViewModel, rowId: string, fieldId: string): DataViewValue | undefined { return getDataViewRow(data, rowId)?.values[fieldId]; }
export function queryDataViewRows(input: DataViewModel, query: DataViewQuery = {}): DataViewRow[] {
  object(query, ["search", "filters", "sort", "groupBy", "hiddenFieldIds"]);
  if (query.search !== undefined) text(query.search, 1000, true);
  for (const filter of query.filters ?? []) { object(filter, ["fieldId", "operator", "value"]); if (!["contains", "equals", "notEquals", "isEmpty", "greaterThan", "lessThan"].includes(filter.operator)) throw new Error("Unsupported filter operator."); }
  for (const sort of query.sort ?? []) { object(sort, ["fieldId", "direction"]); if (sort.direction !== "asc" && sort.direction !== "desc") throw new Error("Unsupported sort direction."); }
  const data = normalizeDataView(input), fields = new Map(data.fields.map(field => [field.id, field]));
  if (query.sort && query.sort.length > 100 || query.filters && query.filters.length > 100) throw new Error("Too many query conditions.");
  const keys = [...(query.filters ?? []).map(filter => filter.fieldId), ...(query.sort ?? []).map(sort => sort.fieldId), ...(query.groupBy ? [query.groupBy] : []), ...(query.hiddenFieldIds ?? [])];
  if (keys.some(key => !fields.has(key))) throw new Error("Query references an unknown field.");
  const search = (query.search ?? "").normalize("NFKC").toLocaleLowerCase();
  const rows = data.rows.filter(row => (!search || data.fields.some(field => String(row.values[field.id] ?? "").normalize("NFKC").toLocaleLowerCase().includes(search))) && (query.filters ?? []).every(filter => {
    const value = row.values[filter.fieldId];
    switch (filter.operator) {
      case "isEmpty": return value == null || value === "";
      case "contains": return String(value ?? "").toLocaleLowerCase().includes(String(filter.value ?? "").toLocaleLowerCase());
      case "equals": return value === filter.value;
      case "notEquals": return value !== filter.value;
      case "greaterThan": return value != null && filter.value != null && typeof value === typeof filter.value && value > filter.value;
      case "lessThan": return value != null && filter.value != null && typeof value === typeof filter.value && value < filter.value;
      default: throw new Error("Unsupported filter operator.");
    }
  }));
  return rows.sort((left, right) => { for (const sort of query.sort ?? []) { if (sort.direction !== "asc" && sort.direction !== "desc") throw new Error("Unsupported sort direction."); const a = left.values[sort.fieldId], b = right.values[sort.fieldId]; const result = a == null ? b == null ? 0 : 1 : b == null ? -1 : typeof a === "number" && typeof b === "number" ? a - b : typeof a === "boolean" && typeof b === "boolean" ? Number(a) - Number(b) : String(a).localeCompare(String(b), "ja", { numeric: true }); if (result) return sort.direction === "desc" ? -result : result; } return 0; });
}
export function groupDataViewRows(data: DataViewModel, query: DataViewQuery = {}): DataViewGroup[] {
  const rows = queryDataViewRows(data, query); if (!query.groupBy) return [{ key: "all", label: "すべてのレコード", rows }];
  const groups = new Map<string, DataViewGroup>(); for (const row of rows) { const value = row.values[query.groupBy], key = JSON.stringify(value); if (!groups.has(key)) groups.set(key, { key, label: value == null || value === "" ? "未設定" : typeof value === "boolean" ? value ? "はい" : "いいえ" : String(value), rows: [] }); groups.get(key)!.rows.push(row); } return [...groups.values()];
}
const keys: Record<DataViewCommand["type"], string[]> = { "data.rename": ["type", "title"], "data.replace": ["type", "data"], "field.add": ["type", "field", "index"], "field.update": ["type", "fieldId", "patch"], "field.delete": ["type", "fieldId"], "field.move": ["type", "fieldId", "index"], "row.add": ["type", "row", "index"], "rows.append": ["type", "rows"], "row.update": ["type", "rowId", "values"], "row.delete": ["type", "rowId"], "row.move": ["type", "rowId", "index"], "cell.set": ["type", "rowId", "fieldId", "value"] };
function at(value: number | undefined, length: number) { if (value === undefined) return length; if (!Number.isSafeInteger(value) || value < 0 || value > length) throw new Error("Position is outside the destination."); return value; }
export function executeDataViewCommands(input: DataViewModel, command: DataViewCommand | readonly DataViewCommand[]): DataViewCommandResult {
  const before = normalizeDataView(input), commands = Array.isArray(command) ? command : [command]; if (commands.length > DATAVIEW_LIMITS.commands) throw new Error("Too many commands.");
  let data = structuredClone(before); const createdIds: string[] = [];
  const field = (key: string) => { const value = data.fields.find(field => field.id === key); if (!value) throw new Error("Field not found."); return value; };
  const row = (key: string) => { const value = data.rows.find(row => row.id === key); if (!value) throw new Error("Row not found."); return value; };
  for (const cmd of commands as readonly DataViewCommand[]) {
    if (!cmd || !keys[cmd.type]) throw new Error("Unsupported data command."); object(cmd, keys[cmd.type]);
    switch (cmd.type) {
      case "data.rename": data.title = cmd.title; break;
      case "data.replace": data = structuredClone(normalizeDataView(cmd.data)); break;
      case "field.add": { object(cmd.field, ["id", "name", "type", "options"]); const value = { id: crypto.randomUUID(), options: [], ...cmd.field }; data.fields.splice(at(cmd.index, data.fields.length), 0, value); data.rows.forEach(row => { row.values[value.id] = null; }); createdIds.push(value.id); break; }
      case "field.update": object(cmd.patch, ["name", "type", "options"]); Object.assign(field(cmd.fieldId), cmd.patch); break;
      case "field.delete": data.fields.splice(data.fields.indexOf(field(cmd.fieldId)), 1); data.rows.forEach(row => { delete row.values[cmd.fieldId]; }); break;
      case "field.move": { const value = field(cmd.fieldId); data.fields.splice(data.fields.indexOf(value), 1); data.fields.splice(at(cmd.index, data.fields.length), 0, value); break; }
      case "row.add": { object(cmd.row ?? {}, ["id", "values"]); const value = { id: crypto.randomUUID(), values: {}, ...cmd.row }; data.rows.splice(at(cmd.index, data.rows.length), 0, value); createdIds.push(value.id); break; }
      case "rows.append": for (const item of cmd.rows) { object(item, ["id", "values"]); const value = { id: crypto.randomUUID(), values: {}, ...item }; data.rows.push(value); createdIds.push(value.id); } break;
      case "row.update": object(cmd.values, data.fields.map(field => field.id)); Object.assign(row(cmd.rowId).values, cmd.values); break;
      case "row.delete": data.rows.splice(data.rows.indexOf(row(cmd.rowId)), 1); break;
      case "row.move": { const value = row(cmd.rowId); data.rows.splice(data.rows.indexOf(value), 1); data.rows.splice(at(cmd.index, data.rows.length), 0, value); break; }
      case "cell.set": field(cmd.fieldId); row(cmd.rowId).values[cmd.fieldId] = cmd.value; break;
    }
    data = structuredClone(normalizeDataView(data));
  }
  const result = normalizeDataView(data), changed = serializeDataView(result) !== serializeDataView(before); return { data: changed ? result : before, changed, createdIds };
}
