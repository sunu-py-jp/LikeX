import type { ExplorerProps, ExplorerContextMenuProvider, ExplorerContextMenuChange, ExplorerContextMenuContext, ContextMenuExecutionMode } from "../src";

export const mode: ContextMenuExecutionMode = "confirm";
export const provider: ExplorerContextMenuProvider = context => {
  if (context.target.kind !== "entry" || context.target.entry.kind !== "file") return [];
  const entry = context.target.entry;
  return [{ id: "generate", label: "AIに指示", disabled: context.readOnly,
    async onSelect(context, operation) {
      if (operation.signal.aborted) return;
      const body = await context.readFile(entry.id);
      return { description: "同じフォルダに結果を追加", change: { type: "upload", parentId: entry.parent,
        files: [new File([body], "Result.txt")] } };
    },
  }];
};
export const props = { initialEntries: [], getContextMenuItems: provider, contextMenuExecutionMode: mode } satisfies ExplorerProps;
export const action: ExplorerContextMenuChange = { type: "action", action: { action: "rename", ids: ["file-id"], name: "New.txt" } };
// @ts-expect-error Execution modes are a closed union.
export const invalidMode: ContextMenuExecutionMode = "auto";
// @ts-expect-error Uploads accept File handles, never opaque storage URLs.
export const invalidPlan: ExplorerContextMenuChange = { type: "upload", parentId: "root", files: ["https://example.test/file"] };
// @ts-expect-error A provider is synchronous; work runs after onSelect.
export const invalidProvider: ExplorerContextMenuProvider = async () => [];
export function readonlyContext(context: ExplorerContextMenuContext) {
  // @ts-expect-error Snapshot selection cannot be reassigned.
  context.selectedEntries = [];
  if (context.target.kind === "entry") {
    // @ts-expect-error Captured item metadata is readonly.
    context.target.entry.name = "Changed.txt";
  }
}
