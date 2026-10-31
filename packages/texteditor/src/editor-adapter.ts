import type { Ref } from "react";
import type { TextEditorSearchOptions } from "./model/types";

/** Search panel options use JavaScript regular expressions, like the on-screen search. */
export type TextEditorSearchQuery = TextEditorSearchOptions & { replacement?: string };
export type TextEditorSearchDisplay = { open?: boolean; replace?: boolean };
export type TextEditorPanel = "search" | "goToLine" | "commandPalette" | "link" | "blocks";
export type TextEditorSearchState = Readonly<{
  query: string; replacement: string; caseSensitive: boolean; wholeWord: boolean; regex: boolean;
  open: boolean; replace: boolean; valid: boolean;
}>;

/** Source/formatted positions are UTF-16 offsets into the corresponding displayed text; rich positions are ProseMirror document positions. */
export type TextEditorSelection = {
  coordinateSpace: "source" | "rich" | "formatted";
  ranges: readonly { anchor: number; head: number }[];
  mainIndex: number;
};
export type TextEditorAction =
  | "selectAll" | "selectLine" | "selectNextOccurrence" | "selectAllOccurrences"
  | "addCursorAbove" | "addCursorBelow" | "simplifySelection"
  | "moveLineUp" | "moveLineDown" | "copyLineUp" | "copyLineDown" | "deleteLine"
  | "indent" | "outdent" | "undo" | "redo" | "find" | "replace" | "findNext" | "findPrevious"
  | "goToLine" | "selectParentSyntax" | "cursorMatchingBracket" | "toggleWordWrap" | "commandPalette"
  | "closeSearch" | "replaceNext" | "replaceAll" | "selectSearchMatches"
  | "markdown.paragraph" | "markdown.heading1" | "markdown.heading2" | "markdown.heading3"
  | "markdown.bulletList" | "markdown.orderedList" | "markdown.quote" | "markdown.codeBlock"
  | "markdown.taskList" | "markdown.divider" | "markdown.bold" | "markdown.italic" | "markdown.code" | "markdown.link";
export type EditorAdapterHandle = {
  isReady?(): boolean;
  focus(): void;
  runCommand(command: TextEditorAction): boolean;
  getSelection(): TextEditorSelection;
  setSelection(selection: TextEditorSelection): void;
  goToLine(line: number, column?: number): boolean;
  setSearch?(query: TextEditorSearchQuery, display?: TextEditorSearchDisplay): boolean;
  getSearch?(): TextEditorSearchState;
  getOpenPanels?(): readonly TextEditorPanel[];
  closePanel?(panel: TextEditorPanel): boolean;
};
export type EditorAdapterProps = {
  value: string;
  editable: boolean;
  searchEnabled?: boolean;
  replaceEnabled?: boolean;
  formattingEnabled?: boolean;
  onChange(value: string): Promise<boolean>;
  /** Current visible draft, including edits awaiting host permission. Never commits the model. */
  onDisplayTextChange?(value: string): void;
  onSelectionChange?(selection: TextEditorSelection): void;
  onSearchChange?(search: TextEditorSearchState): void;
  onPanelsChange?(panels: readonly TextEditorPanel[]): void;
  onPendingChange?(pending: boolean): void;
  onUndo(): void;
  onRedo(): void;
  onCommandPalette?(): void;
  ref?: Ref<EditorAdapterHandle>;
};
