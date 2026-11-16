import type { CSSProperties } from "react";
import { resolveCssColor } from "../../model/css-color";
import { CSS_NAMED_COLORS } from "./named-colors";

type RGB = readonly [number, number, number];
type Color = { rgb: RGB; alpha: number };
type SheetMode = "light" | "dark";
const darkBackground: RGB = [30, 36, 33];
const darkSelection: RGB = [40, 77, 56];
const black: RGB = [0, 0, 0], white: RGB = [255, 255, 255];
const parsedColors = new Map<string, Color | null>();
const fills = new Map<string, string>();
const foregrounds = new Map<string, string>();

/** Cache scalar color conversions only, never workbook objects or mutable styles. */
function remember<T>(cache: Map<string, T>, key: string, value: T): T {
  if (cache.size >= 2048) cache.delete(cache.keys().next().value!);
  cache.set(key, value);
  return value;
}

function parse(value: string): Color | null {
  const key = value.trim().toLowerCase();
  if (parsedColors.has(key)) return parsedColors.get(key)!;
  // The complete keyword set is display-only; Office's existing fallback and
  // conversion behavior remain unchanged for names it does not materialize.
  const source = Object.hasOwn(CSS_NAMED_COLORS, key) ? CSS_NAMED_COLORS[key] : key;
  const color = resolveCssColor(source, "010203");
  // The shared Office parser accepts a fallback. A second sentinel distinguishes
  // an actual #010203 from unresolved host CSS (variables, currentColor, etc.).
  const known = typeof color.rgb === "string" && /^[\da-f]{6}$/i.test(color.rgb) &&
    (color.rgb !== "010203" || resolveCssColor(source, "040506").rgb === "010203");
  return remember(parsedColors, key, known ? {
    rgb: [parseInt(color.rgb.slice(0, 2), 16), parseInt(color.rgb.slice(2, 4), 16), parseInt(color.rgb.slice(4, 6), 16)],
    alpha: color.alpha,
  } : null);
}

const luminance = (rgb: RGB) => rgb.reduce((sum, value, index) => {
  const channel = value / 255;
  return sum + (channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4) * [.2126, .7152, .0722][index];
}, 0);
const mix = (first: RGB, second: RGB, amount: number): RGB => [
  Math.round(first[0] + (second[0] - first[0]) * amount),
  Math.round(first[1] + (second[1] - first[1]) * amount),
  Math.round(first[2] + (second[2] - first[2]) * amount),
];
const contrast = (first: RGB, second: RGB) => {
  const a = luminance(first), b = luminance(second);
  return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
};
const css = ({ rgb, alpha }: Color) => alpha === 1 ?
  `#${rgb.map(channel => channel.toString(16).padStart(2, "0")).join("")}` :
  `rgba(${rgb.join(", ")}, ${alpha})`;

function darken(rgb: RGB, maximum: number): RGB {
  if (luminance(rgb) <= maximum) return rgb;
  let low = 0, high = 1;
  for (let step = 0; step < 14; step++) {
    const middle = (low + high) / 2;
    if (luminance(mix(black, rgb, middle)) <= maximum) low = middle;
    else high = middle;
  }
  return mix(black, rgb, low);
}

function displayFill(value: string): string {
  const cached = fills.get(value); if (cached !== undefined) return cached;
  const color = parse(value), light = color ? luminance(color.rgb) : 0;
  // Compress brightness continuously, retaining dark authored fills and hue.
  // The resulting maximum luminance leaves room for readable text and data bars.
  const result = color && color.alpha && light > .04 ?
    css({ ...color, rgb: darken(color.rgb, .04 + (light - .04) / (1 + 10 * (light - .04))) }) : value;
  return remember(fills, value, result);
}

function readableColor(value: string, backgrounds: readonly RGB[], minimum: number): string {
  const key = `${value}|${backgrounds.map(rgb => rgb.join(",")).join(";")}|${minimum}`;
  const cached = foregrounds.get(key); if (cached !== undefined) return cached;
  const color = parse(value);
  // Transparent text/borders are intentionally invisible. Preserve unsupported
  // CSS expressions for the host rather than substituting a guessed color.
  if (!color || !color.alpha) return remember(foregrounds, key, value);
  const score = (rgb: RGB) => Math.min(...backgrounds.map(background => contrast(mix(background, rgb, color.alpha), background)));
  if (score(color.rgb) >= minimum) return remember(foregrounds, key, value);
  const endpoint = score(white) >= score(black) ? white : black;
  let result = endpoint;
  if (score(endpoint) >= minimum + .01) {
    let low = 0, high = 1;
    for (let step = 0; step < 14; step++) {
      const middle = (low + high) / 2;
      if (score(mix(color.rgb, endpoint, middle)) >= minimum + .01) high = middle;
      else low = middle;
    }
    result = mix(color.rgb, endpoint, high);
  }
  return remember(foregrounds, key, css({ ...color, rgb: result }));
}

/** Data bars retain their hue and alpha. Limit their brightness so the existing
 * 30%-opacity overlay still permits readable text on both covered/uncovered cells. */
export function adaptDataBarColor(color: string, mode: SheetMode): string {
  if (mode === "light") return color;
  const readable = readableColor(color, [darkBackground], 3), parsed = parse(readable);
  return parsed && parsed.alpha ? css({ ...parsed, rgb: darken(parsed.rgb, .3) }) : color;
}

/** A view-only palette applied AFTER shared-border deduplication. The source
 * style and every non-color property, including collapsed edges, stay intact.
 * Unresolved CSS colors remain under host control; no DOM or model writes occur. */
export function adaptCellColors(style: CSSProperties, mode: SheetMode,
  options: { error?: boolean; dataBarColor?: string; selected?: boolean } = {}): CSSProperties {
  if (mode === "light") return style;
  const result = { ...style };
  if (typeof style.backgroundColor === "string") result.backgroundColor = displayFill(style.backgroundColor);
  const fill = typeof result.backgroundColor === "string" ? parse(result.backgroundColor) : null;
  const background = fill ? mix(darkBackground, fill.rgb, fill.alpha) :
    options.selected && !style.backgroundColor ? darkSelection : darkBackground;
  const backgrounds = [background];
  const bar = options.dataBarColor ? parse(options.dataBarColor) : null;
  if (bar?.alpha) backgrounds.push(mix(background, bar.rgb, bar.alpha * .3));
  result.color = readableColor(style.color ?? (options.error ? "#dc2626" : "#e9efeb"), backgrounds, 4.5);
  for (const edge of ["borderTop", "borderRight", "borderBottom", "borderLeft"] as const) {
    const border = style[edge];
    if (typeof border !== "string") continue;
    const match = /^(\S+\s+(?:solid|dashed|dotted|double)\s+)(.+)$/.exec(border);
    if (match) result[edge] = match[1] + readableColor(match[2], [background], 3);
  }
  return result;
}
