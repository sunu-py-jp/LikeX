/** Default resource limits for the built-in PDF metadata reader. */
export const EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS = Object.freeze({
  inputBytes: 100 * 1024 * 1024,
  streamBytes: 16 * 1024 * 1024,
  decodedBytes: 64 * 1024 * 1024,
  objects: 100_000,
  xrefEntries: 100_000,
  objectStreamObjects: 100_000,
  treeNodes: 100_000,
  values: 600_000,
  depth: 64,
  treeDepth: 256,
  sections: 128,
  filters: 8,
  work: 256 * 1024 * 1024,
  timeoutMs: 30_000,
  tokenLength: 1024,
  nameLength: 1024,
  numberLength: 64,
  integerDigits: 16,
  startXrefSearchBytes: 1024,
});

export type ResolvedExplorerPdfInspectionLimits = Readonly<{
  [Key in keyof typeof EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS]: number;
}>;

/** Positive safe integers only; omitted/undefined fields inherit the defaults. */
export type ExplorerPdfInspectionLimits = Readonly<Partial<ResolvedExplorerPdfInspectionLimits>>;

/** Detach host-owned settings before asynchronous inspection starts. */
export function resolvePdfInspectionLimits(input?: unknown): ResolvedExplorerPdfInspectionLimits {
  if (input === undefined) return EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS;
  if (typeof input !== "object" || input === null || Array.isArray(input) ||
    (Object.getPrototypeOf(input) !== Object.prototype && Object.getPrototypeOf(input) !== null))
    throw new Error("pdfInspectionLimits はプレーンオブジェクトで指定してください");
  const result: { -readonly [Key in keyof ResolvedExplorerPdfInspectionLimits]: number } = { ...EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS };
  for (const key of Reflect.ownKeys(input)) {
    if (typeof key !== "string" || !Object.hasOwn(EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS, key))
      throw new Error(`pdfInspectionLimits の項目「${String(key)}」は対応していません`);
    const value: unknown = Reflect.get(input, key);
    if (value === undefined) continue;
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0)
      throw new Error(`pdfInspectionLimits.${key} は正の安全な整数で指定してください`);
    if (key === "timeoutMs" && value > 2_147_483_647)
      throw new Error("pdfInspectionLimits.timeoutMs は2147483647以下で指定してください");
    result[key as keyof ResolvedExplorerPdfInspectionLimits] = value;
  }
  return Object.freeze(result);
}
