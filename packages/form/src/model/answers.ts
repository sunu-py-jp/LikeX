import { normalizeForm } from "./form";
import type { FormAnswers, FormField, FormModel, FormValidationResult, FormValue } from "./types";
import { FORM_LIMITS, record } from "./validation";

export function getFormField(form: FormModel, fieldId: string): FormField | null { return normalizeForm(form).fields.find(field => field.id === fieldId) ?? null; }
export function getDefaultFormAnswers(form: FormModel): FormAnswers { return Object.fromEntries(normalizeForm(form).fields.map(field => [field.id, field.defaultValue])); }
function answerValue(value: unknown): value is FormValue { return value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value) || typeof value === "string" && value.length <= FORM_LIMITS.text && !value.includes("\0"); }
export function normalizeFormAnswers(form: FormModel, input: unknown): FormAnswers {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error("回答をオブジェクトで指定してください。");
  const fields = normalizeForm(form).fields, ids = new Set(fields.map(field => field.id));
  record(input, [...ids], "回答");
  const entries = Object.entries(input);
  for (const [key, value] of entries) if (!ids.has(key) || !answerValue(value)) throw new Error("回答の項目IDまたは値が不正です。");
  return { ...getDefaultFormAnswers(form), ...Object.fromEntries(entries) };
}
export function getVisibleFormFields(form: FormModel, answers: FormAnswers = {}): FormField[] {
  const fields = normalizeForm(form).fields, values = normalizeFormAnswers(form, answers), byId = new Map(fields.map(field => [field.id, field])), cache = new Map<string, boolean>();
  function visible(field: FormField): boolean {
    if (cache.has(field.id)) return cache.get(field.id)!;
    const condition = field.visibleWhen; if (!condition) return true;
    const source = byId.get(condition.fieldId)!;
    const value = values[source.id];
    const result = visible(source) && (condition.operator === "notEmpty" ? value !== "" && value !== null && value !== false : condition.operator === "contains" ? typeof value === "string" && typeof condition.value === "string" && value.includes(condition.value) : condition.operator === "equals" ? value === condition.value : value !== condition.value);
    cache.set(field.id, result); return result;
  }
  return fields.filter(visible);
}
export function validateFormAnswers(form: FormModel, input: FormAnswers): FormValidationResult {
  const answers = normalizeFormAnswers(form, input), fields = getVisibleFormFields(form, answers), errors: FormValidationResult["errors"] = [], values: FormAnswers = {};
  for (const field of fields) {
    const value = answers[field.id]; values[field.id] = value;
    let message = "";
    if (value === null || value === "" || field.type === "checkbox" && value === false) { if (field.required) message = "必須項目です。"; }
    else if (field.type === "number") {
      if (typeof value !== "number") message = "数値を入力してください。";
      else if (field.min !== undefined && value < field.min || field.max !== undefined && value > field.max) message = `指定された範囲で入力してください（${field.min ?? "制限なし"}〜${field.max ?? "制限なし"}）。`;
    } else if (field.type === "checkbox") { if (typeof value !== "boolean") message = "チェックの状態が不正です。"; }
    else if (typeof value !== "string") message = "文字列を入力してください。";
    else if (["select", "radio"].includes(field.type) && !field.options.some(option => option.value === value)) message = "選択肢から選んでください。";
    else if (field.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value + "T00:00:00Z")) || new Date(value + "T00:00:00Z").toISOString().slice(0, 10) !== value)) message = "有効な日付を入力してください。";
    else if (field.minLength !== undefined && value.length < field.minLength || field.maxLength !== undefined && value.length > field.maxLength) message = `文字数を確認してください（${field.minLength ?? 0}〜${field.maxLength ?? FORM_LIMITS.text}文字）。`;
    if (message) errors.push({ fieldId: field.id, message });
  }
  return { valid: errors.length === 0, errors, values };
}
