import type { CSSProperties, Ref } from "react";
import type { MaybePromise, OperationContext, SaveHandler } from "./core";
import type { Slide, SlideElement, SlideCommand, SlideCommandResult, SlideDeck, SlideMaster, SlideLayout } from "./model/types";
import type { SlideAnimationStep, SlideQueryOptions } from "./model";
import type { SlideConditionalEdit, SlideConditionalEditResult, SlideMutationSnapshot, SlideMutationToken } from "./model";
import type { SlidePptxImportOptions } from "./import/import-pptx";
import type { SlidePptxExportOptions } from "./export/types";
import type { SlideImageExportOptions, SlideImagesExportOptions } from "./render/browser-export";
import type { SlideImageResult } from "./render/types";
import type { SlidePptxDiagnostic } from "./office/types";

export type SlideFeatures = Partial<Record<"addSlides" | "deleteSlides" | "reorderSlides" | "text" | "shapes" | "images" | "formatting" | "masters" | "animations" | "notes" | "import" | "export" | "presentation" | "history", boolean>>;
export type SlideConditionalEditOptions = Readonly<{ expected?: SlideMutationToken; signal?: AbortSignal }>;
export type SlideSelection = {
  /** The active page displayed on the canvas. */
  slideId: string;
  elementIds: string[];
  /** Multiple selected pages, in deck order. Omitted for a single page; includes slideId. */
  slideIds?: string[];
};
export type SlideEvent =
  | { type: "change"; source: "command" | "import" | "undo" | "redo"; deck: SlideDeck }
  | { type: "save"; phase: "start" | "success" | "error" | "cancelled"; error?: string }
  | { type: "import"; warnings: readonly string[]; diagnostics?: readonly SlidePptxDiagnostic[] }
  | { type: "conversion"; phase: "import" | "export"; warnings: readonly string[]; diagnostics: readonly SlidePptxDiagnostic[] }
  | { type: "edit-mode"; mode: "view" | "requesting" | "edit" };
export type SlideHandle = {
  /** Defaults to the final static state. Pass includeAnimations:true for editable source data. */
  getDeck(options?: SlideQueryOptions): SlideDeck;
  getSlides(options?: SlideQueryOptions): Slide[];
  getSlide(slideId: string, options?: SlideQueryOptions): Slide | undefined;
  getElements(slideId: string, options?: SlideQueryOptions): SlideElement[];
  getElement(slideId: string, elementId: string, options?: SlideQueryOptions): SlideElement | undefined;
  getAnimations(slideId: string): SlideAnimationStep[];
  getSlideMasters(): SlideMaster[];
  getSlideLayouts(masterId?: string): SlideLayout[];
  getSlideLayout(layoutId: string): SlideLayout | undefined;
  /** Details from the latest successful PPTX import/export; empty before the first conversion. */
  getPptxDiagnostics(): readonly SlidePptxDiagnostic[];
  execute(command: SlideCommand | readonly SlideCommand[]): Promise<SlideCommandResult | null>;
  /** Authored data and session identity for conditional edits (includes animation source data). */
  getMutationSnapshot(): SlideMutationSnapshot;
  /** Atomic compare-and-edit; conflicts make no changes and do not create Undo entries. */
  executeConditional(edit: SlideConditionalEdit, options?: SlideConditionalEditOptions): Promise<SlideConditionalEditResult | null>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  save(): Promise<boolean>;
  discard(): void;
  getSelection(): SlideSelection;
  select(selection: SlideSelection): void;
  /** Delete the selected pages or elements as one undoable edit. At least one page must remain. */
  deleteSelection(scope: "slides" | "elements"): Promise<SlideCommandResult | null>;
  /** Load current .slon JSON as an undoable draft; failures are reported through the editor notice. */
  importNative(input: string | Blob): Promise<void>;
  /** Flush pending input and return current .slon JSON without marking the draft saved. */
  exportNative(): Promise<Blob>;
  importPptx(input: Blob | ArrayBuffer | Uint8Array): Promise<void>;
  /** Import PPTX/POTX master/layout definitions as one undoable edit without replacing pages or selection. */
  importPptxMasters(input: Blob | ArrayBuffer | Uint8Array, options?: SlidePptxImportOptions): Promise<void>;
  /** Cancel a pending master import, including an outstanding edit-permission request. */
  cancelMasterImport(): void;
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
