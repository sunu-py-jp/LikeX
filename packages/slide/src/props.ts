import type { CSSProperties, Ref } from "react";
import type { MaybePromise, OperationContext, SaveHandler } from "./core";
import type { SlideCommand, SlideCommandResult, SlideDeck } from "./model/types";

export type SlideFeatures = Partial<Record<"addSlides" | "deleteSlides" | "reorderSlides" | "text" | "shapes" | "images" | "formatting" | "notes" | "import" | "export" | "presentation" | "history", boolean>>;
export type SlideSelection = { slideId: string; elementIds: string[] };
export type SlideEvent =
  | { type: "change"; source: "command" | "import" | "undo" | "redo"; deck: SlideDeck }
  | { type: "save"; phase: "start" | "success" | "error" | "cancelled"; error?: string }
  | { type: "import"; warnings: readonly string[] }
  | { type: "edit-mode"; mode: "view" | "requesting" | "edit" };
export type SlideHandle = {
  getDeck(): SlideDeck;
  execute(command: SlideCommand | readonly SlideCommand[]): Promise<SlideCommandResult | null>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  save(): Promise<boolean>;
  discard(): void;
  getSelection(): SlideSelection;
  select(selection: SlideSelection): void;
  importPptx(input: Blob | ArrayBuffer | Uint8Array): Promise<void>;
  exportPptx(): Promise<Blob>;
};
export type SlideProps = {
  ref?: Ref<SlideHandle>;
  initialDeck?: SlideDeck;
  onSave?: SaveHandler<SlideDeck>;
  onBeforeSave?: (deck: SlideDeck) => MaybePromise<boolean | void>;
  onEditRequest?: (request: { deck: SlideDeck }, context: OperationContext) => MaybePromise<boolean>;
  onChange?: (deck: SlideDeck) => void;
  onDirtyChange?: (dirty: boolean) => void;
  onSelectionChange?: (selection: SlideSelection) => void;
  onEvent?: (event: SlideEvent) => MaybePromise<void>;
  readOnly?: boolean;
  warnOnUnsavedChanges?: boolean;
  features?: SlideFeatures;
  colorMode?: "light" | "dark" | "system";
  /** UI primary color in #RGB or #RRGGBB. Omit for the default orange. Does not change slide contents. */
  primaryColor?: string;
  title?: string;
  exportFileName?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};
