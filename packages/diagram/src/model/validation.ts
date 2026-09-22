export function object(input: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error(`${label} must be an object.`);
  for (const key of Reflect.ownKeys(input)) if (typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, "value")) throw new Error(`${label} has an unsupported property.`);
  return input as Record<string, unknown>;
}
export function string(input: unknown, max = 10000): string { if (typeof input !== "string" || input.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/.test(input) || /[\uD800-\uDFFF]/u.test(input)) throw new Error("Invalid text."); return input; }
export function id(input: unknown): string { const result = string(input, 200); if (!result || /\s/.test(result)) throw new Error("Invalid ID."); return result; }
export function number(input: unknown, min = -100000, max = 100000): number { if (typeof input !== "number" || !Number.isFinite(input) || input < min || input > max) throw new Error(`Number must be between ${min} and ${max}.`); return input === 0 ? 0 : input; }
export function color(input: unknown): string { if (typeof input !== "string" || !/^#[\da-f]{6}$/i.test(input)) throw new Error("Colors must be #RRGGBB."); return input.toLowerCase(); }
export function choice<T extends string>(input: unknown, options: readonly T[]): T { if (typeof input !== "string" || !options.includes(input as T)) throw new Error("Unsupported value."); return input as T; }
export function freeze<T>(value: T): T { if (value && typeof value === "object") { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; }
export function identifiers(input: unknown): string[] { if (!Array.isArray(input) || input.length > 10000 || !input.length) throw new Error("Select at least one item."); const result = input.map(id); if (new Set(result).size !== result.length) throw new Error("IDs must be unique."); return result; }
export const xml = (input: string): string => input.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
