/** Preserve tuple shapes as well as readonly arrays in returned query data. */
export type QuerySnapshot<T> = T extends object ? { readonly [Key in keyof T]: QuerySnapshot<T[Key]> } : T;

/** Clone only the requested JSON subtree; never freeze objects owned by the caller. */
export function copyQuerySnapshot<T>(input: T): QuerySnapshot<T> {
  const active = new WeakSet<object>(), copies = new WeakMap<object, object>();
  let objects = 0;
  const copy = (value: unknown, depth: number): unknown => {
    if (value === null || value === undefined || typeof value === "string" || typeof value === "boolean") return value;
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value !== "object" || depth > 64 || active.has(value)) throw new Error("読み取るデータは循環参照のないJSON形式で指定してください");
    const existing = copies.get(value);
    if (existing) return existing;
    if (++objects > 1_000_000) throw new Error("読み取るデータの大きさが上限を超えています");
    const array = Array.isArray(value), prototype = Object.getPrototypeOf(value);
    if (!array && prototype !== Object.prototype && prototype !== null) throw new Error("読み取るデータはJSON形式のオブジェクトで指定してください");
    if (Object.getOwnPropertySymbols(value).length) throw new Error("読み取るデータにJSON形式以外のキーが含まれています");
    const result: object = array ? [] : {};
    copies.set(value, result); active.add(value);
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(value))) {
      if (array && key === "length") continue;
      if (!descriptor.enumerable) continue;
      if (!Object.hasOwn(descriptor, "value")) throw new Error("読み取るデータにアクセサーは指定できません");
      Object.defineProperty(result, key, { value: copy(descriptor.value, depth + 1), enumerable: true, configurable: true, writable: true });
    }
    if (array) (result as unknown[]).length = value.length;
    active.delete(value);
    return Object.freeze(result);
  };
  return copy(input, 0) as QuerySnapshot<T>;
}
