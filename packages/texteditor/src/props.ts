import type { CSSProperties, ReactNode, Ref } from "react";
import type { ModelEditorOptions } from "./core";
import type { TextEditorCommand, TextEditorModel, TextEditorMode, TextEditorSearchOptions, TextEditorRange } from "./model/types";
import type { TextEditorAction, TextEditorSelection, TextEditorSearchQuery, TextEditorSearchDisplay, TextEditorSearchState } from "./editor-adapter";

export type TextEditorViewMode = "source" | "rich";
export type TextEditorViewState = Readonly<{
  mode: TextEditorMode; viewMode: TextEditorViewMode; wordWrap: boolean;
  readOnly: boolean; editable: boolean; busy: boolean; dirty: boolean;
  canSave: boolean; canUndo: boolean; canRedo: boolean;
  features: Readonly<Record<TextEditorFeature, boolean>>;
}>;
export type TextEditorImportOptions = { title?: string; mode?: TextEditorMode };
export type TextEditorExport = { blob: Blob; fileName: string };

export type TextEditorFeature = "editing" | "history" | "import" | "export";
/** View-only header customization. Operations use the mounted editor's permission and history paths. */
export type TextEditorHeaderActionsContext = Readonly<{
  /** Include this node to keep the standard Undo/Redo, read-only indicator and Save controls. */
  defaultActions: ReactNode;
  readOnly: boolean;
  busy: boolean;
  dirty: boolean;
  canSave: boolean;
  canUndo: boolean;
  canRedo: boolean;
  save(): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  runCommand(command: TextEditorAction): Promise<boolean>;
}>;
export type TextEditorHandle = {
  getDocument(): TextEditorModel;
  getText(): string;
  getState(): TextEditorViewState;
  execute(commands: TextEditorCommand | readonly TextEditorCommand[]): Promise<TextEditorModel | null>;
  replace(document: TextEditorModel): Promise<TextEditorModel | null>;
  find(options: TextEditorSearchOptions): readonly TextEditorRange[];
  runCommand(command: TextEditorAction): Promise<boolean>;
  focus(): void;
  getSelection(): TextEditorSelection | null;
  setSelection(selection: TextEditorSelection): boolean;
  goToLine(line: number, column?: number): Promise<boolean>;
  /** Switches only the view. rich requires Markdown mode. Resolves after the adapter is ready. */
  setViewMode(mode: TextEditorViewMode): Promise<boolean>;
  setWordWrap(enabled: boolean): boolean;
  setSearch(query: TextEditorSearchQuery, display?: TextEditorSearchDisplay): Promise<boolean>;
  /** null in rich view. Source search state is reset when switching back from rich view. */
  getSearch(): TextEditorSearchState | null;
  closeSearch(): boolean;
  importFile(file: Blob, options?: TextEditorImportOptions): Promise<TextEditorModel | null>;
  exportFile(): TextEditorExport | null;
  download(): boolean;
  save(): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  cancelPending(): void;
};
export type TextEditorProps = ModelEditorOptions<TextEditorModel, TextEditorFeature> & {
  /** Initial values are read once. Use ref.replace or a React key for another document. */
  initialDocument?: TextEditorModel;
  initialText?: string;
  /** Editing experience. Defaults to initialDocument.mode, or text. Changing it preserves source. */
  mode?: TextEditorMode;
  title?: string;
  /** Show the optional Search/Replace/Commands/import/export toolbar. Defaults to false; shortcuts still work. */
  showToolbar?: boolean;
  /** Replace the right-hand header actions. Include context.defaultActions to augment them, or return null to hide them. */
  renderHeaderActions?(context: TextEditorHeaderActionsContext): ReactNode;
  /** Styles for the shared header only, e.g. backgroundColor and color. Does not change the document or editor body. */
  headerStyle?: CSSProperties;
  initialWordWrap?: boolean;
  initialViewMode?: TextEditorViewMode;
  onSelectionChange?(selection: TextEditorSelection): void;
  onWordWrapChange?(enabled: boolean): void;
  onViewModeChange?(mode: TextEditorViewMode): void;
  colorMode?: "light" | "dark" | "system";
  primaryColor?: string;
  className?: string;
  style?: CSSProperties;
  ref?: Ref<TextEditorHandle>;
};
