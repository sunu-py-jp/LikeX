import type { CSSProperties, Ref } from "react";
import type { MaybePromise, OperationContext, SaveHandler } from "./core";
import type { Slide, SlideElement, SlideCommand, SlideCommandResult, SlideDeck } from "./model/types";
import type { SlideAnimationStep, SlideQueryOptions } from "./model";
import type { SlidePptxExportOptions } from "./export/types";
import type { SlideImageExportOptions, SlideImagesExportOptions } from "./render/browser-export";
import type { SlideImageResult } from "./render/types";

export type SlideFeatures = Partial<Record<"addSlides" | "deleteSlides" | "reorderSlides" | "text" | "shapes" | "images" | "formatting" | "animations" | "notes" | "import" | "export" | "presentation" | "history", boolean>>;
export type SlideSelection = { slideId: string; elementIds: string[] };
export type SlideEvent =
  | { type: "change"; source: "command" | "import" | "undo" | "redo"; deck: SlideDeck }
  | { type: "save"; phase: "start" | "success" | "error" | "cancelled"; error?: string }
  | { type: "import"; warnings: readonly string[] }
  | { type: "edit-mode"; mode: "view" | "requesting" | "edit" };
export type SlideHandle = {
  /** Defaults to the final static state. Pass includeAnimations:true for editable source data. */
  getDeck(options?: SlideQueryOptions): SlideDeck;
  getSlides(options?: SlideQueryOptions): Slide[];
  getSlide(slideId: string, options?: SlideQueryOptions): Slide | undefined;
  getElements(slideId: string, options?: SlideQueryOptions): SlideElement[];
  getElement(slideId: string, elementId: string, options?: SlideQueryOptions): SlideElement | undefined;
  getAnimations(slideId: string): SlideAnimationStep[];
  execute(command: SlideCommand | readonly SlideCommand[]): Promise<SlideCommandResult | null>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  save(): Promise<boolean>;
  discard(): void;
  getSelection(): SlideSelection;
  select(selection: SlideSelection): void;
  /** Load current .slon JSON as an undoable draft; failures are reported through the editor notice. */
  importNative(input: string | Blob): Promise<void>;
  /** Flush pending input and return current .slon JSON without marking the draft saved. */
  exportNative(): Promise<Blob>;
  importPptx(input: Blob | ArrayBuffer | Uint8Array): Promise<void>;
  exportPptx(options?: SlidePptxExportOptions): Promise<Blob>;
  /** Flush pending input and return one PNG without changing selection or marking the draft saved. */
  exportImage(options: SlideImageExportOptions): Promise<SlideImageResult<Blob>>;
  /** Inclusive range, ordered page/ID list, or all pages if selectors are omitted. */
  exportImages(options?: SlideImagesExportOptions): Promise<SlideImageResult<Blob>[]>;
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
  /** Download basename for .slon and .pptx; an existing .slon/.json/.pptx suffix is replaced. */
  exportFileName?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
};
