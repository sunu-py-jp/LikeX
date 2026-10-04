"use client";

import { useMemo } from "react";
import { serializeStableJson } from "../core";

/** Stable by JSON value, independent of host object identity and later mutations. */
export function useExplorerSearchParams(input?: Readonly<Record<string, unknown>>) {
  let key: string | undefined, error: string | null = null;
  try {
    if (input !== undefined) {
      if (!input || Array.isArray(input) || typeof input !== "object") throw new Error("条件はJSONオブジェクトで指定してください。");
      key = serializeStableJson(input, { maxLength: 100_000 });
    }
  } catch (cause) { error = `検索の追加条件が不正です。${cause instanceof Error ? cause.message : "JSON形式を確認してください。"}`; }
  return useMemo(() => {
    if (key === undefined) return { params: undefined, error };
    const params = JSON.parse(key) as Readonly<Record<string, unknown>>;
    const objects: object[] = [params];
    while (objects.length) {
      const current = objects.pop()!;
      for (const value of Object.values(current)) if (value && typeof value === "object") objects.push(value);
      Object.freeze(current);
    }
    return { params, error };
  }, [key, error]);
}
