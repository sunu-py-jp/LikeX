/** All persistent values are JSON: pixels at 96 dpi, degrees clockwise, and sRGB hex colors. */
export type SlideElementBase = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  locked: boolean;
};
export type SlideTextElement = SlideElementBase & {
  type: "text";
  text: string;
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  fill: string;
};
export type SlideShapeKind = "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "arrow" | "line";
export type SlideShapeElement = SlideElementBase & {
  type: "shape";
  shape: SlideShapeKind;
  fill: string;
  stroke: string;
  strokeWidth: number;
  text: string;
  fontSize: number;
  textColor: string;
};
export type SlideImageElement = SlideElementBase & {
  type: "image";
  /** Embedded PNG/JPEG/GIF/WebP data URL. No remote requests are made when rendering a deck. */
  src: string;
  alt: string;
};
export type SlideElement = SlideTextElement | SlideShapeElement | SlideImageElement;
export type Slide = {
  id: string;
  name: string;
  background: string;
  notes: string;
  elements: SlideElement[];
};
export type SlideDeck = {
  /** Optional for programmatic runtime input; normalized output and native files always include it. */
  format?: "likex.slide";
  version: 1;
  id: string;
  title: string;
  width: number;
  height: number;
  slides: Slide[];
};
export type SlideElementInput =
  | ({ type: "text" } & Partial<Omit<SlideTextElement, "type">>)
  | ({ type: "shape" } & Partial<Omit<SlideShapeElement, "type">>)
  | ({ type: "image"; src: string } & Partial<Omit<SlideImageElement, "type" | "src">>);
/** Fields are validated against the target element's type when the command is applied. */
export type SlideElementPatch = Partial<
  Omit<SlideTextElement, "id" | "type"> &
  Omit<SlideShapeElement, "id" | "type"> &
  Omit<SlideImageElement, "id" | "type">
>;
export type SlideCommand =
  | { type: "deck.rename"; title: string }
  | { type: "deck.resize"; width: number; height: number }
  | { type: "slide.add"; afterId?: string; slide?: Partial<Slide> }
  | { type: "slide.delete"; slideId: string }
  | { type: "slide.duplicate"; slideId: string }
  | { type: "slide.move"; slideId: string; index: number }
  | { type: "slide.update"; slideId: string; patch: Partial<Pick<Slide, "name" | "background" | "notes">> }
  | { type: "element.add"; slideId: string; element: SlideElementInput }
  | { type: "element.update"; slideId: string; elementId: string; patch: SlideElementPatch }
  | { type: "element.delete"; slideId: string; elementIds: string[] }
  | { type: "element.duplicate"; slideId: string; elementIds: string[] }
  | { type: "element.order"; slideId: string; elementIds: string[]; direction: "front" | "back" | "forward" | "backward" };
export type SlideCommandResult = { deck: SlideDeck; slideId?: string; elementIds: string[]; changed: boolean };
