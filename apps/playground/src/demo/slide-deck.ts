import { createSlideDeck, createSlideElement, type Slide, type SlideElementInput } from "@likex/slide";
import imageSamples from "./spreadsheet-image-samples.json";

const text = (text: string, x: number, y: number, width: number, height: number, extra: Partial<Extract<SlideElementInput, { type: "text" }>> = {}) =>
  createSlideElement({ type: "text", text, x, y, width, height, fontSize: 28, fontFamily: "Yu Gothic UI", color: "#243242", ...extra });
const shape = (x: number, y: number, width: number, height: number, fill: string, extra: Partial<Extract<SlideElementInput, { type: "shape" }>> = {}) =>
  createSlideElement({ type: "shape", shape: "rect", x, y, width, height, fill, stroke: "transparent", ...extra });
const page = (id: string, name: string, background: string, elements: Slide["elements"], notes = ""): Slide => ({ id, name, background, elements, notes });

export function createDemoSlideDeck() {
  return createSlideDeck({ title: "プロジェクト計画 2026", width: 1280, height: 720, slides: [
    page("cover", "プロジェクト計画", "#f7f5f0", [
      shape(880, 0, 400, 720, "#22364a"), shape(936, 138, 210, 210, "#d56a43", { shape: "ellipse" }),
      shape(1030, 330, 190, 190, "#a9c8b6", { shape: "roundRect", rotation: 14 }),
      text("PROJECT PLAN  /  2026", 76, 68, 680, 44, { fontSize: 20, bold: true, color: "#b64b2b" }),
      text("プロジェクト計画", 72, 208, 800, 102, { fontSize: 64, bold: true }),
      text("チームのアイデアを、次の一歩へ。", 78, 340, 780, 80, { fontSize: 32 }),
      shape(80, 486, 70, 5, "#d56a43"),
      text("対象範囲・スケジュール・判断事項", 80, 536, 720, 56, { fontSize: 23, color: "#637383" }),
      text("企画チーム  /  2026.09", 80, 628, 700, 35, { fontSize: 18, color: "#637383" }),
    ], "目的と今回決めたいことを共有します。テキストはダブルクリックで編集できます。"),
    page("milestones", "進め方とマイルストーン", "#ffffff", [
      text("進め方とマイルストーン", 68, 54, 1130, 76, { fontSize: 44, bold: true }),
      text("小さく試し、確認しながら段階的に進めます。", 72, 144, 1100, 55, { fontSize: 25, color: "#637383" }),
      ...["要件の整理", "試作と検証", "運用へ移行"].flatMap((label, index) => [
        shape(74 + index * 400, 266, 332, 300, ["#eff3f5", "#fdf0e9", "#edf4ee"][index], { shape: "roundRect" }),
        text(`0${index + 1}`, 96 + index * 400, 286, 270, 66, { fontSize: 38, color: "#b64b2b", bold: true }),
        text(label, 96 + index * 400, 374, 285, 58, { fontSize: 30, bold: true }),
        text(["目的と制約をそろえる\n成果物を決める", "サンプルを動かす\n利用者と確認する", "手順を整理する\n改善を続ける"][index], 96 + index * 400, 456, 285, 94, { fontSize: 23 }),
      ]),
      shape(416, 388, 45, 34, "#94a3b8", { shape: "arrow" }), shape(816, 388, 45, 34, "#94a3b8", { shape: "arrow" }),
      text("9月                                      10月                                      11月", 100, 605, 1100, 48, { fontSize: 23, color: "#637383" }),
    ], "図形・矢印・テキストは独立した要素です。位置や色、重なり順を変更できます。"),
    page("images", "画像と説明を組み合わせる", "#f7f5f0", [
      text("画像と説明を組み合わせる", 68, 50, 1150, 78, { fontSize: 44, bold: true }),
      createSlideElement({ type: "image", src: imageSamples.wide.dataUrl, alt: "横長画像の縦横比を確認するサンプル", name: "画像サンプル", x: 72, y: 210, width: 670, height: 670 * imageSamples.wide.height / imageSamples.wide.width }),
      text("資料に合わせて編集", 808, 216, 410, 68, { fontSize: 30, bold: true }),
      text("・四隅をドラッグしてサイズ変更\n\n・回転と重なり順を調整\n\n・説明はノートにも記録", 808, 316, 410, 260, { fontSize: 24 }),
      text("JSONには画像データも含まれます。", 74, 630, 1090, 44, { fontSize: 22, color: "#637383" }),
    ]),
    page("decisions", "次回までに決めること", "#22364a", [
      text("次回までに決めること", 76, 70, 1120, 95, { fontSize: 48, bold: true, color: "#ffffff" }),
      ...["最初に試す利用シーン", "確認に参加するメンバー", "試作の完了日と判断基準"].flatMap((label, index) => [
        shape(82, 268 + 114 * index, 38, 38, "#d56a43", { shape: "ellipse" }),
        text(label, 158, 252 + 114 * index, 1040, 76, { fontSize: 32, color: "#ffffff" }),
      ]),
      text("ご意見をお願いします。", 82, 630, 1080, 50, { fontSize: 24, color: "#c8d4df" }),
    ], "右上の発表ボタンでスライドショーを開始します。左右キーで移動、Escで編集画面へ戻ります。"),
  ] });
}
