import type { MarkdownAction, MarkdownCommandOptions, MarkdownSelection } from "../markdown/index";

/** Source offsets are zero-based UTF-16 positions, with an exclusive end. */
export type TextEditorRange = Readonly<{ from: number; to: number }>;
/** All edits in text.replaceRanges refer to the same pre-command source. */
export type TextEditorRangeEdit = Readonly<{ from: number; to: number; text: string }>;
/** Concrete source language, retained in the saved document. */
export type TextEditorMode = "text" | "markdown" | "json" | "xml" | "yaml";
/** Auto is an input/view preference; saved documents always contain a concrete mode. */
export type TextEditorModeSetting = TextEditorMode | "auto";
export type TextEditorModeOptions = Readonly<{
  mode?: TextEditorModeSetting;
  fileName?: string;
  mimeType?: string;
  fallbackMode?: TextEditorMode;
}>;
/** Formatting affects whitespace only. Auto uses the same filename/MIME detection as the view. */
export type TextEditorFormatOptions = TextEditorModeOptions & Readonly<{
  /**
   * @minimum 1
   * @maximum 8
   */
  indent?: number;
}>;
export type TextEditorFormatResult = Readonly<{ text: string; mode: TextEditorMode; changed: boolean }>;
/** Offsets are zero-based UTF-16; line and column are one-based UTF-16 positions. */
export type TextEditorDiagnostic = Readonly<{ from: number; to: number; line: number; column: number; message: string }>;
export type TextEditorModel = {
  format: "likex.texteditor";
  version: 1;
  id: string;
  title: string;
  mode: TextEditorMode;
  /** The authoritative source, including its exact whitespace and line endings. */
  text: string;
};
export type TextEditorInput = Partial<Pick<TextEditorModel, "id" | "title" | "text">> & {
  mode?: TextEditorModeSetting;
  /** Detection hints are consumed during creation and are not persisted. */
  fileName?: string;
  mimeType?: string;
};
export type TextEditorSearchOptions = {
  query: string;
  caseSensitive?: boolean;
  /** Unicode letters, combining marks, numbers and underscores form words. */
  wholeWord?: boolean;
  /** RE2 syntax: no lookaround or backreferences. */
  regex?: boolean;
};
export type TextEditorCommand =
  | { type: "text.set"; text: string }
  | { type: "text.insert"; offset: number; text: string }
  | { type: "text.replaceRange"; from: number; to: number; text: string }
  | { type: "text.replaceRanges"; edits: readonly TextEditorRangeEdit[] }
  | ({ type: "text.replaceAll"; replacement: string } & TextEditorSearchOptions)
  | { type: "text.format"; mode?: TextEditorMode;
      /**
       * @minimum 1
       * @maximum 8
       */
      indent?: number }
  | { type: "markdown.format"; selection: MarkdownSelection; action: MarkdownAction; options?: MarkdownCommandOptions }
  | { type: "markdown.toggleTask"; position: number }
  | { type: "document.update"; title?: string; mode?: TextEditorMode }
  | { type: "document.replace"; document: TextEditorModel };
