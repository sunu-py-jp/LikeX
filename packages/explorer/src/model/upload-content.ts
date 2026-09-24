import { fileExtension } from "./text";
import { EXPLORER_VIDEO_MIME_TYPES } from "./preview-formats";

export type ExplorerUploadVideoExtension = keyof typeof EXPLORER_VIDEO_MIME_TYPES;
export type ExplorerUploadAudioExtension = ".mp3" | ".wav" | ".m4a" | ".aac" | ".ogg" | ".flac";
export type ExplorerUploadContentExtension = ExplorerUploadVideoExtension | ExplorerUploadAudioExtension | ".pdf" | ".pptx";
export type ExplorerUploadContentKind = "video" | "audio" | "pdf" | "presentation";

/** Empty/undefined entries inherit the default; only false disables an applicable limit. */
export type ExplorerUploadContentLimitsByExtension = Readonly<
  Partial<Record<ExplorerUploadVideoExtension | ExplorerUploadAudioExtension, Readonly<{ maxDurationSeconds?: number }> | false>> &
  { ".pdf"?: Readonly<{ maxPages?: number }> | false; ".pptx"?: Readonly<{ maxSlides?: number }> | false }
>;

export type ExplorerUploadContentMetadata =
  | Readonly<{ kind: "video" | "audio"; durationSeconds: number }>
  | Readonly<{ kind: "pdf"; pages: number }>
  | Readonly<{ kind: "presentation"; slides: number }>;

export type ExplorerUploadInspectFileRequest = Readonly<{
  file: File;
  /** Normalized extension, including its leading dot. */
  extension: ExplorerUploadContentExtension;
  kind: ExplorerUploadContentKind;
  signal: AbortSignal;
}>;

/** Return undefined to delegate this file to the built-in reader. */
export type ExplorerUploadInspectFile = (
  request: ExplorerUploadInspectFileRequest,
) => ExplorerUploadContentMetadata | undefined | Promise<ExplorerUploadContentMetadata | undefined>;

export type ExplorerUploadContentRule =
  | Readonly<{ extension: ExplorerUploadVideoExtension | ExplorerUploadAudioExtension; kind: "video" | "audio"; maxDurationSeconds: number }>
  | Readonly<{ extension: ".pdf"; kind: "pdf"; maxPages: number }>
  | Readonly<{ extension: ".pptx"; kind: "presentation"; maxSlides: number }>;

export type ExplorerUploadContentRejectionReason =
  | Readonly<{ code: "duration-exceeded"; maxDurationSeconds: number; durationSeconds: number; message: string }>
  | Readonly<{ code: "page-count-exceeded"; maxPages: number; pages: number; message: string }>
  | Readonly<{ code: "slide-count-exceeded"; maxSlides: number; slides: number; message: string }>
  | Readonly<{ code: "content-inspection-failed"; kind: ExplorerUploadContentKind; message: string }>;

/** Four hours; supported video suffixes use this limit unless explicitly overridden. */
export const EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS = 14_400;

const videoExtensions = new Set<string>(Object.keys(EXPLORER_VIDEO_MIME_TYPES));
const audioExtensions = new Set<string>([".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"]);
type ContentMetric = "maxDurationSeconds" | "maxPages" | "maxSlides";

function contentKind(extension: string): ExplorerUploadContentKind | undefined {
  if (videoExtensions.has(extension)) return "video";
  if (audioExtensions.has(extension)) return "audio";
  if (extension === ".pdf") return "pdf";
  if (extension === ".pptx") return "presentation";
}

function contentMetric(kind: ExplorerUploadContentKind): ContentMetric {
  return kind === "pdf" ? "maxPages" : kind === "presentation" ? "maxSlides" : "maxDurationSeconds";
}

function isPlainObject(value: unknown): value is Record<PropertyKey, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function validMetric(value: unknown, isDuration: boolean): value is number {
  return typeof value === "number" && value >= 0 &&
    (isDuration ? Number.isFinite(value) : Number.isSafeInteger(value));
}

/** Validate suffix/metric compatibility and detach every nested caller-owned object. */
export function normalizeUploadContentLimits(value: unknown): ExplorerUploadContentLimitsByExtension {
  if (!isPlainObject(value))
    throw new Error("contentLimitsByExtension は拡張子をキーとするプレーンオブジェクトで指定してください");
  const result: Record<string, Readonly<Partial<Record<ContentMetric, number>>> | false> = {};
  const seen = new Map<string, number | false | undefined>();
  for (const key of Reflect.ownKeys(value)) {
    const extension = typeof key === "string" ? key.trim().normalize("NFC").toLowerCase() : "";
    const kind = contentKind(extension);
    if (!kind) throw new Error(`内容制限の拡張子「${String(key)}」は対応していません`);
    const entry = value[key];
    const metric = contentMetric(kind);
    let limit: number | false | undefined;
    if (entry === false || entry === undefined) limit = entry;
    else {
      if (!isPlainObject(entry) || Reflect.ownKeys(entry).some(name => name !== metric))
        throw new Error(`contentLimitsByExtension[${extension}] は ${metric} のみ指定できます`);
      const candidate = entry[metric];
      if (candidate !== undefined && !validMetric(candidate, metric === "maxDurationSeconds"))
        throw new Error(`${metric} は0以上の${metric === "maxDurationSeconds" ? "有限な数値" : "安全な整数"}で指定してください`);
      limit = candidate as number | undefined;
    }
    if (seen.has(extension) && seen.get(extension) !== limit)
      throw new Error(`拡張子「${extension}」に異なる内容制限が重複して指定されています`);
    seen.set(extension, limit);
    if (limit === false) result[extension] = false;
    else if (limit !== undefined) result[extension] = Object.freeze({ [metric]: limit });
  }
  return Object.freeze(result);
}

/** Resolve only known final suffixes; unrelated or compound suffixes do not select a content reader. */
export function getUploadContentRule(
  name: string,
  limits?: ExplorerUploadContentLimitsByExtension,
): ExplorerUploadContentRule | undefined {
  const extension = `.${fileExtension(name)}`;
  const kind = contentKind(extension);
  if (!kind) return;
  const entry = limits?.[extension as ExplorerUploadContentExtension];
  if (entry === false) return;
  if (kind === "video" || kind === "audio") {
    const maximum = (entry as Readonly<{ maxDurationSeconds?: number }> | undefined)?.maxDurationSeconds ??
      (kind === "video" ? EXPLORER_DEFAULT_MAX_VIDEO_DURATION_SECONDS : undefined);
    if (maximum !== undefined) return Object.freeze({
      extension: extension as ExplorerUploadVideoExtension | ExplorerUploadAudioExtension, kind, maxDurationSeconds: maximum,
    });
  } else if (kind === "pdf") {
    const maximum = (entry as Readonly<{ maxPages?: number }> | undefined)?.maxPages;
    if (maximum !== undefined) return Object.freeze({ extension: ".pdf", kind, maxPages: maximum });
  } else {
    const maximum = (entry as Readonly<{ maxSlides?: number }> | undefined)?.maxSlides;
    if (maximum !== undefined) return Object.freeze({ extension: ".pptx", kind, maxSlides: maximum });
  }
}

function normalizedMetadata(kind: ExplorerUploadContentKind, value: unknown): ExplorerUploadContentMetadata | undefined {
  if (!isPlainObject(value) || value.kind !== kind) return;
  if (kind === "video" || kind === "audio") {
    const durationSeconds = value.durationSeconds;
    if (validMetric(durationSeconds, true)) return Object.freeze({ kind, durationSeconds });
  } else if (kind === "pdf") {
    const pages = value.pages;
    if (validMetric(pages, false)) return Object.freeze({ kind, pages });
  } else {
    const slides = value.slides;
    if (validMetric(slides, false)) return Object.freeze({ kind, slides });
  }
}

export function contentInspectionFailedRejection(
  rule: ExplorerUploadContentRule,
  cause?: unknown,
): ExplorerUploadContentRejectionReason {
  const message = "ファイルの内容を確認できないため、追加できません";
  // Reader messages explain unsupported/encrypted formats and timeouts. Never
  // include stack traces or retain the reader's mutable Error object.
  let detail = "";
  try {
    if (cause instanceof Error && typeof cause.message === "string")
      detail = cause.message.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 500);
  } catch { /* An unusual caller-owned Error cannot prevent a validation result. */ }
  return { code: "content-inspection-failed", kind: rule.kind, message: detail ? `${message}（${detail}）` : message };
}

function formatDuration(durationSeconds: number): string {
  let hours = Math.floor(durationSeconds / 3_600);
  let minutes = Math.floor(durationSeconds / 60) % 60;
  // Remove the arithmetic noise introduced by a fractional-second remainder.
  let seconds = Number((durationSeconds % 60).toPrecision(12));
  if (seconds === 60) { seconds = 0; minutes++; }
  if (minutes === 60) { minutes = 0; hours++; }
  return `${hours ? `${hours}時間` : ""}${minutes ? `${minutes}分` : ""}${seconds || (!hours && !minutes) ? `${seconds}秒` : ""}`;
}

/** Equality is accepted; metadata with the wrong kind or invalid values always fails closed. */
export function compareUploadContentMetadata(
  rule: ExplorerUploadContentRule,
  value: unknown,
): ExplorerUploadContentRejectionReason | undefined {
  const metadata = normalizedMetadata(rule.kind, value);
  if (!metadata) return contentInspectionFailedRejection(rule);
  if ((rule.kind === "video" || rule.kind === "audio") && (metadata.kind === "video" || metadata.kind === "audio")) {
    if (metadata.durationSeconds > rule.maxDurationSeconds) return {
      code: "duration-exceeded", maxDurationSeconds: rule.maxDurationSeconds, durationSeconds: metadata.durationSeconds,
      message: `再生時間${formatDuration(metadata.durationSeconds)}は上限${formatDuration(rule.maxDurationSeconds)}を超えています`,
    };
  } else if (rule.kind === "pdf" && metadata.kind === "pdf") {
    if (metadata.pages > rule.maxPages) return {
      code: "page-count-exceeded", maxPages: rule.maxPages, pages: metadata.pages,
      message: `PDFの${metadata.pages}ページは上限${rule.maxPages}ページを超えています`,
    };
  } else if (rule.kind === "presentation" && metadata.kind === "presentation" && metadata.slides > rule.maxSlides) return {
    code: "slide-count-exceeded", maxSlides: rule.maxSlides, slides: metadata.slides,
    message: `スライド数${metadata.slides}枚は上限${rule.maxSlides}枚を超えています`,
  };
}

const inspectionContextBrand: unique symbol = Symbol("ExplorerUploadInspectionContext");
/** An opaque capability containing outcomes obtained by completed asynchronous inspections. */
export type ExplorerUploadInspectionContext = Readonly<{ [inspectionContextBrand]: true }>;
export type ExplorerUploadContentInspectionOutcome =
  | Readonly<{ status: "completed"; metadata: ExplorerUploadContentMetadata }>
  | Readonly<{ status: "failed"; reason: ExplorerUploadContentRejectionReason }>;
type InspectionRecord = Readonly<{
  extension: ExplorerUploadContentExtension;
  kind: ExplorerUploadContentKind;
  inspectFile: ExplorerUploadInspectFile | undefined;
  builtinInspector: ExplorerUploadInspectFile | undefined;
  outcome: ExplorerUploadContentInspectionOutcome;
}>;
const inspectionContexts = new WeakMap<object, WeakMap<File, InspectionRecord[]>>();

export function createExplorerUploadInspectionContext(): ExplorerUploadInspectionContext {
  const context = Object.freeze({ [inspectionContextBrand]: true as const });
  inspectionContexts.set(context, new WeakMap());
  return context;
}

type InspectionLookup = Readonly<{
  context: ExplorerUploadInspectionContext;
  file: File;
  rule: ExplorerUploadContentRule;
  inspectFile?: ExplorerUploadInspectFile;
  builtinInspector?: ExplorerUploadInspectFile;
}>;

/** No caller-supplied metadata is accepted, and a changed inspector cannot reuse old evidence. */
export function readUploadContentInspection(options: InspectionLookup): ExplorerUploadContentInspectionOutcome | undefined {
  const records = inspectionContexts.get(options.context)?.get(options.file);
  return records?.find(record => record.extension === options.rule.extension && record.kind === options.rule.kind &&
    record.inspectFile === options.inspectFile && record.builtinInspector === options.builtinInspector)?.outcome;
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return;
  const error = new Error("ファイルの内容の確認がキャンセルされました");
  error.name = "AbortError";
  throw error;
}

/** Stop waiting even when a caller's inspector does not itself cooperate with AbortSignal. */
function waitForInspection<T>(result: T | Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => {
      try { throwIfAborted(signal); } catch (error) { reject(error); }
    };
    if (signal.aborted) abort();
    else signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(result).then(value => {
      signal.removeEventListener("abort", abort);
      if (signal.aborted) abort(); else resolve(value);
    }, error => {
      signal.removeEventListener("abort", abort);
      reject(error);
    });
  });
}

/** Inspect before committing; cache validated metadata, then apply the current threshold. */
export async function ensureUploadContentInspection(
  options: InspectionLookup & Readonly<{ signal: AbortSignal }>,
): Promise<ExplorerUploadContentRejectionReason | undefined> {
  const { context, file, rule, inspectFile, builtinInspector, signal } = options;
  const cache = inspectionContexts.get(context);
  if (!cache) throw new Error("内容検査のコンテキストを createExplorerUploadInspectionContext で作成してください");
  throwIfAborted(signal);
  const existing = readUploadContentInspection(options);
  if (existing) return existing.status === "failed" ? existing.reason : compareUploadContentMetadata(rule, existing.metadata);
  const request: ExplorerUploadInspectFileRequest = Object.freeze({ file, extension: rule.extension, kind: rule.kind, signal });
  const recordOutcome = (outcome: ExplorerUploadContentInspectionOutcome) => {
    throwIfAborted(signal);
    const records = cache.get(file) ?? [];
    records.push(Object.freeze({ extension: rule.extension, kind: rule.kind, inspectFile, builtinInspector, outcome: Object.freeze(outcome) }));
    cache.set(file, records);
  };
  const failed = (cause?: unknown) => {
    const reason = Object.freeze(contentInspectionFailedRejection(rule, cause));
    recordOutcome({ status: "failed", reason });
    return reason;
  };
  try {
    let result = inspectFile ? await waitForInspection(inspectFile(request), signal) : undefined;
    throwIfAborted(signal);
    if (result === undefined && builtinInspector) result = await waitForInspection(builtinInspector(request), signal);
    throwIfAborted(signal);
    const metadata = normalizedMetadata(rule.kind, result);
    if (!metadata) return failed();
    recordOutcome({ status: "completed", metadata });
    return compareUploadContentMetadata(rule, metadata);
  } catch (error) {
    throwIfAborted(signal);
    return failed(error);
  }
}
