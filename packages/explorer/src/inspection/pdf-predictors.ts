import { PdfBudget, invalidPdf, pdfLimit } from "./pdf-budget";
import { pdfInteger, type PdfDict } from "./pdf-values";

const malformed = (): never => invalidPdf("PDFの予測フィルターが不正です");

/** Undo TIFF/PNG prediction after a bounded Flate/LZW decode. */
export async function applyPdfPredictor(bytes: Uint8Array, params: PdfDict | undefined, budget: PdfBudget): Promise<Uint8Array> {
  const predictor = pdfInteger(params?.get("Predictor") ?? 1, 15);
  if (predictor === 1) return bytes;
  if (predictor !== 2 && predictor < 10) malformed();
  const colors = pdfInteger(params?.get("Colors") ?? 1, budget.limits.streamBytes);
  const columns = pdfInteger(params?.get("Columns") ?? 1, budget.limits.streamBytes);
  const bits = pdfInteger(params?.get("BitsPerComponent") ?? 8, 16);
  if (!colors || !columns || ![1, 2, 4, 8, 16].includes(bits)) malformed();
  const samples = colors * columns, rowBits = samples * bits;
  if (!Number.isSafeInteger(samples) || !Number.isSafeInteger(rowBits) || Math.ceil(rowBits / 8) > budget.limits.streamBytes) pdfLimit();
  const rowBytes = Math.ceil(rowBits / 8), stride = rowBytes + (predictor === 2 ? 0 : 1);
  if (bytes.length % stride) malformed();
  const length = bytes.length / stride * rowBytes;
  if (length > budget.limits.streamBytes) pdfLimit();
  budget.decodedBytes(length);
  const result = new Uint8Array(length);
  const pixelBytes = Math.ceil(colors * bits / 8);
  for (let source = 0, target = 0; source < bytes.length; source += stride, target += rowBytes) {
    if (predictor === 2) {
      result.set(bytes.subarray(source, source + rowBytes), target);
      const mask = (1 << bits) - 1;
      const sample = (index: number) => {
        const bit = index * bits, byte = target + Math.floor(bit / 8);
        return bits === 16 ? result[byte] * 256 + result[byte + 1] : result[byte] >>> (8 - bits - bit % 8) & mask;
      };
      for (let i = colors; i < samples; i++) {
        if ((i - colors) % 4096 === 0) { budget.work(Math.min(4096, samples - i)); await budget.checkpoint(); }
        const value = (sample(i) + sample(i - colors)) & mask;
        const bit = i * bits, byte = target + Math.floor(bit / 8);
        if (bits === 16) { result[byte] = value >>> 8; result[byte + 1] = value & 255; }
        else { const shift = 8 - bits - bit % 8; result[byte] = result[byte] & ~(mask << shift) | value << shift; }
      }
    } else {
      const filter = bytes[source];
      if (filter > 4) malformed();
      for (let i = 0; i < rowBytes; i++) {
        if (i % 4096 === 0) { budget.work(Math.min(4096, rowBytes - i)); await budget.checkpoint(); }
        const left = i >= pixelBytes ? result[target + i - pixelBytes] : 0;
        const up = target >= rowBytes ? result[target + i - rowBytes] : 0;
        const upperLeft = target >= rowBytes && i >= pixelBytes ? result[target + i - rowBytes - pixelBytes] : 0;
        let prediction = 0;
        if (filter === 1) prediction = left;
        else if (filter === 2) prediction = up;
        else if (filter === 3) prediction = Math.floor((left + up) / 2);
        else if (filter === 4) {
          const p = left + up - upperLeft, a = Math.abs(p - left), b = Math.abs(p - up), c = Math.abs(p - upperLeft);
          prediction = a <= b && a <= c ? left : b <= c ? up : upperLeft;
        }
        result[target + i] = (bytes[source + 1 + i] + prediction) & 255;
      }
    }
    budget.work();
    await budget.checkpoint();
  }
  return result;
}
