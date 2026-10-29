import type { ReactNode } from "react";
import type { ExternalSearchOptions, ExternalSearchResult, MaybePromise, OperationContext, SearchPanelInitialState, SearchPanelMode } from "./core";
import type { TextEditorModel, TextEditorRange, TextEditorSearchOptions } from "./model/types";

/** Source offsets are zero-based UTF-16 positions; `to` is exclusive. */
export type TextEditorSearchResult = ExternalSearchResult<TextEditorRange>;
export type TextEditorExternalSearchOptions = ExternalSearchOptions<TextEditorRange>;
export type TextEditorSearchRequest = Readonly<{
  document: TextEditorModel;
  query: Readonly<TextEditorSearchOptions>;
  params?: Readonly<Record<string, unknown>>;
}>;
/** Host results are navigation targets, never replacement targets. Observe the abort signal. */
export type TextEditorSearchRequestHandler = (request: TextEditorSearchRequest, context: OperationContext) => MaybePromise<readonly TextEditorSearchResult[]>;

export type TextEditorSearchRenderContext = Readonly<{
  open: boolean;
  mode: SearchPanelMode;
  query: Readonly<TextEditorSearchOptions>;
  title: string;
  results: readonly TextEditorSearchResult[];
  activeResultId: string | null;
  busy: boolean;
  error: string | null;
  externalAvailable: boolean;
  /** Changes on an explicit open request so a custom input can restore focus. */
  focusVersion: number;
  setQuery(query: TextEditorSearchOptions): boolean;
  openSearch(query?: string): boolean;
  openExternalSearch(resultId?: string): boolean;
  selectResult(id: string): Promise<boolean>;
  next(): Promise<boolean>;
  previous(): Promise<boolean>;
  close(): boolean;
}>;

export type TextEditorSearchProps = SearchPanelInitialState & {
  externalSearch?: TextEditorExternalSearchOptions;
  /** Replaces the default keyword search with host-provided navigation results. */
  onSearchRequest?: TextEditorSearchRequestHandler;
  /** Forwarded unchanged to onSearchRequest; replace the object when its values change. */
  searchParams?: Readonly<Record<string, unknown>>;
  /** Replaces the compact panel. Returning null intentionally hides its UI. */
  renderSearch?: (context: TextEditorSearchRenderContext) => ReactNode;
};
