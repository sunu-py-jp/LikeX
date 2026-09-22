import { serializeStableJson } from "../core";
import type { FormField, FormFieldInput, FormModel, FormValue } from "./types";
import { FORM_LIMITS, freeze, id, number, record, text } from "./validation";
const fieldTypes = ["text", "textarea", "number", "date", "select", "radio", "checkbox"] as const;
export function normalizeField(input: unknown): FormField {
  const raw = record(input, ["id", "type", "label", "description", "placeholder", "required", "options", "defaultValue", "min", "max", "minLength", "maxLength", "visibleWhen"], "項目");
  if (!fieldTypes.includes(raw.type as FormField["type"])) throw new Error("項目の種類が不正です。");
  if (raw.required !== undefined && typeof raw.required !== "boolean") throw new Error("必須の指定が不正です。");
  const choices = raw.options ?? [];
  if (!Array.isArray(choices) || choices.length > FORM_LIMITS.options) throw new Error("選択肢の数が上限を超えています。");
  const options = choices.map(item => { const value = record(item, ["value", "label"], "選択肢"); return { value: text(value.value, "選択肢の値", 500), label: text(value.label, "選択肢", 1000) }; });
  if (new Set(options.map(item => item.value)).size !== options.length || options.some(item => !item.value)) throw new Error("選択肢の値は空にせず、重複しない値を指定してください。");
  const type = raw.type as FormField["type"], value = raw.defaultValue ?? (type === "checkbox" ? false : type === "number" ? null : "");
  if (!(typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || value === null)) throw new Error("初期値が不正です。");
  if (typeof value === "string") text(value, "初期値");
  if (value !== null && ((type === "number" && typeof value !== "number") || (type === "checkbox" && typeof value !== "boolean") || (!["number", "checkbox"].includes(type) && typeof value !== "string"))) throw new Error("項目と初期値の型が一致しません。");
  const field: FormField = { id: id(raw.id), type, label: text(raw.label, "項目名", 1000), description: text(raw.description ?? "", "説明"), placeholder: text(raw.placeholder ?? "", "プレースホルダー", 1000), required: raw.required === true, options, defaultValue: value as FormValue };
  for (const key of ["min", "max", "minLength", "maxLength"] as const) if (raw[key] !== undefined) { field[key] = number(raw[key], key); if (key.endsWith("Length") && (!Number.isInteger(field[key]) || field[key]! < 0 || field[key]! > FORM_LIMITS.text)) throw new Error("文字数の指定が不正です。"); }
  if (field.min !== undefined && field.max !== undefined && field.min > field.max || field.minLength !== undefined && field.maxLength !== undefined && field.minLength > field.maxLength) throw new Error("最小値は最大値以下で指定してください。");
  if (raw.visibleWhen !== undefined) {
    const condition = record(raw.visibleWhen, ["fieldId", "operator", "value"], "表示条件");
    if (!["equals", "notEquals", "contains", "notEmpty"].includes(String(condition.operator))) throw new Error("表示条件の比較方法が不正です。");
    const expected = condition.value;
    if (expected !== undefined && !(expected === null || typeof expected === "string" || typeof expected === "boolean" || typeof expected === "number" && Number.isFinite(expected))) throw new Error("表示条件の値が不正です。");
    if (typeof expected === "string") text(expected, "表示条件の値");
    field.visibleWhen = { fieldId: id(condition.fieldId), operator: condition.operator as NonNullable<FormField["visibleWhen"]>["operator"], ...(expected === undefined ? {} : { value: expected as FormValue }) };
  }
  return field;
}
export function createForm(input: Partial<Pick<FormModel, "id" | "title" | "description" | "submitLabel">> & { fields?: FormFieldInput[] } = {}): FormModel {
  return normalizeForm({ format: "likex.form", version: 1, id: input.id ?? crypto.randomUUID(), title: input.title ?? "無題のフォーム", description: input.description ?? "", submitLabel: input.submitLabel ?? "送信", fields: (input.fields ?? []).map(field => ({ ...field, id: field.id ?? crypto.randomUUID() })) });
}
export function normalizeForm(input: unknown): FormModel {
  const raw = record(input, ["format", "version", "id", "title", "description", "submitLabel", "fields"], "フォーム");
  if (raw.format !== "likex.form" || raw.version !== 1) throw new Error("LikeForm version 1のJSONを指定してください。");
  if (!Array.isArray(raw.fields) || raw.fields.length > FORM_LIMITS.fields) throw new Error("項目の数が上限を超えています。");
  const fields = raw.fields.map(normalizeField), ids = new Set(fields.map(field => field.id));
  if (ids.size !== fields.length) throw new Error("項目IDが重複しています。");
  const byId = new Map(fields.map(field => [field.id, field]));
  for (const field of fields) {
    const seen = new Set<string>([field.id]); let target = field.visibleWhen?.fieldId;
    while (target) { if (!byId.has(target) || seen.has(target)) throw new Error("表示条件の参照先が存在しないか、循環しています。"); seen.add(target); target = byId.get(target)?.visibleWhen?.fieldId; }
  }
  return freeze({ format: "likex.form", version: 1, id: id(raw.id), title: text(raw.title, "タイトル", 1000), description: text(raw.description ?? "", "説明"), submitLabel: text(raw.submitLabel ?? "送信", "送信ボタン", 100), fields });
}
export function parseForm(json: string): FormModel { if (typeof json !== "string" || json.length > FORM_LIMITS.jsonBytes || new TextEncoder().encode(json).byteLength > FORM_LIMITS.jsonBytes) throw new Error("JSONは8 MiB以下で指定してください。"); return normalizeForm(JSON.parse(json)); }
export function serializeForm(form: FormModel): string { const json = serializeStableJson(normalizeForm(form), { space: 2, maxLength: FORM_LIMITS.jsonBytes }) + "\n"; if (new TextEncoder().encode(json).byteLength > FORM_LIMITS.jsonBytes) throw new Error("JSONは8 MiB以下で指定してください。"); return json; }
