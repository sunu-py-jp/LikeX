export const AICHAT_LIMITS = Object.freeze({ commands: 1000, jsonLength: 32 * 1024 * 1024, jsonBytes: 32 * 1024 * 1024, conversations: 500, messages: 20_000,
  contentLength: 1_000_000, totalContentLength: 8_000_000, metadataItems: 100, nameLength: 1000 });
export function record(value: unknown, label: string, allowed?: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label} must be a plain object.`);
  for (const key of Reflect.ownKeys(value)) if (typeof key !== "string" || (allowed && !allowed.includes(key)) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value")) throw new Error(`${label} contains an unsupported property.`);
  return value as Record<string, unknown>;
}
export function string(value: unknown, label: string, max: number, empty = true): string {
  if (typeof value !== "string" || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) throw new Error(`${label} is not a valid string.`);
  for (let i = 0; i < value.length; i++) { const c = value.charCodeAt(i); if (c >= 0xd800 && c <= 0xdbff) { const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${label} contains an invalid surrogate.`); } else if (c >= 0xdc00 && c <= 0xdfff) throw new Error(`${label} contains an invalid surrogate.`); }
  return value;
}
export function identifier(value: unknown): string { const id = string(value, "ID", 200, false); if (/\s/.test(id)) throw new Error("IDs cannot contain whitespace."); return id; }
export function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${label} is not supported.`); return value as T;
}
export function list(value: unknown, label: string, max: number): unknown[] { if (!Array.isArray(value) || value.length > max) throw new Error(`${label} must be an array within the ${max}-item limit.`); return value; }
export function safeUrl(value: unknown): string {
  const url = string(value, "URL", 8000, false);
  if (!/^https?:\/\//i.test(url) || /[\u0000-\u0020<>]/.test(url)) throw new Error("Only HTTP(S) metadata URLs are supported.");
  try { const parsed = new URL(url); if (!parsed.hostname || parsed.username || parsed.password) throw new Error(); } catch { throw new Error("Invalid metadata URL."); }
  return url;
}
export function date(value: unknown): string {
  const source = string(value, "Message timestamp", 40, false);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(source)) throw new Error("Message timestamps must be UTC ISO timestamps.");
  const parsed = new Date(source);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 19) !== source.slice(0, 19)) throw new Error("Invalid message timestamp.");
  return parsed.toISOString();
}
export function freeze<T>(value: T): T { if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); } return value; }
