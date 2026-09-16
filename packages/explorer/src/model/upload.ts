import { fileExtension } from "./text";
import type { ExplorerEntry } from "./draft";

export type ExplorerUploadInvalidFileBehavior = "reject-batch" | "skip";

/** Restrictions on files newly imported into the local draft. */
export type ExplorerUploadOptions = Readonly<{
  allowedExtensions?: readonly `.${string}`[];
  maxFileSizeBytes?: number;
  /** Matching suffixes override maxFileSizeBytes; the longest compound suffix wins. */
  maxFileSizeBytesByExtension?: Readonly<Record<`.${string}`, number>>;
  /** Files actually added or overwritten by one import, excluding rejected or skipped files. */
  maxFilesPerUpload?: number;
  /** Files across the entire draft, including unsaved additions. */
  maxTotalFiles?: number;
  invalidFileBehavior?: ExplorerUploadInvalidFileBehavior;
}>;

export type ResolvedExplorerUploadOptions = Readonly<{
  allowedExtensions: readonly `.${string}`[] | undefined;
  maxFileSizeBytes: number | undefined;
  maxFileSizeBytesByExtension?: Readonly<Record<`.${string}`, number>>;
  maxFilesPerUpload?: number;
  maxTotalFiles?: number;
  invalidFileBehavior: ExplorerUploadInvalidFileBehavior;
  accept: string | undefined;
}>;

export type ExplorerUploadRejectionReason =
  | Readonly<{
      code: "extension-not-allowed";
      allowedExtensions: readonly string[];
      message: string;
    }>
  | Readonly<{
      code: "file-too-large";
      maxFileSizeBytes: number;
      message: string;
    }>
  | Readonly<{
      code: "upload-file-count-exceeded";
      maxFilesPerUpload: number;
      message: string;
    }>
  | Readonly<{
      code: "total-file-count-exceeded";
      maxTotalFiles: number;
      message: string;
    }>;

export type ExplorerUploadRejection = Readonly<{
  file: File;
  name: string;
  relativePath: string;
  extension: string;
  size: number;
  reasons: readonly ExplorerUploadRejectionReason[];
}>;

export type ExplorerUploadResult = Readonly<{
  attemptedCount: number;
  addedCount: number;
  overwrittenCount: number;
  /** Files explicitly skipped at a name conflict, excluding validation rejections. */
  skippedCount: number;
  rejections: readonly ExplorerUploadRejection[];
}>;

/** Work completed so far while inspecting or preparing a local import, not byte transfer. */
export type ExplorerImportProgress = Readonly<{
  phase: "discovering" | "checking" | "preparing";
  completed: number;
  /** Directory enumeration cannot know its total until every reader is exhausted. */
  total?: number;
}>;

export type ExplorerUploadConflict = Readonly<{
  /** Position in the original input batch, including inputs rejected by validation. */
  fileIndex: number;
  relativePath: string;
  file: File;
  existing: ExplorerEntry;
}>;

export type ExplorerUploadDecision = Readonly<{
  fileIndex: number;
  existing: ExplorerEntry;
  action: "overwrite" | "skip";
}>;

function cloneUploadConflict(conflict: ExplorerUploadConflict): ExplorerUploadConflict {
  return {
    ...conflict,
    existing: {
      ...conflict.existing,
      source: conflict.existing.source ? { ...conflict.existing.source } : null,
    },
  };
}

const uploadSessionBrand: unique symbol = Symbol("ExplorerUploadSession");
const uploadSessions = new WeakSet<object>();

/** An opaque, caller-scoped token that keeps one batch's provisional IDs stable. */
export type ExplorerUploadSession = Readonly<{ [uploadSessionBrand]: true }>;

export function createExplorerUploadSession(): ExplorerUploadSession {
  const session = Object.freeze({ [uploadSessionBrand]: true as const });
  uploadSessions.add(session);
  return session;
}

/** Internal runtime check; callers create tokens through createExplorerUploadSession. */
export function isExplorerUploadSession(value: unknown): value is ExplorerUploadSession {
  return typeof value === "object" && value !== null && uploadSessions.has(value);
}

/** A decision is required before any part of this batch can be committed. */
export class ExplorerUploadConflictError extends Error {
  readonly conflict: ExplorerUploadConflict;
  /** All currently unanswered conflicts, so one apply-all answer can cover them together. */
  readonly conflicts: readonly ExplorerUploadConflict[];
  readonly session: ExplorerUploadSession;
  /** One-based position among name conflicts, excluding nonconflicting inputs. */
  readonly conflictIndex: number;
  readonly conflictCount: number;

  constructor(
    conflict: ExplorerUploadConflict,
    session = createExplorerUploadSession(),
    conflictIndex = 1,
    conflictCount = 1,
    conflicts: readonly ExplorerUploadConflict[] = [conflict],
  ) {
    super(`「${conflict.relativePath}」と同じ名前のファイルがすでにあります`);
    this.name = "ExplorerUploadConflictError";
    this.session = session;
    this.conflictIndex = conflictIndex;
    this.conflictCount = conflictCount;
    this.conflict = cloneUploadConflict(conflict);
    this.conflicts = conflicts.map(cloneUploadConflict);
  }
}

function normalizeUploadExtension(value: unknown, label: string): `.${string}` {
  if (typeof value !== "string")
    throw new Error(`${label}は .pdf のように先頭にピリオドを付けて指定してください`);
  const extension = value.trim().normalize("NFC").toLowerCase();
  if (!extension.startsWith(".") || extension.slice(1).split(".").some(part => !part) ||
    /[\s\\/:*?"<>|,;\u0000-\u001f\u007f]/.test(extension) ||
    ["[", "]", "{", "}"].some(character => extension.includes(character)))
    throw new Error(`${label}「${value}」を確認してください。 .pdf や .tar.gz の形式で指定できます`);
  return extension as `.${string}`;
}

function validateUploadLimit(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
    throw new Error(`${label} は0以上の安全な整数で指定してください`);
  return value;
}

function normalizeExtensionSizeLimits(value: unknown): Readonly<Record<`.${string}`, number>> {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null))
    throw new Error("maxFileSizeBytesByExtension は拡張子をキーとするプレーンオブジェクトで指定してください");
  const limits: Record<`.${string}`, number> = {};
  for (const key of Reflect.ownKeys(value)) {
    const extension = normalizeUploadExtension(key, "サイズ制限の拡張子");
    const limit = validateUploadLimit((value as Record<PropertyKey, unknown>)[key], `maxFileSizeBytesByExtension[${String(key)}]`);
    if (Object.hasOwn(limits, extension) && limits[extension] !== limit)
      throw new Error(`拡張子「${extension}」に異なるサイズ制限が重複して指定されています`);
    limits[extension] = limit;
  }
  return Object.freeze(limits);
}

/** Normalize caller configuration without retaining caller-owned arrays or maps. */
export function resolveUploadOptions(options?: ExplorerUploadOptions): ResolvedExplorerUploadOptions {
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options)))
    throw new Error("アップロードの設定をオブジェクトで指定してください");
  let allowedExtensions: readonly `.${string}`[] | undefined;
  if (options?.allowedExtensions !== undefined) {
    if (!Array.isArray(options.allowedExtensions))
      throw new Error("allowedExtensions は拡張子の配列で指定してください");
    const extensions = new Set<`.${string}`>();
    for (const value of options.allowedExtensions) extensions.add(normalizeUploadExtension(value, "許可する拡張子"));
    allowedExtensions = Object.freeze([...extensions]);
  }
  const maxFileSizeBytes = options?.maxFileSizeBytes;
  if (maxFileSizeBytes !== undefined) validateUploadLimit(maxFileSizeBytes, "maxFileSizeBytes");
  const extensionLimits = options?.maxFileSizeBytesByExtension;
  const maxFileSizeBytesByExtension = extensionLimits === undefined ? undefined : normalizeExtensionSizeLimits(extensionLimits);
  const maxFilesPerUpload = options?.maxFilesPerUpload;
  if (maxFilesPerUpload !== undefined) validateUploadLimit(maxFilesPerUpload, "maxFilesPerUpload");
  const maxTotalFiles = options?.maxTotalFiles;
  if (maxTotalFiles !== undefined) validateUploadLimit(maxTotalFiles, "maxTotalFiles");
  const invalidFileBehavior = options?.invalidFileBehavior;
  if (invalidFileBehavior !== undefined && invalidFileBehavior !== "reject-batch" && invalidFileBehavior !== "skip")
    throw new Error('invalidFileBehavior は "reject-batch" または "skip" で指定してください');
  return {
    allowedExtensions,
    maxFileSizeBytes,
    ...(maxFileSizeBytesByExtension ? { maxFileSizeBytesByExtension } : {}),
    ...(maxFilesPerUpload === undefined ? {} : { maxFilesPerUpload }),
    ...(maxTotalFiles === undefined ? {} : { maxTotalFiles }),
    invalidFileBehavior: invalidFileBehavior ?? "reject-batch",
    // An empty accept attribute cannot prohibit every file; validation does.
    accept: allowedExtensions?.length ? allowedExtensions.join(",") : undefined,
  };
}

/** Isolate descriptions at each error/observer boundary while retaining browser Files. */
export function cloneUploadRejections(rejections: readonly ExplorerUploadRejection[]): ExplorerUploadRejection[] {
  return rejections.map(rejection => ({
    ...rejection,
    reasons: rejection.reasons.map(reason => reason.code === "extension-not-allowed"
      ? { ...reason, allowedExtensions: [...reason.allowedExtensions] }
      : { ...reason }),
  }));
}

/** Share the same per-file explanation between errors, events and notices. */
export function formatUploadRejections(rejections: readonly ExplorerUploadRejection[]): string {
  return rejections.flatMap(rejection => rejection.reasons.map(reason =>
    `${rejection.relativePath}: ${reason.message}`)).join("\n");
}

/** One rejected batch. Only the browser File instances cross this boundary unchanged. */
export class ExplorerUploadValidationError extends Error {
  readonly rejections: readonly ExplorerUploadRejection[];

  constructor(rejections: readonly ExplorerUploadRejection[]) {
    const isolated = cloneUploadRejections(rejections);
    super(formatUploadRejections(isolated));
    this.name = "ExplorerUploadValidationError";
    this.rejections = isolated;
  }
}

/** Describe a rejected input consistently across file validation and import quotas. */
export function createUploadRejection(
  { file, name, relativePath }: Readonly<{ file: File; name: string; relativePath: string }>,
  reasons: readonly ExplorerUploadRejectionReason[],
): ExplorerUploadRejection {
  return { file, name, relativePath, extension: fileExtension(name), size: file.size, reasons };
}

/** Classify each normalized input before allocating any folders or entry IDs. */
export function validateUploadFiles<T extends Readonly<{ file: File; name: string; relativePath: string }>>(
  files: readonly T[],
  options: ResolvedExplorerUploadOptions,
): { accepted: T[]; rejections: ExplorerUploadRejection[] } {
  const accepted: T[] = [];
  const rejections: ExplorerUploadRejection[] = [];
  const extensionLimits = Object.entries(options.maxFileSizeBytesByExtension ?? {})
    .sort(([left], [right]) => right.length - left.length);
  for (const candidate of files) {
    const { file, name } = candidate;
    const extension = fileExtension(name);
    const comparisonName = name.normalize("NFC").toLowerCase();
    const reasons: ExplorerUploadRejectionReason[] = [];
    const allowed = options.allowedExtensions;
    if (allowed && (!extension || !allowed.some(suffix => comparisonName.endsWith(suffix)))) {
      reasons.push({
        code: "extension-not-allowed",
        allowedExtensions: [...allowed],
        message: allowed.length
          ? `許可されていない拡張子です（許可: ${allowed.join("、")}）`
          : "許可された拡張子がないため、ファイルを追加できません",
      });
    }
    const maxFileSizeBytes = (extension ? extensionLimits.find(([suffix]) => comparisonName.endsWith(suffix))?.[1] : undefined)
      ?? options.maxFileSizeBytes;
    if (maxFileSizeBytes !== undefined && file.size > maxFileSizeBytes) {
      reasons.push({
        code: "file-too-large",
        maxFileSizeBytes,
        message: `${file.size}バイトは1ファイルの上限${maxFileSizeBytes}バイトを超えています`,
      });
    }
    if (reasons.length) rejections.push(createUploadRejection(candidate, reasons));
    else accepted.push(candidate);
  }
  if (rejections.length && options.invalidFileBehavior !== "skip")
    throw new ExplorerUploadValidationError(rejections);
  return { accepted, rejections };
}
