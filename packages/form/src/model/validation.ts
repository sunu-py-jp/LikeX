export const FORM_LIMITS = Object.freeze({ fields: 500, commands: 1000, options: 500, text: 10000, jsonBytes: 8 * 1024 * 1024 });
export function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}をオブジェクトで指定してください。`);
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
    if (!("value" in descriptor)) throw new Error(`${label}: getter/setterは利用できません。`);
    if (!keys.includes(key)) throw new Error(`${label}: 未対応の項目 ${key}`);
  }
  return value as Record<string, unknown>;
}
export function text(value: unknown, label: string, limit: number = FORM_LIMITS.text): string { if (typeof value !== "string" || value.length > limit || /\u0000/.test(value)) throw new Error(`${label}が不正です。`); return value; }
export function id(value: unknown): string { const result = text(value, "ID", 200); if (!result.trim() || ["__proto__", "constructor", "prototype"].includes(result)) throw new Error("IDが不正です。"); return result; }
export function number(value: unknown, label: string): number { if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}を数値で指定してください。`); return value; }
export function index(value: unknown, length: number): number { const n = number(value, "位置"); if (!Number.isInteger(n) || n < 0 || n > length) throw new Error("挿入・移動位置が範囲外です。"); return n; }
export function freeze<T>(input: T): T { if (input !== null && typeof input === "object") { for (const child of Object.values(input)) freeze(child); Object.freeze(input); } return input; }
