import { invalidPdf } from "./pdf-budget";

export type PdfName = { readonly kind: "name"; readonly value: string };
export type PdfRef = { readonly kind: "ref"; readonly object: number; readonly generation: number };
export type PdfString = { readonly kind: "string" };
export type PdfValue = null | boolean | number | PdfName | PdfRef | PdfString | PdfValue[] | PdfDict;
export type PdfDict = Map<string, PdfValue>;
export const isPdfName = (value: PdfValue | undefined, name: string): boolean =>
  !!value && typeof value === "object" && "kind" in value && value.kind === "name" && value.value === name;
export const isPdfRef = (value: PdfValue | undefined): value is PdfRef =>
  !!value && typeof value === "object" && "kind" in value && value.kind === "ref";
export const pdfInteger = (value: PdfValue | undefined, maximum = Number.MAX_SAFE_INTEGER): number => {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 || value > maximum) invalidPdf("整数値またはデータ位置が不正です");
  return value as number;
};
export const pdfDict = (value: PdfValue | undefined): PdfDict => {
  if (!(value instanceof Map)) invalidPdf("辞書が必要です");
  return value as PdfDict;
};
