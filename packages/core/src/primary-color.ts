export type PrimaryColorPalette = Readonly<{
  primary: string;
  onPrimary: string;
  primaryHover: string;
  accent: string;
  selection: string;
}>;

type RGB = readonly [number, number, number];
const black: RGB = [0, 0, 0], white: RGB = [255, 255, 255];
const hex = (rgb: RGB) => `#${rgb.map(value => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
const mix = (a: RGB, b: RGB, amount: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * amount),
  Math.round(a[1] + (b[1] - a[1]) * amount),
  Math.round(a[2] + (b[2] - a[2]) * amount),
];
const luminance = (rgb: RGB) => rgb.map(value => {
  const channel = value / 255;
  return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
}).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
const contrast = (a: RGB, b: RGB) => {
  const first = luminance(a), second = luminance(b);
  return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
};

/** UI colors only; independent of document formatting, React and browser APIs. */
export function createPrimaryColorPalette(value: string | undefined, mode: "light" | "dark"): PrimaryColorPalette | undefined {
  if (typeof value !== "string" || !/^#(?:[\da-f]{3}|[\da-f]{6})$/i.test(value.trim())) return undefined;
  const digits = value.trim().slice(1);
  const expanded = digits.length === 3 ? [...digits].map(char => char + char).join("") : digits;
  const rgb: RGB = [parseInt(expanded.slice(0, 2), 16), parseInt(expanded.slice(2, 4), 16), parseInt(expanded.slice(4, 6), 16)];
  const foreground = contrast(rgb, white) >= contrast(rgb, black) ? white : black;
  // Hover increases contrast with the chosen label color.
  const primaryHover = mix(rgb, foreground === white ? black : white, .12);
  const dark = mode === "dark";
  const selection = mix(rgb, dark ? black : white, dark ? .78 : .9);
  // Selected labels, outlines and active tabs remain readable in either mode.
  const panel: RGB = dark ? [51, 63, 55] : [245, 247, 246];
  let accent = rgb;
  for (let step = 1; step <= 20 && (contrast(accent, panel) < 4.5 || contrast(accent, selection) < 4.5); step++) {
    accent = mix(rgb, dark ? white : black, step / 20);
  }
  return { primary: hex(rgb), onPrimary: hex(foreground), primaryHover: hex(primaryHover), accent: hex(accent), selection: hex(selection) };
}
