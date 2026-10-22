import { readOfficeConnectorShapeTag, readOfficeConnectorCornerRadiusRatio, readOfficeElbowConnectorEndpoints } from "../ooxml";
import { connectorLocalToWorld } from "../model/core-connectors";
import { withLinePoints } from "../model/lines";
import { isSpreadsheetShapeKind } from "../model/shapes";
import { connectImportedDrawings, connectorPoints, importedLineBoundsIssue, presetHasAdjustments, readConnectorFrame, readLineArrow, type ImportedDrawingTarget, type PendingDrawingConnector } from "./drawing-connectors";
import { normalizeDrawing } from "../model/annotations";
import { getImageDisplaySize } from "../model/image-resources";
import { normalizeDrawingRotation } from "../model/drawing-transform";
import { getShapeDefinition, SPREADSHEET_SHAPES } from "../model/shapes";
import { SPREADSHEET_LIMITS, type SpreadsheetDrawing, type SpreadsheetSheet } from "../model/types";
import { adjusted, growSheet, omitted, worksheetDefaultSizes } from "./worksheet-shared";
import { anchorFromFrame, drawingAnchorTransform, drawingGrid, EMU_PER_PIXEL, finiteNumber, readDrawingFrame, readTransformFrame, transformDrawingFrame, worksheetDrawingGrid } from "./drawing-geometry";
import { readDrawingImage, type PreparedDrawingImage } from "./drawing-media";
import { drawingColor, drawingFill, drawingText } from "./drawing-style";
import { readImportRelationships, type XlsxRelationship } from "./relationships";
import { importFailureMessage, rethrowImportFailure } from "./recovery";
import type { ImportContext } from "./types";
import { attribute, child, children, localName, parseXml, type XmlNode } from "./xml";

/** Native worksheet drawings only: charts, groups, OLE and externally linked media are never executed. */
export async function readWorksheetDrawings(node: XmlNode, initial: SpreadsheetSheet,
  relationships: ReadonlyMap<string, XlsxRelationship>, context: ImportContext): Promise<SpreadsheetSheet> {
  let sheet = initial;
  const defaults = worksheetDefaultSizes(node, context.columnWidthMetrics);
  const grow = (current: SpreadsheetSheet, row: number, column: number) => {
    const next = growSheet(current, row, column);
    if (next.rowCount === current.rowCount && next.columnCount === current.columnCount) return next;
    const rowHeights = { ...next.rowHeights }, columnWidths = { ...next.columnWidths };
    for (let index = current.rowCount; index < next.rowCount; index++) rowHeights[index] ??= defaults.row;
    for (let index = current.columnCount; index < next.columnCount; index++) columnWidths[index] ??= defaults.column;
    return { ...next, rowHeights, columnWidths };
  };
  const drawings: SpreadsheetDrawing[] = [], grid = drawingGrid(sheet, defaults), sourceGrid = worksheetDrawingGrid(node, context.columnWidthMetrics);
  let visited = 0;
  const pending: PendingDrawingConnector[] = [], targets = new Map<string, ImportedDrawingTarget>(), ambiguousIds = new Set<string>();
  for (const reference of children(node, "drawing")) {
    context.signal?.throwIfAborted();
    const relation = relationships.get(attribute(reference, "id") ?? "");
    if (!relation || !relation.type.endsWith("/drawing") || relation.external) { omitted(context, sheet, "外部参照または未対応の描画データを省略しました"); continue; }
    let root: XmlNode, related: ReadonlyMap<string, XlsxRelationship>;
    try {
      root = parseXml(await context.archive.read(relation.target));
      if (localName(root.name) !== "wsDr") throw new Error("Excelの描画データが不正です");
    } catch (error) {
      rethrowImportFailure(error, context);
      omitted(context, sheet, `描画データ「${relation.target}」を省略しました: ${importFailureMessage(error)}`);
      continue;
    }
    try {
      related = await readImportRelationships(relation.target, { ...context, warn: warning => context.warn({ ...warning, sheetName: sheet.name }) });
    } catch (error) {
      rethrowImportFailure(error, context);
      omitted(context, sheet, `描画データ「${relation.target}」の参照情報を省略しました: ${importFailureMessage(error)}`);
      related = new Map();
    }
    for (const container of root.children) {
      context.signal?.throwIfAborted();
      visited++;
      if (!["oneCellAnchor", "twoCellAnchor", "absoluteAnchor"].includes(localName(container.name))) { omitted(context, sheet, "未対応の描画位置指定を省略しました"); continue; }
      const object = container.children.find(item => ["pic", "sp", "cxnSp", "graphicFrame", "grpSp"].includes(localName(item.name)));
      if (!object || !["pic", "sp", "cxnSp"].includes(localName(object.name))) { omitted(context, sheet, "グラフ・グループなど未対応の描画オブジェクトを省略しました"); continue; }
      const nonvisualContainer = child(object, localName(object.name) === "pic" ? "nvPicPr" : localName(object.name) === "cxnSp" ? "nvCxnSpPr" : "nvSpPr");
      const info = child(nonvisualContainer, "cNvPr");
      const objectName = (info?.attributes.name ?? info?.attributes.id ?? String(visited)).slice(0, 120);
      const objectLabel = `描画オブジェクト「${objectName}」${info?.attributes.id ? `（ID: ${info.attributes.id.slice(0, 120)}）` : ""}`;
      if ((context.drawingCount ?? 0) >= SPREADSHEET_LIMITS.drawings) {
        omitted(context, sheet, `${objectLabel}を省略しました: ブック全体の描画数の上限${SPREADSHEET_LIMITS.drawings}件を超えています`);
        continue;
      }
      const originalSheet = sheet, originalPendingCount = pending.length;
      let imageResource: PreparedDrawingImage | undefined;
      try {
        if (["1", "true"].includes(child(nonvisualContainer, "cNvPr")?.attributes.hidden ?? "")) {
          omitted(context, sheet, "非表示の描画オブジェクトを省略しました"); continue;
        }
        const properties = child(object, "spPr"), transform = child(properties, "xfrm");
        const connector = localName(object.name) === "cxnSp", customKind = readOfficeConnectorShapeTag(child(properties, "custGeom"));
        const nativeTextBox = ["1", "true"].includes(child(child(object, "nvSpPr"), "cNvSpPr")?.attributes.txBox ?? "");
        const nativeLine = localName(object.name) === "sp" && !nativeTextBox && child(properties, "prstGeom")?.attributes.prst === "line";
        const linear = connector || nativeLine;
        const elbowEndpoints = connector ? readOfficeElbowConnectorEndpoints(child(properties, "custGeom")) : undefined;
        const rotationValue = finiteNumber(transform?.attributes.rot);
        const rotation = normalizeDrawingRotation((rotationValue ?? 0) / 60000);
        const nativeFrame = linear ? readConnectorFrame(transform, !!elbowEndpoints) : rotation || customKind ? readTransformFrame(transform) : undefined;
        // An unrotated line's cell anchors already give its endpoint frame. A cached
        // xfrm can disagree after worksheet edits or font-dependent column sizing.
        // Rotated and custom paths still need their native local coordinate frame.
        let anchoredLineFrame = linear && !rotation && !elbowEndpoints ? readDrawingFrame(container, grid, true) : undefined;
        if (anchoredLineFrame && nativeFrame && localName(container.name) === "oneCellAnchor") {
          // Our exporter uses the minimum positive anchor extent for a zero-length
          // axis; retain the exact zero stored in the connector transform.
          anchoredLineFrame = { ...anchoredLineFrame,
            width: nativeFrame.width === 0 && anchoredLineFrame.width <= 1 / EMU_PER_PIXEL ? 0 : anchoredLineFrame.width,
            height: nativeFrame.height === 0 && anchoredLineFrame.height <= 1 / EMU_PER_PIXEL ? 0 : anchoredLineFrame.height };
        }
        const rebase = drawingAnchorTransform(container, sourceGrid, grid);
        const transformedFrame = nativeFrame && !anchoredLineFrame ? transformDrawingFrame(nativeFrame, rebase, linear ? 0 : rotation) : undefined;
        let frame = anchoredLineFrame ?? transformedFrame?.frame ?? readDrawingFrame(container, grid, linear);
        if (!frame) { omitted(context, sheet, "対応範囲外のサイズ・位置を持つオブジェクトを省略しました"); continue; }
        if (transformedFrame?.approximated) adjusted(context, sheet, "行・列のサイズ調整に伴う回転図形の変形を、中心位置を保って近似しました");
        if (rotation && !nativeFrame) adjusted(context, sheet, "回転したオブジェクトの位置をセルのアンカーから近似しました");
        const lineProperties = child(properties, "ln");
        const originalStroke = child(lineProperties, "noFill") ? 0 : Math.min(100, Math.max(0, (finiteNumber(lineProperties?.attributes.w) ?? 9525) / EMU_PER_PIXEL));
        const nativeShape = SPREADSHEET_SHAPES.find(item => getShapeDefinition(item.kind).xlsxPreset === child(properties, "prstGeom")?.attributes.prst)?.kind;
        // DrawingML extents follow the outline center. New presets store an outer frame
        // with an inset stroke, so reverse the exporter conversion exactly once.
        const insetOfficeShape = localName(object.name) === "sp" && !nativeTextBox && nativeShape && getShapeDefinition(nativeShape).geometry.type === "office";
        if (customKind && isSpreadsheetShapeKind(customKind) && customKind !== "line" && customKind !== "arrow" || insetOfficeShape)
          frame = { x: Math.max(0, frame.x - originalStroke / 2), y: Math.max(0, frame.y - originalStroke / 2), width: frame.width + originalStroke, height: frame.height + originalStroke };
        // Rebasing and stroke expansion can leave the source frame's valid range.
        // Lines are validated from their endpoints below (a routed frame can be larger).
        if (!linear && (![frame.x, frame.y, frame.width, frame.height].every(Number.isFinite) ||
          frame.width <= 0 || frame.height <= 0 || frame.width > 10_000 || frame.height > 10_000)) {
          omitted(context, sheet, "座標変換・線幅を反映したサイズが対応範囲外の描画オブジェクトを省略しました"); continue;
        }
        // Excel permits positive subpixel rectangles/text boxes; the editable model
        // requires at least 1px. Recover these without weakening native validation.
        if (!linear && localName(object.name) !== "pic" && (frame.width < 1 || frame.height < 1)) {
          adjusted(context, sheet, "1px未満の図形・テキストボックスの幅または高さを1pxへ調整しました");
          frame = { ...frame, width: Math.max(1, frame.width), height: Math.max(1, frame.height) };
        }
        const anchor = anchorFromFrame({ ...frame, x: Math.max(0, frame.x), y: Math.max(0, frame.y) }, grid);
        if (!anchor) { omitted(context, sheet, "シート上限外のオブジェクトを省略しました"); continue; }
        const common = { id: `${sheet.id}-drawing-${visited}`, anchor, width: frame.width, height: frame.height,
          ...(["1", "true"].includes(transform?.attributes.flipH ?? "") ? { flipX: true } : {}),
          ...(["1", "true"].includes(transform?.attributes.flipV ?? "") ? { flipY: true } : {}), ...(rotation ? { rotation } : {}) };
        let drawing: SpreadsheetDrawing;
        if (linear) {
          const preset = child(properties, "prstGeom")?.attributes.prst;
          const elbow = !!elbowEndpoints || /^bentConnector[2-5]$/.test(preset ?? "");
          if (elbow && !elbowEndpoints) adjusted(context, sheet, "折れ線の経由点を接続先に追従する自動経路へ変更しました");
          else if (!elbow && preset !== "line" && preset !== "straightConnector1") adjusted(context, sheet, "未対応の曲線の接続線を始点と終点を結ぶ直線へ変更しました");
          const content = drawingText(child(object, "txBody"), context, sheet, child(child(object, "style"), "fontRef"));
          const endpointFrame = anchoredLineFrame ?? nativeFrame ?? frame;
          const standardEndpoints = connectorPoints(endpointFrame, transform);
          const transformBox = { ...endpointFrame, rotation, flipX: !!common.flipX, flipY: !!common.flipY };
          const sourceEndpoints = elbowEndpoints ? {
            start: connectorLocalToWorld({ x: elbowEndpoints.start.x * endpointFrame.width, y: elbowEndpoints.start.y * endpointFrame.height }, transformBox),
            end: connectorLocalToWorld({ x: elbowEndpoints.end.x * endpointFrame.width, y: elbowEndpoints.end.y * endpointFrame.height }, transformBox),
          } : standardEndpoints;
          const endpoints = nativeFrame && !anchoredLineFrame ? { start: rebase.point(sourceEndpoints.start), end: rebase.point(sourceEndpoints.end) } : sourceEndpoints;
          const nonvisual = child(child(object, "nvCxnSpPr"), "cNvCxnSpPr");
          const line = child(properties, "ln");
          let lineSheet = grow(sheet, anchor.row, anchor.column);
          for (const point of [endpoints.start, endpoints.end]) {
            const endpointAnchor = anchorFromFrame({ ...frame, x: Math.max(0, point.x), y: Math.max(0, point.y) }, grid);
            if (endpointAnchor) lineSheet = grow(lineSheet, endpointAnchor.row, endpointAnchor.column);
          }
          const boundsIssue = importedLineBoundsIssue(endpoints, lineSheet);
          if (boundsIssue) { omitted(context, sheet, `${boundsIssue}。対応範囲外の線を省略しました`); continue; }
          sheet = lineSheet;
          const style = child(object, "style"), startArrow = readLineArrow(line, "headEnd", context, sheet), endArrow = readLineArrow(line, "tailEnd", context, sheet);
          drawing = withLinePoints(sheet, { ...common, width: Math.max(1, common.width), height: Math.max(1, common.height), type: "shape",
            shape: nativeLine && (startArrow !== "none" || endArrow !== "none") ? "arrow" : "line",
            fill: nativeLine ? drawingFill(properties, drawingColor(child(style, "fillRef"), context) ?? "transparent", context, sheet) : "transparent",
            stroke: drawingFill(line, drawingColor(child(style, "lnRef"), context) ?? "#000000", context, sheet), strokeWidth: originalStroke,
            ...content, ...(elbow ? { routing: "elbow" as const } : {}), startArrow, endArrow }, endpoints);
          pending.push({ drawingId: drawing.id, label: objectLabel, scope: relation.target, points: endpoints, start: child(nonvisual, "stCxn"), end: child(nonvisual, "endCxn") });
          if (child(line, "prstDash")?.attributes.val && child(line, "prstDash")!.attributes.val !== "solid") adjusted(context, sheet, "線の破線を実線へ変更しました");
        } else if (localName(object.name) === "pic") {
          const blipFill = child(object, "blipFill"), blip = child(blipFill, "blip"), media = related.get(attribute(blip, "embed") ?? "");
          if (!media || media.external || !media.type.endsWith("/image") || attribute(blip, "link")) { omitted(context, sheet, "外部リンクの画像を省略しました"); continue; }
          imageResource = await readDrawingImage(media.target, context);
          if (!imageResource) { omitted(context, sheet, `${objectLabel}の未対応または不正な画像を省略しました（PNG・JPEG・GIF・WebPに対応）`); continue; }
          const resourceId = imageResource.id;
          const size = getImageDisplaySize(imageResource.resource);
          // Excel pictures stretch to their frame. Only legacy LikeX connector
          // targets use contain; their fillRect encodes centered letterboxing.
          // The imageFill tag has identical connection geometry and keeps fill.
          const fit = customKind === "image" ? "contain" : "fill";
          const fillRect = child(child(blipFill, "stretch"), "fillRect");
          const scale = Math.min(frame.width / size.width, frame.height / size.height);
          const expected = fit === "contain" ? {
            l: (1 - size.width * scale / frame.width) * 50_000,
            t: (1 - size.height * scale / frame.height) * 50_000,
          } : { l: 0, t: 0 };
          if ((["l", "t", "r", "b"] as const).some(side => {
            const actual = fillRect?.attributes[side] === undefined ? 0 : finiteNumber(fillRect.attributes[side]);
            return actual === undefined || Math.abs(actual - expected[side === "l" || side === "r" ? "l" : "t"]) > 1;
          })) omitted(context, sheet, "画像の塗りつぶし範囲の調整を省略しました");
          if (child(blipFill, "srcRect") || child(blipFill, "tile")) omitted(context, sheet, "画像のトリミング・タイル表示を省略しました");
          const nonvisual = child(child(object, "nvPicPr"), "cNvPr");
          drawing = { ...common, type: "image", resourceId, fit, alt: nonvisual?.attributes.descr ?? nonvisual?.attributes.name ?? "" };
        } else {
          const nonvisual = child(child(object, "nvSpPr"), "cNvSpPr"), isTextBox = ["1", "true"].includes(nonvisual?.attributes.txBox ?? "");
          const preset = child(properties, "prstGeom"), presetName = preset?.attributes.prst;
          if (!isTextBox && (!customKind && child(properties, "custGeom") || !(isSpreadsheetShapeKind(customKind) || SPREADSHEET_SHAPES.some(item => getShapeDefinition(item.kind).xlsxPreset === presetName)))) {
            omitted(context, sheet, "未対応の種類の図形を省略しました"); continue;
          }
          const content = drawingText(child(object, "txBody"), context, sheet, child(child(object, "style"), "fontRef"));
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
            let shape = isSpreadsheetShapeKind(customKind) ? customKind : SPREADSHEET_SHAPES.find(item => getShapeDefinition(item.kind).xlsxPreset === presetName)?.kind;
            const line = child(properties, "ln");
            const head = child(line, "headEnd"), tail = child(line, "tailEnd");
            const hasHead = !!head && !!head.attributes.type && head.attributes.type !== "none";
            const hasTail = !!tail && !!tail.attributes.type && tail.attributes.type !== "none";
            if (presetName === "line" && (hasHead || hasTail)) shape = "arrow";
            if (!shape || child(properties, "custGeom") && !customKind) { omitted(context, sheet, "未対応の種類の図形を省略しました"); continue; }
            const strokeWidth = child(line, "noFill") ? 0 : Math.min(100, Math.max(0, (finiteNumber(line?.attributes.w) ?? 9525) / EMU_PER_PIXEL));
            if (line?.attributes.w && strokeWidth !== Number(line.attributes.w) / EMU_PER_PIXEL) adjusted(context, sheet, "図形の線幅を対応範囲へ調整しました");
            if (child(line, "prstDash")?.attributes.val && child(line, "prstDash")!.attributes.val !== "solid") adjusted(context, sheet, "図形の破線を実線へ変更しました");
            const guide = children(child(preset, "avLst"), "gd"), definition = getShapeDefinition(shape), adjustment = definition.xlsxAdjustment;
            const radiusGuide = shape === "roundedRectangle" ? guide.find(item => item.attributes.name === "adj") : undefined;
            const radiusValue = radiusGuide && /^val\s+[+-]?\d+(?:\.\d+)?$/.test(radiusGuide.attributes.fmla ?? "")
              ? Number(radiusGuide.attributes.fmla.replace(/^val\s+/, "")) : undefined;
            const cornerRadiusRatio = shape === "roundedRectangle"
              ? customKind ? readOfficeConnectorCornerRadiusRatio(child(properties, "custGeom"))
                : radiusValue !== undefined && Number.isFinite(radiusValue) ? Math.min(0.5, Math.max(0, radiusValue / 100000)) : undefined
              : undefined;
            const expected = adjustment ? 100000 * adjustment.ratio * frame[adjustment.axis] / Math.min(frame.width, frame.height) : undefined;
            if (guide.some(item => {
              // New Office presets use their default guides; any explicit deformation is reported.
              if (definition.geometry.type === "office") return true;
              const value = Number(item.attributes.fmla?.replace(/^val\s+/, ""));
              if (shape === "roundedRectangle" && item.attributes.name === "adj") return radiusValue === undefined || radiusValue < 0 || radiusValue > 50000;
              return adjustment && item.attributes.name === adjustment.name ? Math.abs(value - expected!) > 1
                : item.attributes.name === "adj1" ? value !== 50000 : !(shape === "triangle" && item.attributes.name === "adj" && value === 50000);
            })) adjusted(context, sheet, "図形の細かな変形を標準の形状へ近似しました");
            drawing = { ...common, ...(presetName === "line" ? { startArrow: readLineArrow(line, "headEnd", context, sheet), endArrow: readLineArrow(line, "tailEnd", context, sheet) } : {}),
              type: "shape", shape, ...(cornerRadiusRatio !== undefined ? { cornerRadiusRatio } : {}), fill, stroke: drawingFill(line, drawingColor(child(style, "lnRef"), context) ?? "#000000", context, sheet), strokeWidth, ...content };
          }
        }
        sheet = grow(sheet, anchor.row, anchor.column);
        const images = imageResource ? { ...context.resources, [imageResource.id]: imageResource.resource } : context.resources;
        const normalized = normalizeDrawing(drawing, sheet, { images });
        if (child(properties, "effectLst") || child(properties, "effectDag") || child(properties, "scene3d") || child(properties, "sp3d")) omitted(context, sheet, "描画オブジェクトの影・3D効果を省略しました");
        const nonvisualGroup = child(object, localName(object.name) === "pic" ? "nvPicPr" : connector ? "nvCxnSpPr" : "nvSpPr");
        const nativeId = child(nonvisualGroup, "cNvPr")?.attributes.id;
        if (nativeId) {
          const key = `${relation.target}:${nativeId}`;
          if (ambiguousIds.has(key) || targets.has(key)) { adjusted(context, sheet, "重複する描画IDの接続先を省略しました"); ambiguousIds.add(key); targets.delete(key); }
          else targets.set(key, { id: drawing.id, custom: !!customKind, preset: localName(object.name) === "pic" ? "rect" : child(properties, "prstGeom")?.attributes.prst,
            adjusted: !customKind && presetHasAdjustments(child(properties, "prstGeom")) });
        }

        imageResource?.commit();
        drawings.push(normalized);
        context.drawingCount = (context.drawingCount ?? 0) + 1;
      } catch (error) {
        rethrowImportFailure(error, context);
        sheet = originalSheet;
        pending.length = originalPendingCount;
        omitted(context, sheet, `${objectLabel}を省略しました: ${importFailureMessage(error)}`);
      }
    }
  }
  return drawings.length ? { ...sheet, drawings: connectImportedDrawings(sheet, drawings, pending, targets, context) } : sheet;
}
