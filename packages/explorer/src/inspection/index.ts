import type { ExplorerUploadContentMetadata, ExplorerUploadInspectFileRequest } from "../model/upload-content";
import { resolvePdfInspectionLimits } from "../model/pdf-inspection-limits";

/** Built-in readers inspect metadata only; they never upload, render, or play a file. */
export async function inspectExplorerUploadFile(request: ExplorerUploadInspectFileRequest): Promise<ExplorerUploadContentMetadata> {
  request.signal.throwIfAborted();
  const pdfInspectionLimits = request.kind === "pdf" ? resolvePdfInspectionLimits(request.pdfInspectionLimits) : undefined;
  const controller = new AbortController();
  const abort = () => controller.abort(request.signal.reason);
  request.signal.addEventListener("abort", abort, { once: true });
  const timeout = setTimeout(() => controller.abort(new Error("ファイル情報の確認がタイムアウトしました")), pdfInspectionLimits?.timeoutMs ?? 30_000);
  try {
    const scoped = { ...request, ...(pdfInspectionLimits ? { pdfInspectionLimits } : {}), signal: controller.signal };
    const operation = async (): Promise<ExplorerUploadContentMetadata> => {
      switch (scoped.kind) {
        case "video": case "audio": {
          const { inspectMedia } = await import("./media");
          scoped.signal.throwIfAborted();
          return inspectMedia(scoped);
        }
        case "pdf": {
          const { inspectPdf } = await import("./pdf");
          scoped.signal.throwIfAborted();
          return inspectPdf(scoped);
        }
        case "presentation": {
          const { inspectPresentation } = await import("./presentation");
          scoped.signal.throwIfAborted();
          return inspectPresentation(scoped);
        }
        default: throw new Error("ファイル情報の確認に対応していない形式です");
      }
    };
    // File.arrayBuffer cannot always stop in-flight I/O. Reject immediately on
    // cancellation; built-in parsers also check the signal inside their work.
    return await new Promise<ExplorerUploadContentMetadata>((resolve, reject) => {
      const cancel = () => reject(controller.signal.reason);
      controller.signal.addEventListener("abort", cancel, { once: true });
      operation().then(value => { controller.signal.throwIfAborted(); return value; }).then(resolve, reject)
        .finally(() => controller.signal.removeEventListener("abort", cancel));
    });
  } finally {
    clearTimeout(timeout);
    request.signal.removeEventListener("abort", abort);
  }
}
