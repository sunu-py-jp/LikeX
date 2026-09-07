import type {
  ExplorerDownloadContext,
  ExplorerDownloadHandler,
  ExplorerDownloadRequest,
  ExplorerDownloadResult,
  ExplorerEvent,
  ExplorerPopupProps,
  ExplorerProps,
} from "../src";

export const handOff: ExplorerDownloadHandler = (request, context) => {
  context.reportProgress({ phase: "accepted" });
  context.reportProgress({ phase: "preparing", message: request.name });
  context.reportProgress({ phase: "ready" });
  context.reportProgress({ phase: "transferring" });
  return { status: "handed-off", message: "ブラウザーへ依頼しました" };
};
export const complete: ExplorerDownloadHandler = async () => ({ status: "completed" });
export const cancel: ExplorerDownloadHandler = () => ({ status: "cancelled" });
export const explorer = { initialEntries: [], onDownloadRequest: handOff } satisfies ExplorerProps;
export const popup = { ...explorer, renderTrigger: () => null } satisfies ExplorerPopupProps;

// @ts-expect-error A delegated download must explicitly report its terminal result.
export const missingAsyncResult: ExplorerDownloadHandler = async () => {};
// @ts-expect-error Synchronous void is not a terminal result either.
export const missingSyncResult: ExplorerDownloadHandler = () => {};
// @ts-expect-error A progress phase cannot be returned as the terminal result.
export const invalidResult = { status: "ready" } satisfies ExplorerDownloadResult;

export function rejectInvalidProgress(context: ExplorerDownloadContext) {
  // @ts-expect-error Progress must include a defined phase.
  context.reportProgress({ message: "準備中" });
  // @ts-expect-error Undefined is not a progress phase.
  context.reportProgress({ phase: undefined });
  // @ts-expect-error Terminal states belong to the result, not progress.
  context.reportProgress({ phase: "completed" });
  // @ts-expect-error Cancellation is also a terminal result.
  context.reportProgress({ phase: "cancelled" });
}

export function rejectPayloadMutations(request: ExplorerDownloadRequest, context: ExplorerDownloadContext) {
  // @ts-expect-error Request metadata is a readonly snapshot.
  request.name = "changed.txt";
  // @ts-expect-error Request paths cannot be reassigned by the host.
  request.path = "/changed.txt";
  if (request.source?.kind === "existing") {
    // @ts-expect-error Nested source metadata is readonly too.
    request.source.id = "other-content";
  }
  // @ts-expect-error The context cannot replace its manifest.
  context.items = [];
  // @ts-expect-error The manifest array is readonly.
  context.items.push(context.items[0]);
  const item = context.items[0];
  if (item) {
    // @ts-expect-error Manifest metadata is readonly.
    item.name = "changed.txt";
    // @ts-expect-error Archive paths are part of the fixed snapshot.
    item.archivePath = "other/changed.txt";
    if (item.source?.kind === "existing") {
      // @ts-expect-error Manifest source metadata is readonly.
      item.source.id = "other-content";
    }
    if (item.source?.kind === "local") {
      const original: File = item.source.file;
      // @ts-expect-error File bodies remain accessible but their reference is readonly.
      item.source.file = new File([original], "replacement.txt");
    }
  }
}

export function readCompatibleSuccess(event: ExplorerEvent) {
  if (event.type !== "download" || event.status !== "success") return;
  // Older producers may omit result; success can never contain cancelled.
  const status: "handed-off" | "completed" | undefined = event.result?.status;
  return { status, message: event.result?.message, request: event.request };
}
