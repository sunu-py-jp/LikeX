import type { ConnectorOutline, ConnectorPath, ConnectorPathCommand, ConnectorPoint } from "./connectors";
import { officeShapeDefinitions } from "./office-shape-data";

/** DrawingML preset identifiers, shared by XLSX, PPTX and DOCX. */
export type OfficeShapePreset = keyof typeof officeShapeDefinitions;
export type OfficeShapeCategory = "basic" | "arrows" | "flowchart";
export type OfficeShapeGeometry = Readonly<{
  paths: readonly Readonly<{ d: string; fill?: boolean; stroke?: boolean }>[];
  textRect: Readonly<{ left: number; top: number; width: number; height: number }>;
}>;

const labels: Readonly<Record<OfficeShapePreset, string>> = {
  rect: "四角形", roundRect: "角丸四角形", ellipse: "楕円", triangle: "三角形", rtTriangle: "直角三角形",
  diamond: "ひし形", parallelogram: "平行四辺形", trapezoid: "台形", pentagon: "五角形", hexagon: "六角形",
  octagon: "八角形", star5: "星（5点）", plus: "十字形",
  rightArrow: "右矢印", leftArrow: "左矢印", upArrow: "上矢印", downArrow: "下矢印",
  leftRightArrow: "左右矢印", upDownArrow: "上下矢印", bentArrow: "カギ矢印", bentUpArrow: "屈折矢印",
  uturnArrow: "Uターン矢印", leftUpArrow: "二方向矢印", leftRightUpArrow: "三方向矢印", quadArrow: "四方向矢印",
  chevron: "山形", homePlate: "五角形矢印",
  flowChartProcess: "処理", flowChartDecision: "判断", flowChartTerminator: "端子（開始・終了）",
  flowChartInputOutput: "データ（入出力）", flowChartPredefinedProcess: "定義済み処理", flowChartDocument: "書類",
  flowChartMultidocument: "複数書類", flowChartPreparation: "準備", flowChartManualInput: "手操作入力",
  flowChartManualOperation: "手作業", flowChartMerge: "結合", flowChartDelay: "待機",
};
export const OFFICE_SHAPE_PRESETS: readonly Readonly<{ preset: OfficeShapePreset; label: string; category: OfficeShapeCategory }>[] =
  Object.freeze((Object.keys(officeShapeDefinitions) as OfficeShapePreset[]).map(preset => Object.freeze({
    preset, label: labels[preset], category: preset.startsWith("flowChart") ? "flowchart" as const :
      preset.endsWith("Arrow") || preset === "chevron" || preset === "homePlate" ? "arrows" as const : "basic" as const,
  })));
export function isOfficeShapePreset(value: unknown): value is OfficeShapePreset {
  return typeof value === "string" && Object.hasOwn(officeShapeDefinitions, value);
}

type PresetDefinition = Readonly<{
  guides: readonly (readonly [string, string])[];
  rect: readonly [string, string, string, string];
  paths: readonly Readonly<{ commands: readonly (readonly string[])[]; w?: number; h?: number; fill?: boolean; stroke?: boolean }>[];
}>;
type NumericGeometry = Readonly<{ paths: readonly ConnectorPath[]; textRect: OfficeShapeGeometry["textRect"] }>;
const ANGLE = Math.PI / 10800000;

/** Evaluates only the bundled, finite preset catalog. Imported formulas are never accepted. */
function guidesFor(definition: PresetDefinition, width: number, height: number): (token: string) => number {
  const guides: Record<string, number> = { w: width, h: height, l: 0, t: 0, r: width, b: height,
    hc: width / 2, vc: height / 2, ss: Math.min(width, height), ls: Math.max(width, height),
    cd2: 10800000, cd4: 5400000, cd8: 2700000, "3cd4": 16200000 };
  for (const divisor of [2, 3, 4, 5, 6, 8, 10, 12, 16, 32]) {
    guides[`wd${divisor}`] = width / divisor; guides[`hd${divisor}`] = height / divisor;
    guides[`ssd${divisor}`] = guides.ss / divisor;
  }
  const value = (token: string): number => {
    if (Object.hasOwn(guides, token)) return guides[token];
    if (/^-?\d+(?:\.\d+)?$/.test(token)) return Number(token);
    throw new Error(`Unknown bundled shape guide: ${token}`);
  };
  for (const [name, formula] of definition.guides) {
    const [operation, ...tokens] = formula.split(" ");
    const [x, y, z] = tokens.map(value);
    let result: number;
    switch (operation) {
      case "val": result = x; break;
      case "*/": result = z === 0 ? 0 : x * y / z; break;
      case "+-": result = x + y - z; break;
      case "+/": result = z === 0 ? 0 : (x + y) / z; break;
      case "?:": result = x > 0 ? y : z; break;
      case "pin": result = Math.max(x, Math.min(y, z)); break;
      case "min": result = Math.min(x, y); break;
      case "max": result = Math.max(x, y); break;
      case "sin": result = x * Math.sin(y * ANGLE); break;
      case "cos": result = x * Math.cos(y * ANGLE); break;
      default: throw new Error(`Unsupported bundled shape formula: ${operation}`);
    }
    if (!Number.isFinite(result)) throw new RangeError("Office shape dimensions exceed the supported numeric range");
    guides[name] = result;
  }
  return value;
}

function numericGeometry(preset: OfficeShapePreset, width: number, height: number): NumericGeometry {
  if (!isOfficeShapePreset(preset)) throw new TypeError("Unknown Office shape preset");
  if (![width, height].every(value => Number.isFinite(value) && value >= 0 && value <= 1e9))
    throw new RangeError("Office shape dimensions must be finite numbers between 0 and 1e9");
  const definition: PresetDefinition = officeShapeDefinitions[preset];
  // Degenerate boxes collapse an otherwise finite preset rather than divide by zero.
  const w = width || 1, h = height || 1, value = guidesFor(definition, w, h);
  const paths = definition.paths.map(path => {
    const scaleX = width / (path.w ?? w), scaleY = height / (path.h ?? h);
    const commands: ConnectorPathCommand[] = [];
    let current = { x: 0, y: 0 }, start = current;
    const add = (command: ConnectorPathCommand) => {
      commands.push(command);
      if (command.type === "close") current = start;
      else { current = { x: command.x, y: command.y }; if (command.type === "move") start = current; }
    };
    for (const [kind, ...tokens] of path.commands) {
      const args = tokens.map(value);
      if (kind === "M" || kind === "L") add({ type: kind === "M" ? "move" : "line", x: args[0] * scaleX, y: args[1] * scaleY });
      else if (kind === "C") add({ type: "cubic", x1: args[0] * scaleX, y1: args[1] * scaleY,
        x2: args[2] * scaleX, y2: args[3] * scaleY, x: args[4] * scaleX, y: args[5] * scaleY });
      else if (kind === "Z") add({ type: "close" });
      else if (kind === "A") {
        const rx = args[0] * scaleX, ry = args[1] * scaleY, angle = args[2] * ANGLE, sweep = args[3] * ANGLE;
        // All arcs in this catalog use quadrantal angles. Cubic segments preserve
        // their tangents in both SVG/Canvas and DrawingML custom connector paths.
        const cx = current.x - rx * Math.cos(angle), cy = current.y - ry * Math.sin(angle);
        const count = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2)));
        for (let index = 0; index < count; index++) {
          const a = angle + sweep * index / count, b = angle + sweep * (index + 1) / count;
          const k = 4 / 3 * Math.tan((b - a) / 4);
          add({ type: "cubic", x1: cx + rx * (Math.cos(a) - k * Math.sin(a)), y1: cy + ry * (Math.sin(a) + k * Math.cos(a)),
            x2: cx + rx * (Math.cos(b) + k * Math.sin(b)), y2: cy + ry * (Math.sin(b) - k * Math.cos(b)),
            x: cx + rx * Math.cos(b), y: cy + ry * Math.sin(b) });
        }
      } else throw new Error("Unsupported bundled shape path command");
    }
    return { commands, ...(path.fill === false ? { fill: false } : {}), ...(path.stroke === false ? { stroke: false } : {}) };
  });
  const [left, top, right, bottom] = definition.rect.map(value);
  return { paths, textRect: { left: left * width / w, top: top * height / h,
    width: Math.max(0, right - left) * width / w, height: Math.max(0, bottom - top) * height / h } };
}

function pathData(commands: readonly ConnectorPathCommand[]): string {
  const number = (value: number) => String(Math.round(value * 1e6) / 1e6);
  return commands.map(command => {
    if (command.type === "close") return "Z";
    if (command.type === "cubic") return `C${[command.x1, command.y1, command.x2, command.y2, command.x, command.y].map(number).join(" ")}`;
    return `${command.type === "move" ? "M" : "L"}${number(command.x)} ${number(command.y)}`;
  }).join(" ");
}

/** SVG/Canvas path data in actual document units, using Office's default preset adjustments. */
export function getOfficeShapeGeometry(preset: OfficeShapePreset, width: number, height: number): OfficeShapeGeometry {
  const geometry = numericGeometry(preset, width, height);
  return { paths: geometry.paths.map(({ commands, ...paint }) => ({ d: pathData(commands), ...paint })), textRect: geometry.textRect };
}

const corners: readonly ConnectorPoint[] = [{ x: 0.5, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 0.5 }, { x: 1, y: 1 },
  { x: 0.5, y: 1 }, { x: 0, y: 1 }, { x: 0, y: 0.5 }, { x: 0, y: 0 }];

/** Find boundary ports even for concave arrows whose box centre lies outside the shape. */
export function getOfficeShapeOutline(preset: OfficeShapePreset, width: number, height: number): ConnectorOutline {
  const geometry = numericGeometry(preset, width, height);
  const w = width || 1, h = height || 1;
  const paths: ConnectorPath[] = geometry.paths.map(path => ({ ...path, commands: path.commands.map(command =>
    command.type === "close" ? command : command.type === "cubic" ? { type: "cubic", x1: command.x1 / w, y1: command.y1 / h,
      x2: command.x2 / w, y2: command.y2 / h, x: command.x / w, y: command.y / h } : { ...command, x: command.x / w, y: command.y / h }) }));
  const segments: [ConnectorPoint, ConnectorPoint][] = [];
  for (const path of paths) {
    if (path.fill === false && path.stroke === false) continue;
    let current: ConnectorPoint = { x: 0, y: 0 }, start = current;
    for (const command of path.commands) {
      if (command.type === "move") { current = command; start = command; }
      else if (command.type === "close") { segments.push([current, start]); current = start; }
      else if (command.type === "line") { segments.push([current, command]); current = command; }
      else if (command.type === "cubic") {
        const origin = current;
        for (let step = 1; step <= 32; step++) {
          const t = step / 32, u = 1 - t;
          const next = { x: u ** 3 * origin.x + 3 * u ** 2 * t * command.x1 + 3 * u * t ** 2 * command.x2 + t ** 3 * command.x,
            y: u ** 3 * origin.y + 3 * u ** 2 * t * command.y1 + 3 * u * t ** 2 * command.y2 + t ** 3 * command.y };
          segments.push([current, next]); current = next;
        }
      }
    }
  }
  const ports = corners.map(corner => {
    let nearest = { x: 0, y: 0 }, distance = Infinity;
    for (const [a, b] of segments) {
      const dx = b.x - a.x, dy = b.y - a.y, length = dx * dx + dy * dy;
      const t = length ? Math.max(0, Math.min(1, ((corner.x - a.x) * dx + (corner.y - a.y) * dy) / length)) : 0;
      const point = { x: a.x + dx * t, y: a.y + dy * t };
      const d = (corner.x - point.x) ** 2 + (corner.y - point.y) ** 2;
      if (d < distance) { distance = d; nearest = point; }
    }
    return { x: Math.max(0, Math.min(1, nearest.x)), y: Math.max(0, Math.min(1, nearest.y)) };
  });
  const rect = geometry.textRect;
  return { type: "paths", paths, ports, textRect: { left: rect.left / w, top: rect.top / h, width: rect.width / w, height: rect.height / h } };
}
