export const DOCUMENT_LIMITS = Object.freeze({ commands: 1000, jsonLength: 40 * 1024 * 1024, nodes: 100_000, depth: 64, textLength: 2_000_000, imageBytes: 8 * 1024 * 1024, totalImageBytes: 24 * 1024 * 1024, imageDimension: 16_384, imagePixels: 64_000_000 });
export function record(input: unknown, label: string, keys?: readonly string[]): Record<string, unknown> {
  if (!input || typeof input !== "object" || Array.isArray(input) || ![Object.prototype, null].includes(Object.getPrototypeOf(input))) throw new Error(`${label} must be a plain object.`);
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || (keys && !keys.includes(key)) || !Object.hasOwn(Object.getOwnPropertyDescriptor(input, key)!, "value")) throw new Error(`${label} has an unsupported property: ${String(key)}.`);
  }
  return input as Record<string, unknown>;
}
export function text(input: unknown, label: string, max: number = DOCUMENT_LIMITS.textLength, empty = true): string {
  if (typeof input !== "string" || input.length > max || (!empty && !input.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/.test(input)) throw new Error(`${label} is not a valid string.`);
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = input.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${label} contains invalid Unicode.`);
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error(`${label} contains invalid Unicode.`);
  }
  return input;
}
export function identifier(input: unknown): string {
  const value = text(input, "ID", 200, false);
  if (/\s/.test(value)) throw new Error("IDs cannot contain whitespace.");
  return value;
}
export function number(input: unknown, label: string, min: number, max: number, integer = false): number {
  if (typeof input !== "number" || !Number.isFinite(input) || input < min || input > max || (integer && !Number.isSafeInteger(input))) throw new Error(`${label} must be ${integer ? "an integer " : ""}between ${min} and ${max}.`);
  return Object.is(input, -0) ? 0 : input;
}
export function choice<T extends string>(input: unknown, allowed: readonly T[], label: string): T {
  if (typeof input !== "string" || !allowed.includes(input as T)) throw new Error(`${label} is unsupported.`);
  return input as T;
}
export function color(input: unknown): string {
  if (typeof input !== "string") throw new Error("Colors must be RGB colors.");
  if (/^#[\da-f]{3}$/i.test(input)) return "#" + [...input.slice(1)].map(c => c + c).join("").toLowerCase();
  if (/^#[\da-f]{6}$/i.test(input)) return input.toLowerCase();
  const rgb = /^rgb\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*\)$/i.exec(input);
  if (rgb && rgb.slice(1).every(part => Number(part) <= 255)) return "#" + rgb.slice(1).map(part => Number(part).toString(16).padStart(2, "0")).join("");
  throw new Error("Colors must use #RGB, #RRGGBB or rgb(r,g,b).");
}
export function fontFamily(input: unknown): string {
  const family = text(input, "Font family", 200, false);
  if (!/^[\p{L}\p{N} ,.'"_-]+$/u.test(family)) throw new Error("Font family contains unsupported characters.");
  return family;
}
export function link(input: unknown): string {
  const href = text(input, "Link URL", 4096, false);
  if (href !== href.trim() || /[\u0000-\u0020\u007f]/.test(href) || !/^(https?:\/\/|mailto:|tel:|#)/i.test(href)) throw new Error("Links must use http, https, mailto, tel or a document fragment.");
  return href;
}
