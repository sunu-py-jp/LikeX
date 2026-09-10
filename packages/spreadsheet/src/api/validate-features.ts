import type { SpreadsheetFeatures } from "./features";
import { resolveSpreadsheetFeatures } from "./resolve-features";

/** Shared runtime boundary for JSON callers; feature names and booleans must be explicit. */
export function validateSpreadsheetFeatures(features: SpreadsheetFeatures | undefined): void {
  if (features === undefined) return;
  if (!features || typeof features !== "object" || Array.isArray(features) || Object.prototype.toString.call(features) !== "[object Object]")
    throw new Error("機能の設定はオブジェクトで指定してください");
  const known = resolveSpreadsheetFeatures(undefined);
  if (Object.keys(features).some(key => !Object.hasOwn(known, key))) throw new Error("機能の設定に未対応のプロパティがあります");
  if (Object.values(features).some(value => value !== undefined && typeof value !== "boolean"))
    throw new Error("機能の設定はtrueまたはfalseで指定してください");
}
