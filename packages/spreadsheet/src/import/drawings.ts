import { normalizeDrawing } from "../model/annotations";
import { getImageDisplaySize } from "../model/image-resources";
import { normalizeDrawingRotation } from "../model/drawing-transform";
import { getShapeDefinition, SPREADSHEET_SHAPES } from "../model/shapes";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawing, type SpreadsheetSheet } from "../model/types";
import { adjusted, growSheet, omitted, worksheetDefaultSizes } from "./worksheet-shared";
import { anchorFromFrame, drawingGrid, EMU_PER_PIXEL, finiteNumber, readDrawingFrame, readTransformFrame } from "./drawing-geometry";
import { readDrawingImage } from "./drawing-media";
import { drawingColor, drawingFill, drawingText } from "./drawing-style";
import { readRelationships, type XlsxRelationship } from "./relationships";
import type { ImportContext } from "./types";
import { attribute, child, children, localName, parseXml, type XmlNode } from "./xml";

/** Native worksheet drawings only: charts, groups, OLE and externally linked media are never executed. */
export async function readWorksheetDrawings(node: XmlNode, initial: SpreadsheetSheet,
  relationships: ReadonlyMap<string, XlsxRelationship>, context: ImportContext): Promise<SpreadsheetSheet> {
  let sheet = initial;
  const drawings: SpreadsheetDrawing[] = [], grid = drawingGrid(sheet, worksheetDefaultSizes(node));
  let visited = 0;
  for (const reference of children(node, "drawing")) {
    context.signal?.throwIfAborted();
    const relation = relationships.get(attribute(reference, "id") ?? "");
    if (!relation || !relation.type.endsWith("/drawing") || relation.external) { omitted(context, sheet, "外部参照または未対応の描画データを省略しました"); continue; }
    const root = parseXml(await context.archive.read(relation.target));
    if (localName(root.name) !== "wsDr") throw new Error("Excelの描画データが不正です");
    const related = await readRelationships(context.archive, relation.target);
    for (const container of root.children) {
      context.signal?.throwIfAborted();
      if (++visited > SPREADSHEET_LIMITS.drawings) throw new Error("Excelの描画オブジェクト数が上限を超えています");
      if (!["oneCellAnchor", "twoCellAnchor", "absoluteAnchor"].includes(localName(container.name))) { omitted(context, sheet, "未対応の描画位置指定を省略しました"); continue; }
      const object = container.children.find(item => ["pic", "sp", "cxnSp", "graphicFrame", "grpSp"].includes(localName(item.name)));
      if (!object || !["pic", "sp", "cxnSp"].includes(localName(object.name))) { omitted(context, sheet, "グラフ・グループなど未対応の描画オブジェクトを省略しました"); continue; }
      const properties = child(object, "spPr"), transform = child(properties, "xfrm");
      const rotationValue = finiteNumber(transform?.attributes.rot);
      const rotation = normalizeDrawingRotation((rotationValue ?? 0) / 60000);
      const nativeFrame = rotation ? readTransformFrame(transform) : undefined;
      const frame = nativeFrame ?? readDrawingFrame(container, grid);
      if (!frame) { omitted(context, sheet, "対応範囲外のサイズ・位置を持つオブジェクトを省略しました"); continue; }
      if (rotation && !nativeFrame) adjusted(context, sheet, "回転したオブジェクトの位置をセルのアンカーから近似しました");
      const anchor = anchorFromFrame(frame, grid);
      if (!anchor) { omitted(context, sheet, "シート上限外のオブジェクトを省略しました"); continue; }
      const common = { id: `${sheet.id}-drawing-${visited}`, anchor, width: frame.width, height: frame.height,
        ...(["1", "true"].includes(transform?.attributes.flipH ?? "") ? { flipX: true } : {}),
        ...(["1", "true"].includes(transform?.attributes.flipV ?? "") ? { flipY: true } : {}), ...(rotation ? { rotation } : {}) };
      let drawing: SpreadsheetDrawing;
      if (localName(object.name) === "pic") {
        const blipFill = child(object, "blipFill"), blip = child(blipFill, "blip"), media = related.get(attribute(blip, "embed") ?? "");
        if (!media || media.external || !media.type.endsWith("/image") || attribute(blip, "link")) { omitted(context, sheet, "外部リンクの画像を省略しました"); continue; }
        const resourceId = await readDrawingImage(media.target, context);
        if (!resourceId) { omitted(context, sheet, "未対応または不正な画像を省略しました（PNG・JPEG・GIF・WebPに対応）"); continue; }
        const size = getImageDisplaySize(context.resources[resourceId]);
        if (Math.abs(frame.width / frame.height / (size.width / size.height) - 1) > 0.01) adjusted(context, sheet, "引き伸ばされた画像を元の縦横比で枠内に収めました");
        if (child(blipFill, "srcRect") || child(blipFill, "tile")) omitted(context, sheet, "画像のトリミング・タイル表示を省略しました");
        const nonvisual = child(child(object, "nvPicPr"), "cNvPr");
        drawing = { ...common, type: "image", resourceId, alt: nonvisual?.attributes.descr ?? nonvisual?.attributes.name ?? "" };
      } else {
        const nonvisual = child(child(object, "nvSpPr"), "cNvSpPr"), isTextBox = ["1", "true"].includes(nonvisual?.attributes.txBox ?? "");
        const preset = child(properties, "prstGeom"), presetName = preset?.attributes.prst;
        if (!isTextBox && (child(properties, "custGeom") || !SPREADSHEET_SHAPES.some(item => getShapeDefinition(item.kind).xlsxPreset === presetName))) {
          omitted(context, sheet, "未対応の種類の図形を省略しました"); continue;
        }
        const content = drawingText(child(object, "txBody"), context, sheet);
        const body = child(child(object, "txBody"), "bodyPr"), textRotation = finiteNumber(body?.attributes.rot) ?? 0;
        if (textRotation && !(rotation && common.flipY && textRotation === 10800000) || rotation && body?.attributes.upright === "1")
          adjusted(context, sheet, "図形と異なる文字の回転角度を図形の角度へ揃えました");
        if (content.text.length > SPREADSHEET_LIMITS.drawingTextLength) throw new Error("Excelの図形の文字数が上限を超えています");
        const style = child(object, "style");
        const fill = drawingFill(properties, drawingColor(child(style, "fillRef"), context) ?? "transparent", context, sheet);
        if (isTextBox) {
          if (child(properties, "ln") && !child(child(properties, "ln"), "noFill")) omitted(context, sheet, "テキストボックスの外枠を省略しました");
          drawing = { ...common, type: "text", ...content, background: fill };
        } else {
          let shape = SPREADSHEET_SHAPES.find(item => getShapeDefinition(item.kind).xlsxPreset === presetName)?.kind;
          const line = child(properties, "ln");
          const head = child(line, "headEnd"), tail = child(line, "tailEnd");
          const hasHead = !!head && !!head.attributes.type && head.attributes.type !== "none";
          const hasTail = !!tail && !!tail.attributes.type && tail.attributes.type !== "none";
          if (presetName === "line" && (hasHead || hasTail)) shape = "arrow";
          if (!shape || child(properties, "custGeom")) { omitted(context, sheet, "未対応の種類の図形を省略しました"); continue; }
          const strokeWidth = child(line, "noFill") ? 0 : Math.min(100, Math.max(0, (finiteNumber(line?.attributes.w) ?? 9525) / EMU_PER_PIXEL));
          if (line?.attributes.w && strokeWidth !== Number(line.attributes.w) / EMU_PER_PIXEL) adjusted(context, sheet, "図形の線幅を対応範囲へ調整しました");
          if (child(line, "prstDash")?.attributes.val && child(line, "prstDash")!.attributes.val !== "solid") adjusted(context, sheet, "図形の破線を実線へ変更しました");
          const guide = children(child(preset, "avLst"), "gd"), definition = getShapeDefinition(shape), adjustment = definition.xlsxAdjustment;
          const expected = adjustment ? 100000 * adjustment.ratio * frame[adjustment.axis] / Math.min(frame.width, frame.height) : undefined;
          if (guide.some(item => {
            const value = Number(item.attributes.fmla?.replace(/^val\s+/, ""));
            return adjustment && item.attributes.name === adjustment.name ? Math.abs(value - expected!) > 1
              : item.attributes.name === "adj1" ? value !== 50000 : !(shape === "roundedRectangle" && item.attributes.name === "adj" && value === 16667 || shape === "triangle" && item.attributes.name === "adj" && value === 50000);
          })) adjusted(context, sheet, "図形の細かな変形を標準の形状へ近似しました");
          if (presetName === "line" && hasHead && hasTail) adjusted(context, sheet, "両端の矢印を片側の矢印へ変更しました");
          drawing = { ...common, ...(presetName === "line" && hasHead && !hasTail ? { flipX: !common.flipX, flipY: !common.flipY } : {}),
            type: "shape", shape, fill, stroke: drawingFill(line, drawingColor(child(style, "lnRef"), context) ?? "#000000", context, sheet), strokeWidth, ...content };
        }
      }
      sheet = growSheet(sheet, anchor.row, anchor.column);
      drawings.push(normalizeDrawing(drawing, sheet, { images: context.resources }));
      if (child(properties, "effectLst") || child(properties, "effectDag") || child(properties, "scene3d") || child(properties, "sp3d")) omitted(context, sheet, "描画オブジェクトの影・3D効果を省略しました");
    }
  }
  return drawings.length ? { ...sheet, drawings } : sheet;
}
