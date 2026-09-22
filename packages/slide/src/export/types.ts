/** Portable export options shared by the browser and headless entry points. */
export type SlidePptxExportOptions = {
  /** Reports conversion losses. Animation timing is flattened to its final static state. */
  onWarning?: (warning: string) => void;
};
