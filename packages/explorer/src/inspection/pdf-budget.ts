import { EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS, resolvePdfInspectionLimits, type ResolvedExplorerPdfInspectionLimits } from "../model/pdf-inspection-limits";

/** Internal compatibility alias; parsing always uses the current budget's limits. */
export const PDF_INSPECTION_LIMITS = EXPLORER_DEFAULT_PDF_INSPECTION_LIMITS;

export function invalidPdf(reason = "ページ構造が不正です"): never {
  throw new Error(`PDFを確認できません: ${reason}`);
}
export function pdfLimit(): never { return invalidPdf("安全な読み込み上限を超えています"); }

/** All state is per inspection. Cooperative checkpoints stop actual parser work. */
export class PdfBudget {
  private workUsed = 0;
  private lastYield = 0;
  private decoded = 0;
  private nodes = 0;
  readonly limits: ResolvedExplorerPdfInspectionLimits;
  private readonly deadline: number;
  constructor(readonly signal: AbortSignal, limits?: unknown) {
    this.limits = resolvePdfInspectionLimits(limits);
    this.deadline = Date.now() + this.limits.timeoutMs;
  }

  work(amount = 1): void {
    this.signal.throwIfAborted();
    if (Date.now() >= this.deadline) invalidPdf("ファイル情報の確認がタイムアウトしました");
    if (!Number.isSafeInteger(amount) || amount < 0 || amount > this.limits.work - this.workUsed) pdfLimit();
    this.workUsed += amount;
  }
  value(): void {
    this.work();
    if (this.nodes >= this.limits.values) pdfLimit();
    this.nodes++;
  }
  /** Charge every intermediate filter result before retaining/allocating it. */
  decodedBytes(amount: number): void {
    this.work(amount);
    if (amount > this.limits.decodedBytes - this.decoded) pdfLimit();
    this.decoded += amount;
  }
  async checkpoint(force = false): Promise<void> {
    this.work(0);
    if (force || this.workUsed - this.lastYield >= 16_384) {
      this.lastYield = this.workUsed;
      await new Promise<void>(resolve => setTimeout(resolve, 0));
      this.work(0);
    }
  }
}
