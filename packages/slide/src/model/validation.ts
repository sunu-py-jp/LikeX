export function record(value: unknown, label: string, keys: readonly string[]): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))) throw new Error(`${label}をオブジェクトで指定してください`);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !keys.includes(key) || !Object.hasOwn(Object.getOwnPropertyDescriptor(value, key)!, "value"))
      throw new Error(`${label}に対応していない項目があります: ${String(key)}`);
  }
  return value as Record<string, unknown>;
}

export function list(value: unknown, label: string, maximum: number, minimum = 0): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) throw new Error(`${label}は${minimum}〜${maximum}件で指定してください`);
  for (let index = 0; index < value.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, index);
    if (!descriptor || !Object.hasOwn(descriptor, "value")) throw new Error(`${label}に空の要素やアクセサーは指定できません`);
  }
  for (const key of Reflect.ownKeys(value)) if (key !== "length" &&
    (typeof key !== "string" || !/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= value.length))
    throw new Error(`${label}に対応していない項目があります`);
  return value;
}

export function text(value: unknown, label: string, maximum: number, allowEmpty = true): string {
  if (typeof value !== "string" || value.length > maximum || (!allowEmpty && !value.trim()) ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\ufffe\uffff]/.test(value)) throw new Error(`${label}の文字列が正しくありません`);
  // Preserve JSON and XML round-trips without silently replacing malformed Unicode.
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new Error(`${label}の文字列が正しくありません`);
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new Error(`${label}の文字列が正しくありません`);
  }
  return value;
}

export function identifier(value: unknown): string {
  const id = text(value, "ID", 200, false);
  if (id !== id.trim() || /\s/.test(id)) throw new Error("IDに空白は指定できません");
  return id;
}

export function number(value: unknown, label: string, minimum: number, maximum: number, integer = false): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum || (integer && !Number.isSafeInteger(value)))
    throw new Error(`${label}は${minimum}〜${maximum}${integer ? "の整数" : ""}で指定してください`);
  return Object.is(value, -0) ? 0 : value;
}

export function boolean(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${label}を真偽値で指定してください`);
  return value;
}

export function choice<T extends string>(value: unknown, values: readonly T[], label: string): T {
  if (typeof value !== "string" || !values.includes(value as T)) throw new Error(`${label}が正しくありません`);
  return value as T;
}

export function color(value: unknown, label: string, transparent = true): string {
  if (transparent && value === "transparent") return value;
  if (typeof value !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value))
    throw new Error(`${label}は16進数の色で指定してください`);
  const digits = value.slice(1).toLowerCase();
  return `#${digits.length <= 4 ? [...digits].map(character => character + character).join("") : digits}`;
}

export function fontFamily(value: unknown): string {
  const font = text(value, "フォント", 200, false);
  if (!/^[\p{L}\p{N} ,.'_-]+$/u.test(font)) throw new Error("フォント名に使用できない文字が含まれています");
  return font;
}
