import type { SpreadsheetImageResource, SpreadsheetSheet } from "@likex/spreadsheet";

// A small static PNG illustration. It is an image, not a live spreadsheet chart.
export const insertionDemoImage: SpreadsheetImageResource = {
  name: "sample-bars.png", mimeType: "image/png", width: 260, height: 128,
  dataUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAQQAAACACAIAAABiPIAnAAACCElEQVR42u3dMaqtMBiF0UzFyTgbK+fgZJySjZ2tWNhqb6NJICQu+PrHvvzrngMX8sJ+HpLugh+BBIMEgwSDBIMEgwSDBIMEgwSDBIMEgwSDBIMEgwSDBIMEgwSD/tMwT+nBIBhgEAwwCAYYBAMMggEGwQCDYIBBMNSOYdlWKbosGF7+Wz4Z5JPB1yTBAINggEEwwOBcCp0LDHIuMMi5wCDnAoOcCwxyLjA4PudiHQzOxToYYLAOBhisgwEG62CAwToYYLAOBhhggAGGqHPpxj49GAQDDIIBBsEAg2CA4ZGXf1p6WeguCwbvJskng69JggEGf7iBAQYYYIDBucAAAwwwwAADDDDAAAMMMMAAAwzWwQADDDDAAAMMMMAAAwwwwAADDDDA4Fysg8G5WAeDc7EOBudiHQzOxToYnIt1MDgX62BwLtZV9G5Sw2/vWOfdpG/53Wmdr0nOxToYnIt1MDgX62BwLtbB4Fysg8EP1DoYYLAOBhisgwEG62CAwToYYLAOBhicCwwwOBcYYHAuMMDgXGCAwblYB4NzsQ4G52IdDM7FOhici3UwOBfrYHAu1nk3yctC1nk3ye9O63xNci7WweBcrIPBuVgHg3OxDgbnYh0MzsU6GJyLdTA4F+v8N1ZSLcEgwSDBIMEgwSDBIMEgwSDBIMEgwSDBIMEgwSDBIMEgwSAV6gKeowBu2jox1QAAAABJRU5ErkJggg==",
};

export const insertionDemoSheet: SpreadsheetSheet = {
  id: "insertions", name: "挿入サンプル", rowCount: 100, columnCount: 26,
  cells: { A1: { value: "挿入例", format: { bold: true } }, A12: { value: "コメントあり" } },
  comments: { A12: { id: "demo-comment", author: "LikeX", text: "画像・図形・テキスト・このコメントは、全てブックのJSONに保存されます。" } },
  drawings: [
    { id: "demo-image", type: "image", resourceId: "demo-bars", alt: "棒グラフのサンプル画像", anchor: { row: 2, column: 1, offsetX: 0, offsetY: 0 }, width: 260, height: 128 },
    { id: "demo-text", type: "text", text: "シートにメモを追加\n\n画像と図形はドラッグで移動。\nハンドルでサイズを変更できます。", fontSize: 16, color: "#24563a", background: "#eef7f0", anchor: { row: 2, column: 5, offsetX: 0, offsetY: 0 }, width: 290, height: 150 },
    { id: "demo-rectangle", type: "shape", shape: "rectangle", fill: "#d9eadf", stroke: "#217346", strokeWidth: 2, text: "内容を確認", fontSize: 16, color: "#24563a", bold: true, anchor: { row: 8, column: 1, offsetX: 0, offsetY: 0 }, width: 140, height: 60 },
    { id: "demo-ellipse", type: "shape", shape: "ellipse", fill: "#e1edf8", stroke: "#4b79a1", strokeWidth: 2, text: "承認済み", fontSize: 16, color: "#264866", anchor: { row: 8, column: 3, offsetX: 0, offsetY: 0 }, width: 140, height: 60 },
    { id: "demo-arrow", type: "shape", shape: "arrow", fill: "transparent", stroke: "#cc9142", strokeWidth: 3, anchor: { row: 8, column: 5, offsetX: 0, offsetY: 10 }, width: 140, height: 40 },
    { id: "demo-line", type: "shape", shape: "line", fill: "transparent", stroke: "#8e73b5", strokeWidth: 3, anchor: { row: 8, column: 7, offsetX: 0, offsetY: 10 }, width: 140, height: 40 },
  ],
};
