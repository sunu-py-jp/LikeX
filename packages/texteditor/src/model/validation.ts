export const TEXT_EDITOR_LIMITS = Object.freeze({ textLength: 10_000_000, fileBytes: 40_000_000, commands: 1000, matches: 10_000, titleLength: 1000, jsonBytes: 64 * 1024 * 1024 });

export function record(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value)))
    throw new Error(`${label}をオブジェクトで指定してください。`);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== "string" || !keys.includes(key)) throw new Error(`${label}: 未対応の項目 ${String(key)}`);
    if (!("value" in descriptors[key])) throw new Error(`${label}: getter/setterは利用できません。`);
  }
  return value as Record<string, unknown>;
}

export function checkedText(value: unknown, label = "本文", maximum: number = TEXT_EDITOR_LIMITS.textLength): string {
  if (typeof value !== "string" || value.length > maximum || value.includes("\u0000"))
    throw new Error(`${label}はNUL文字を含まない${maximum.toLocaleString("en-US")}文字以内の文字列で指定してください。`);
  return value;
}

export function checkedOffset(value: unknown, length: number): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > length)
    throw new RangeError("文字位置が本文の範囲外です。");
  return value as number;
}

export function checkedId(value: unknown): string {
  const id = checkedText(value, "ID", 200);
  if (!id.trim() || ["__proto__", "constructor", "prototype"].includes(id)) throw new Error("IDが不正です。");
  return id;
}

export function checkedArray(value: unknown): readonly unknown[] {
  if (!Array.isArray(value) || value.length > TEXT_EDITOR_LIMITS.commands) throw new Error(`コマンドは${TEXT_EDITOR_LIMITS.commands}件以内で指定してください。`);
  for (const key of Reflect.ownKeys(value)) {
    if (key === "length") continue;
    if (typeof key !== "string" || !/^(0|[1-9]\d*)$/.test(key) || !("value" in Object.getOwnPropertyDescriptor(value, key)!))
      throw new Error("コマンド配列はデータのみで指定してください。");
  }
  for (let index = 0; index < value.length; index++) if (!Object.hasOwn(value, index)) throw new Error("コマンド配列の空要素は利用できません。");
  return value;
}
