import type { CSSProperties, Ref } from "react";
import type { MaybePromise, OperationContext, RibbonDisplayMode, SaveHandler } from "./core";
import type { DocumentCommand, DocumentCommandResult, DocumentModel, DocumentSelection } from "./model/types";

export type { DocumentSelection } from "./model/types";
/** View-only ribbon presentation, shared with the other Office editors. */
export type DocumentRibbonDisplayMode = RibbonDisplayMode;
export type DocumentImportOptions = { /** 1-based page delimited by explicit page_break nodes. */ pageNumber?: number };
export type DocumentFeatures = Partial<Record<"text" | "formatting" | "lists" | "tables" | "images" | "shapes" | "pageLayout" | "import" | "export" | "history", boolean>>;
export type DocumentEvent =
  | { type: "change"; source: "command" | "import" | "undo" | "redo" | "save"; document: DocumentModel }
  | { type: "save"; phase: "start" | "success" | "error" | "cancelled"; error?: string }
  | { type: "import" | "export"; format: "dcon" | "docx"; warnings: readonly string[] }
  | { type: "edit-mode"; mode: "view" | "requesting" | "edit" };
export type DocumentHandle = {
  getDocument(): DocumentModel;
  getRibbonDisplayMode(): DocumentRibbonDisplayMode;
  /** true means the request was accepted; controlled mode still requires a prop update. */
  setRibbonDisplayMode(mode: DocumentRibbonDisplayMode): boolean;
  getSelection(): DocumentSelection;
  select(selection: DocumentSelection): void;
  /** Navigate without editing; false means invalid page or detached handle. */
  goToPage(pageNumber: number): boolean;
  execute(command: DocumentCommand | readonly DocumentCommand[]): Promise<DocumentCommandResult | null>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  save(): Promise<boolean>;
  discard(): void;
  importNative(input: string | Blob, options?: DocumentImportOptions): Promise<void>;
  exportNative(): Promise<Blob>;
  importDocx(input: Blob | ArrayBuffer | Uint8Array, options?: DocumentImportOptions): Promise<void>;
  exportDocx(): Promise<Blob>;
};
export type DocumentProps = {
  ref?: Ref<DocumentHandle>;
  /** Initial local document. Later changes should use ref.execute(document.replace). */
  initialDocument?: DocumentModel;
  /** Read once at mount. Uses explicit page breaks, not Word's automatic pagination. */
  initialPageNumber?: number;
  /** Omission makes the view read-only. Return a document to reconcile server changes. */
  onSave?: SaveHandler<DocumentModel>;
  onBeforeSave?: (document: DocumentModel) => MaybePromise<boolean | void>;
  onEditRequest?: (request: { document: DocumentModel }, context: OperationContext) => MaybePromise<boolean>;
  onChange?: (document: DocumentModel) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSelectionChange?: (selection: DocumentSelection) => void;
  onEvent?: (event: DocumentEvent) => MaybePromise<void>;
  /** Initial view-only mode. Read once at mount; defaults to expanded. */
  initialRibbonDisplayMode?: DocumentRibbonDisplayMode;
  /** Controlled mode. Without a change callback, user/ref requests are disabled. */
  ribbonDisplayMode?: DocumentRibbonDisplayMode;
  onRibbonDisplayModeChange?: (mode: DocumentRibbonDisplayMode) => void;
  readOnly?: boolean;
  warnOnUnsavedChanges?: boolean;
  features?: DocumentFeatures;
  colorMode?: "light" | "dark" | "system";
  primaryColor?: string;
  title?: string;
  exportFileName?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};

/** Controlled, static preview of an explicit-break page. No editing handle is exposed. */
export type DocumentThumbnailProps = Pick<DocumentProps, "title" | "colorMode" | "primaryColor" | "className" | "style" | "aria-label"> & {
  document: DocumentModel;
  /** 1-based explicit-break page. Defaults to 1. */
  pageNumber?: number;
  onError?: (error: Error) => void;
};
