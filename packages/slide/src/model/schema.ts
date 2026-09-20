const BASE_KEYS = ["id", "name", "x", "y", "width", "height", "rotation", "opacity", "locked", "type"];
export const ELEMENT_KEYS = {
  text: [...BASE_KEYS, "text", "fontSize", "fontFamily", "color", "bold", "italic", "align", "verticalAlign", "fill"],
  shape: [...BASE_KEYS, "shape", "fill", "stroke", "strokeWidth", "text", "fontSize", "textColor"],
  image: [...BASE_KEYS, "src", "alt"],
} as const;
export const SLIDE_KEYS = ["id", "name", "background", "notes", "elements"];
export const DECK_KEYS = ["format", "version", "id", "title", "width", "height", "slides"];
