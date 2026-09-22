export type WhiteboardElementKind = "sticky" | "text" | "rectangle" | "ellipse" | "image";
export type WhiteboardElementBase = { id: string; x: number; y: number; width: number; height: number };
export type WhiteboardTextElement = WhiteboardElementBase & { kind: "sticky" | "text" | "rectangle" | "ellipse"; text: string; fill: string; stroke: string; textColor: string; fontSize: number };
export type WhiteboardImageElement = WhiteboardElementBase & { kind: "image"; src: string; alt: string };
export type WhiteboardElement = WhiteboardTextElement | WhiteboardImageElement;
export type WhiteboardModel = { format: "likex.whiteboard"; version: 1; id: string; title: string; elements: WhiteboardElement[] };
export type WhiteboardElementInput = (Partial<WhiteboardTextElement> & { kind?: WhiteboardTextElement["kind"] }) | (Partial<WhiteboardImageElement> & { kind: "image"; src: string });
export type WhiteboardElementPatch = Partial<Omit<WhiteboardTextElement, "id" | "kind">> & Partial<Pick<WhiteboardImageElement, "src" | "alt">>;
export type WhiteboardInput = Partial<Pick<WhiteboardModel, "id" | "title">> & { elements?: WhiteboardElementInput[] };
export type WhiteboardCommand =
  | { type: "element.add"; element: WhiteboardElementInput }
  | { type: "element.update"; id: string; patch: WhiteboardElementPatch }
  | { type: "element.remove"; ids: readonly string[] }
  | { type: "elements.move"; ids: readonly string[]; dx: number; dy: number }
  | { type: "elements.align"; ids: readonly string[]; alignment: "left" | "center" | "right" | "top" | "middle" | "bottom" }
  | { type: "elements.order"; ids: readonly string[]; position: "front" | "back" }
  | { type: "whiteboard.update"; title: string }
  | { type: "whiteboard.replace"; model: WhiteboardModel };
