import type {
  ExplorerDraftOptions,
  ExplorerEditContext,
  ExplorerEditHandler,
  ExplorerEditIntent,
  ExplorerEditMode,
  ExplorerEditRequest,
  ExplorerEditResult,
  ExplorerEditState,
  ExplorerEvent,
  ExplorerPopupProps,
  ExplorerProps,
  ExplorerUploadResult,
} from "../src";

export const allow: ExplorerEditHandler = () => true;
export const deny: ExplorerEditHandler = async () => false;
export const refresh: ExplorerEditHandler = async (request, context) => {
  const signal: AbortSignal = context.signal;
  if (signal.aborted || !request.windowId) return false;
  return { allowed: true, entries: [] };
};
export const intent = { action: "upload", parent: "root", windowId: "child" } satisfies ExplorerEditIntent;
export const explorer = { initialEntries: [], onSave() {}, onEditRequest: refresh } satisfies ExplorerProps;
export const popup = { ...explorer, renderTrigger: () => null } satisfies ExplorerPopupProps;
export const draft = { ...explorer } satisfies ExplorerDraftOptions;

// @ts-expect-error Permission handlers must return an explicit decision.
export const missingDecision: ExplorerEditHandler = async () => {};
// @ts-expect-error Denial is false; only successful objects carry fresh entries.
export const invalidDecision = { allowed: false, entries: [] } satisfies ExplorerEditResult;
// @ts-expect-error Edit modes form a closed union.
export const invalidMode = "editing" satisfies ExplorerEditMode;
// @ts-expect-error Viewing operations do not acquire edit permission.
export const invalidIntent = { action: "download" } satisfies ExplorerEditIntent;

export function rejectPermissionPayloadMutation(request: ExplorerEditRequest, context: ExplorerEditContext) {
  // @ts-expect-error Request identifiers are readonly.
  request.ids.push("another-id");
  // @ts-expect-error Request metadata is a readonly snapshot.
  request.items[0].name = "Changed";
  const source = request.items[0].source;
  if (source?.kind === "existing") {
    // @ts-expect-error Nested content identity is readonly.
    source.id = "different-content";
  }
  // @ts-expect-error The host cannot replace the component's abort signal.
  context.signal = new AbortController().signal;
}

export function readEditState(hook: ReturnType<typeof import("../src").useExplorerDraft>) {
  const mode: ExplorerEditMode = hook.editMode;
  const error: string | null = hook.editError;
  const state: ExplorerEditState = hook.getEditState();
  const revision: number = hook.editRevision;
  const currentRevision: number = hook.getEditRevision();
  const preparedAction: null | (() => boolean) = hook.prepareAction({ action: "create", name: "Folder" });
  const preparedAdd: { result: ExplorerUploadResult; commit(): ExplorerUploadResult | undefined } | undefined = hook.prepareAdd([], "root");
  const decision: boolean | Promise<boolean> = hook.requestEdit(intent);
  hook.cancelEditRequest("child");
  hook.endEdit();
  const save: Promise<boolean> = hook.save("child");
  return { mode, error, state, revision, currentRevision, preparedAction, preparedAdd, decision, save };
}

export function observeMode(event: ExplorerEvent) {
  if (event.type !== "edit-mode") return;
  const mode: ExplorerEditMode = event.mode;
  return { mode, reason: event.reason, requestId: event.requestId, action: event.request.action };
}
