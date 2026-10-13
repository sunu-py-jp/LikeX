export { readOfficeRelationships as readRelationships, resolveOfficePart as resolvePart } from "../ooxml";
export type { OfficeRelationship as XlsxRelationship } from "../ooxml";
import { readOfficeRelationships, type OfficeRelationship } from "../ooxml";
import type { ImportContext } from "./types";

/** Missing display/auxiliary parts can be dropped without inventing cell or formula data. */
export function readImportRelationships(part: string, context: ImportContext, onMissingTarget?: (relation: Readonly<OfficeRelationship>) => void) {
  return readOfficeRelationships(context.archive, part, { onMissingTarget: relation => {
    if (/\/(?:officeDocument|worksheet|sharedStrings)$/.test(relation.type) || /vbaProject|attachedTemplate/i.test(relation.type))
      throw new Error(`Excelファイルを読み込めません: 必須の参照先がありません（${part || "ルート"}: ${relation.id} → ${relation.target}）`);
    onMissingTarget?.(relation);
    context.warn({ code: "omitted", message: `参照先がない補助データを省略しました（${part || "ルート"}: ${relation.id} → ${relation.target}）` });
  } });
}
