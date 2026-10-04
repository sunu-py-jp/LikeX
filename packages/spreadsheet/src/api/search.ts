import type { ReactNode } from "react";
import type { MaybePromise, OperationContext } from "../core";
import type { SpreadsheetWorkbookSnapshot } from "./types";
import type { SpreadsheetSearchMatch, SpreadsheetSearchQuery } from "./editing-commands";

export type SpreadsheetSearchScope = "sheet" | "workbook";
export type SpreadsheetSearchSettings = Readonly<{
  /** Search as input changes (default), or only after submit. */
  trigger?: "input" | "submit";
  /** Input-trigger delay for external search, including custom inputs. Defaults to 0; local search stays immediate. */
  debounceMs?: number;
  /** Host-owned JSON conditions passed unchanged in meaning to the search handler. */
  params?: Readonly<Record<string, unknown>>;
}>;
export type SpreadsheetSearchRequest = Readonly<{
  workbook: SpreadsheetWorkbookSnapshot;
  query: SpreadsheetSearchQuery;
  scope: SpreadsheetSearchScope;
  sheetId?: string;
  params?: Readonly<Record<string, unknown>>;
}>;
export type SpreadsheetSearchHandler = (request: SpreadsheetSearchRequest, context: Pick<OperationContext, "signal">) => MaybePromise<readonly SpreadsheetSearchMatch[]>;
export type SpreadsheetSearchRenderContext = Readonly<{
  defaultInput: ReactNode;
  defaultOptions: ReactNode;
  defaultReplacement: ReactNode;
  query: SpreadsheetSearchQuery;
  setQuery: (query: SpreadsheetSearchQuery) => void;
  scope: SpreadsheetSearchScope;
  setScope: (scope: SpreadsheetSearchScope) => void;
  replacement: string;
  setReplacement: (replacement: string) => void;
  mode: "find" | "replace";
  submit: () => void;
  clear: () => void;
  searching: boolean;
  /** Draft conditions differ from the last submitted search. Results remain visible; replacement waits for submit. */
  pending: boolean;
  error: string | null;
  disabled: boolean;
  results: readonly SpreadsheetSearchMatch[];
  /** Custom text inputs must forward composition events to defer IME searches. */
  onCompositionStart: () => void;
  onCompositionEnd: () => void;
}>;
