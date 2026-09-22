import type { CSSProperties, Ref } from "react";
import type { MaybePromise, OperationContext, SaveHandler } from "./core";
import type { DocumentCommand, DocumentCommandResult, DocumentModel, DocumentSelection } from "./model/types";

export type { DocumentSelection } from "./model/types";
export type DocumentFeatures = Partial<Record<"text" | "formatting" | "lists" | "tables" | "images" | "pageLayout" | "import" | "export" | "history", boolean>>;
export type DocumentEvent =
  | { type: "change"; source: "command" | "import" | "undo" | "redo" | "save"; document: DocumentModel }
  | { type: "save"; phase: "start" | "success" | "error" | "cancelled"; error?: string }
  | { type: "import" | "export"; format: "dcon" | "docx"; warnings: readonly string[] }
  | { type: "edit-mode"; mode: "view" | "requesting" | "edit" };
export type DocumentHandle = {
  getDocument(): DocumentModel;
  getSelection(): DocumentSelection;
  select(selection: DocumentSelection): void;
  execute(command: DocumentCommand | readonly DocumentCommand[]): Promise<DocumentCommandResult | null>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  save(): Promise<boolean>;
  discard(): void;
  importNative(input: string | Blob): Promise<void>;
  exportNative(): Promise<Blob>;
  importDocx(input: Blob | ArrayBuffer | Uint8Array): Promise<void>;
  exportDocx(): Promise<Blob>;
};
export type DocumentProps = {
  ref?: Ref<DocumentHandle>;
  /** Initial local document. Later changes should use ref.execute(document.replace). */
  initialDocument?: DocumentModel;
  /** Omission makes the view read-only. Return a document to reconcile server changes. */
  onSave?: SaveHandler<DocumentModel>;
  onBeforeSave?: (document: DocumentModel) => MaybePromise<boolean | void>;
  onEditRequest?: (request: { document: DocumentModel }, context: OperationContext) => MaybePromise<boolean>;
  onChange?: (document: DocumentModel) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSelectionChange?: (selection: DocumentSelection) => void;
  onEvent?: (event: DocumentEvent) => MaybePromise<void>;
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
