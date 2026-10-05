import type { CSSProperties, Ref } from "react";
import type { SlidePdfLoader } from "./types";

export type SlidePdfViewerHandle = {
  /** One-based page number; 0 until the current PDF has loaded. */
  getPageNumber(): number;
  /** Request a page change. Controlled pageNumber requires onPageChange. */
  goToPage(pageNumber: number): boolean;
  /** Selected one-based pages in document order. Always returns a new array; [] while loading. */
  getSelectedPageNumbers(): number[];
  /** Change selection without navigating. Invalid input is rejected as a whole; [] clears it. Sets the range anchor to the last selected page (or displayed page when empty). */
  selectPages(pageNumbers: readonly number[]): boolean;
  /** Percentage relative to fitting the current page into the viewport. */
  getZoom(): number;
  /** Accepts finite values from 25 to 400, rounded to a whole percentage. */
  setZoom(zoom: number): boolean;
  fitToPage(): boolean;
};
export type SlidePdfViewerProps = {
  ref?: Ref<SlidePdfViewerHandle>;
  /** Keep the loader identity stable until the source PDF changes. The viewer owns and destroys its result. */
  loadPdf: SlidePdfLoader;
  title?: string;
  initialPageNumber?: number;
  /** Controlled page number; omitted for internal navigation. */
  pageNumber?: number;
  /** Navigation requests from the UI/ref. Host prop changes do not repeat this callback. */
  onPageChange?: (event: { pageNumber: number; pageCount: number }) => void;
  /** Initial selection for each loaded PDF. Omitted: select the initial displayed page. */
  initialSelectedPageNumbers?: readonly number[];
  /** Controlled selection. Without onSelectionChange, selection is locked; navigation remains independent. */
  selectedPageNumbers?: readonly number[];
  /** Selection requests from the UI/ref; initial and external prop changes do not notify. Arrays are copies. */
  onSelectionChange?: (event: { pageNumbers: number[]; pageNumber: number; pageCount: number }) => void;
  initialZoom?: number;
  onZoomChange?: (zoom: number) => void;
  onLoad?: (event: { pageCount: number }) => void;
  onError?: (error: Error) => void;
  colorMode?: "light" | "dark" | "system";
  primaryColor?: string;
  className?: string;
  style?: CSSProperties;
  "aria-label"?: string;
  /** Show the previous/next and page-number toolbar. Default: true. */
  toolbarVisible?: boolean;
};
