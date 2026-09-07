import { fileExtension } from "./text";
import type { ExplorerEntry } from "./draft";

export type ExplorerUploadInvalidFileBehavior = "reject-batch" | "skip";

/** Restrictions on files newly imported into the local draft. */
export type ExplorerUploadOptions = Readonly<{
  allowedExtensions?: readonly `.${string}`[];
  maxFileSizeBytes?: number;
  invalidFileBehavior?: ExplorerUploadInvalidFileBehavior;
}>;

export type ResolvedExplorerUploadOptions = Readonly<{
  allowedExtensions: readonly `.${string}`[] | undefined;
  maxFileSizeBytes: number | undefined;
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

/** Normalize caller configuration without retaining caller-owned arrays. */
export function resolveUploadOptions(options?: ExplorerUploadOptions): ResolvedExplorerUploadOptions {
  if (options !== undefined && (!options || typeof options !== "object" || Array.isArray(options)))
    throw new Error("アップロードの設定をオブジェクトで指定してください");
  let allowedExtensions: readonly `.${string}`[] | undefined;
  if (options?.allowedExtensions !== undefined) {
    if (!Array.isArray(options.allowedExtensions))
      throw new Error("allowedExtensions は拡張子の配列で指定してください");
    const extensions = new Set<`.${string}`>();
    for (const value of options.allowedExtensions) {
      if (typeof value !== "string")
        throw new Error("許可する拡張子は .pdf のように先頭にピリオドを付けて指定してください");
      const extension = value.trim().normalize("NFC").toLowerCase();
      if (!extension.startsWith(".") || extension.slice(1).split(".").some(part => !part) ||
        /[\s\\/:*?"<>|,;\u0000-\u001f\u007f]/.test(extension) ||
        ["[", "]", "{", "}"].some(character => extension.includes(character)))
        throw new Error(`許可する拡張子「${value}」を確認してください。 .pdf や .tar.gz の形式で指定できます`);
      extensions.add(extension as `.${string}`);
    }
    allowedExtensions = Object.freeze([...extensions]);
  }
  const maxFileSizeBytes = options?.maxFileSizeBytes;
  if (maxFileSizeBytes !== undefined && (!Number.isSafeInteger(maxFileSizeBytes) || maxFileSizeBytes < 0))
    throw new Error("maxFileSizeBytes は0以上の安全な整数で指定してください");
  const invalidFileBehavior = options?.invalidFileBehavior;
  if (invalidFileBehavior !== undefined && invalidFileBehavior !== "reject-batch" && invalidFileBehavior !== "skip")
    throw new Error('invalidFileBehavior は "reject-batch" または "skip" で指定してください');
  return {
    allowedExtensions,
    maxFileSizeBytes,
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

/** Classify each normalized input before allocating any folders or entry IDs. */
export function validateUploadFiles<T extends Readonly<{ file: File; name: string; relativePath: string }>>(
  files: readonly T[],
  options: ResolvedExplorerUploadOptions,
): { accepted: T[]; rejections: ExplorerUploadRejection[] } {
  const accepted: T[] = [];
  const rejections: ExplorerUploadRejection[] = [];
  for (const candidate of files) {
    const { file, name, relativePath } = candidate;
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
    if (options.maxFileSizeBytes !== undefined && file.size > options.maxFileSizeBytes) {
      reasons.push({
        code: "file-too-large",
        maxFileSizeBytes: options.maxFileSizeBytes,
        message: `${file.size}バイトは1ファイルの上限${options.maxFileSizeBytes}バイトを超えています`,
      });
    }
    if (reasons.length) rejections.push({ file, name, relativePath, extension, size: file.size, reasons });
    else accepted.push(candidate);
  }
  if (rejections.length && options.invalidFileBehavior !== "skip")
    throw new ExplorerUploadValidationError(rejections);
  return { accepted, rejections };
}
