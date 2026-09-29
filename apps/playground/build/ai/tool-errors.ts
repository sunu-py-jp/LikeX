import { AIError } from "./provider.ts";

export interface ToolErrorDetails {
  code: string;
  path?: string;
  expected?: unknown;
  actual?: unknown;
  failureId?: string;
  retry?: string;
  unresolvedFailures?: { failureId: string; message: string; commandIndexes?: number[]; target?: string }[];
}
export class AIToolError extends AIError {
  constructor(message: string, readonly details: ToolErrorDetails) { super(message); }
}
export function toolErrorResult(error: unknown) {
  return { ok: false, error: error instanceof AIError ? error.message : "ツールを実行できませんでした。引数と手順を確認してください。", ...(error instanceof AIToolError ? { diagnostics: error.details } : {}) };
}
export function invalidArgument(path: string, expected: unknown, actual: unknown, code = "invalid_argument"): never {
  const printable = actual === undefined ? "missing" : JSON.stringify(actual)?.slice(0, 240);
  throw new AIToolError(`${path}: ${typeof expected === "string" ? expected : JSON.stringify(expected)} が必要です (actual: ${printable})。`, { code, path, expected, actual: actual === undefined ? "missing" : actual !== null && typeof actual === "object" ? printable : typeof actual === "string" ? actual.slice(0, 240) : actual });
}
