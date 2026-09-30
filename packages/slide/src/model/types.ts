import type { ConnectorEndpoint, ConnectorArrowhead } from "./core-connectors";
export type { ConnectorPoint, ConnectorPort, ConnectorBinding, ConnectorEndpoint, ConnectorArrowhead } from "./core-connectors";
export type SlideLineGeometry = { start: ConnectorEndpoint; end: ConnectorEndpoint };
/** All persistent values are JSON: pixels at 96 dpi, degrees clockwise, and sRGB hex colors. */
export type SlideElementBase = {
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  /** @minimum 0
   * @maximum 1 */
  opacity: number;
  locked: boolean;
  /** Links a local editable element to one slot of its page's layout. */
  layoutPlaceholderId?: string;
};
export type SlideTextElement = SlideElementBase & {
  type: "text";
  text: string;
  /** @minimum 1
   * @maximum 1000 */
  fontSize: number;
  fontFamily: string;
  color: string;
  bold: boolean;
  italic: boolean;
  align: "left" | "center" | "right";
  verticalAlign: "top" | "middle" | "bottom";
  fill: string;
};
export type SlideShapeKind = "rect" | "roundRect" | "ellipse" | "triangle" | "diamond" | "arrow" | "leftArrow" | "line";
export type SlideShapeElement = SlideElementBase & {
  type: "shape";
  shape: SlideShapeKind;
  /** Only shape:line. Absolute document coordinates; bound points follow their target. */
  line?: SlideLineGeometry;
  /** Line endpoint decoration. Missing fields preserve legacy plain lines. */
  startArrow?: ConnectorArrowhead;
  endArrow?: ConnectorArrowhead;
  fill: string;
  stroke: string;
  /** @minimum 0
   * @maximum 100 */
  strokeWidth: number;
  text: string;
  /** @minimum 1
   * @maximum 1000 */
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
/** Only properties supported by the referenced element type may be animated. */
export type SlideAnimationProperties = Partial<Pick<SlideElementBase, "x" | "y" | "width" | "height" | "rotation" | "opacity"> & {
  fontSize: number; strokeWidth: number; fill: string; stroke: string; color: string; textColor: string;
}>;
export type SlideAnimationEasing = "linear" | "ease-in" | "ease-out" | "ease-in-out" | "spring" | "bounce";
export type SlideAnimationNode =
  | { type: "sequence" | "parallel"; children: SlideAnimationNode[] }
  | { type: "tween"; elementId: string; durationMs: number; delayMs?: number; easing?: SlideAnimationEasing;
    from?: SlideAnimationProperties; to: SlideAnimationProperties; repeat?: number; yoyo?: boolean };
export type SlideAnimationTrigger = { type: "immediate" } | { type: "after-delay"; delayMs: number } | { type: "click"; elementId?: string };
/** Steps in the same timeline run sequentially; omitted timelineId selects the main timeline. */
export type SlideAnimationStep = { id: string; name?: string; timelineId?: string; trigger?: SlideAnimationTrigger; animation: SlideAnimationNode };
export type SlideQueryOptions = { includeAnimations?: boolean };
export type SlideAnimationClick = { elapsedMs: number; elementId?: string };
export type SlideAnimationEvaluationOptions = { elapsedMs: number; clicks?: SlideAnimationClick[] };
export type SlideAnimationWaitingStep = { stepId: string; timelineId?: string; waitingTargetId?: string };
export type SlideAnimationActiveStep = { stepId: string; timelineId?: string; stepStartMs: number; stepEndMs: number };
export type SlideAnimationFrame = {
  /** waitingForClick is true if any timeline waits, even while another is active. */
  slide: Slide; finished: boolean; waitingForClick: boolean; stepId?: string;
  /** Legacy singular fields describe the first waiting step, otherwise the first active step, in authored order. Times are page-relative. */
  stepStartMs?: number; stepEndMs?: number; waitingTargetId?: string;
  /** Present for named/independent timelines; legacy main-only frames keep their original shape. */
  waitingSteps?: readonly SlideAnimationWaitingStep[];
  /** Includes scheduled delays; motion can continue while another timeline waits for a click. */
  activeSteps?: readonly SlideAnimationActiveStep[];
};
export type Slide = {
  id: string;
  name: string;
  background: string;
  notes: string;
  elements: SlideElement[];
  animations?: SlideAnimationStep[];
  layoutId?: string;
  inheritBackground?: boolean;
  showMasterShapes?: boolean;
};
export type SlideMaster = { id: string; name: string; background: string; elements: SlideElement[] };
export type SlideLayoutPlaceholder = { id: string; kind: string; element: SlideElement };
export type SlideLayout = { id: string; masterId: string; name: string; background?: string; elements: SlideElement[];
  placeholders: SlideLayoutPlaceholder[]; showMasterShapes?: boolean };
export type SlideMasterLibrary = { width: number; height: number; masters: SlideMaster[]; layouts: SlideLayout[] };
export type SlideAppearance = { background: string; inheritedElements: SlideElement[]; localElements: SlideElement[] };
export type SlideDeck = {
  /** Optional for programmatic runtime input; normalized output and native files always include it. */
  format?: "likex.slide";
  version: 1;
  id: string;
  title: string;
  width: number;
  height: number;
  slides: Slide[];
  masters?: SlideMaster[];
  layouts?: SlideLayout[];
};
export type SlideElementInput =
  | ({ type: "text" } & Partial<Omit<SlideTextElement, "type">>)
  | ({ type: "shape" } & Partial<Omit<SlideShapeElement, "type">>)
  | ({ type: "image"; src: string } & Partial<Omit<SlideImageElement, "type" | "src">>);
/** Fields are validated against the target element's type when the command is applied. */
export type SlideElementPatch =
  | Partial<Omit<SlideTextElement, "id" | "type">>
  | Partial<Omit<SlideShapeElement, "id" | "type">>
  | Partial<Omit<SlideImageElement, "id" | "type">>;
export type SlideCompositionPreset = "executive" | "editorial" | "contrast";
export type SlideCompositionBase = { title: string; eyebrow?: string; subtitle?: string; footer?: string };
/** Semantic content, expanded into ordinary editable elements when applied. */
export type SlideComposition = SlideCompositionBase & (
  | { kind: "hero"; highlights?: string[] }
  | { kind: "comparison"; before: { title: string; body: string }; after: { title: string; body: string } }
  | { kind: "features"; items: { title: string; body: string }[] }
  | { kind: "flow"; steps: { title: string; body: string }[] }
  | { kind: "architecture"; columns: { title: string; nodes: { id: string; title: string; body?: string }[] }[];
      connections: { from: string; to: string; label?: string }[] }
  | { kind: "closing"; action: string; details?: string }
);
export type SlideCommand =
  | { type: "deck.rename"; title: string }
  | { type: "deck.resize"; width: number; height: number }
  | { type: "masters.import"; library: SlideMasterLibrary }
  | { type: "slide.add"; afterId?: string; slide?: Partial<Slide>; layoutId?: string }
  | { type: "slide.applyLayout"; slideId: string; layoutId: string }
  | { type: "slide.detachLayout"; slideId: string }
  | { type: "slide.delete"; slideId: string }
  | { type: "slide.duplicate"; slideId: string }
  | { type: "slide.move"; slideId: string; index: number }
  | { type: "slide.update"; slideId: string; patch: Partial<Pick<Slide, "name" | "background" | "notes">> }
  /** Rebuild one page atomically. Omitted metadata is kept; omitted animations are cleared. */
  | { type: "slide.replaceContent"; slideId: string; elements: SlideElementInput[]; name?: string; background?: string; notes?: string; animations?: SlideAnimationStep[] }
  /** Compose one page with deterministic geometry; preserves its master/layout and metadata. */
  | { type: "slide.compose"; slideId: string; composition: SlideComposition; preset?: SlideCompositionPreset; notes?: string }
  | { type: "animation.set"; slideId: string; animations: SlideAnimationStep[] }
  | { type: "animation.remove"; slideId: string; animationId: string }
  | { type: "line.add"; slideId: string; start: ConnectorEndpoint; end: ConnectorEndpoint; id?: string; name?: string; stroke?: string; strokeWidth?: number; startArrow?: ConnectorArrowhead; endArrow?: ConnectorArrowhead }
  | { type: "line.update"; slideId: string; elementId: string; start?: ConnectorEndpoint; end?: ConnectorEndpoint; startArrow?: ConnectorArrowhead; endArrow?: ConnectorArrowhead }
  | { type: "element.add"; slideId: string; element: SlideElementInput }
  | { type: "element.update"; slideId: string; elementId: string; patch: SlideElementPatch }
  | { type: "element.delete"; slideId: string; elementIds: string[] }
  | { type: "element.duplicate"; slideId: string; elementIds: string[] }
  | { type: "element.order"; slideId: string; elementIds: string[]; direction: "front" | "back" | "forward" | "backward" };
export type SlideCommandResult = { deck: SlideDeck; slideId?: string; elementIds: string[]; changed: boolean; masterIds?: string[]; layoutIds?: string[] };
