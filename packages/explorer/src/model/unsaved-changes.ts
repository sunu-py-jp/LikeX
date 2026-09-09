import { createUnsavedChangesGuard as createGuard } from "../core";

/** Keep the shared-draft popup wording while reusing the common browser guard. */
export function createUnsavedChangesGuard() {
  return createGuard({ closeMessage: "未保存の変更があります。このウィンドウを閉じますか？\n変更は親画面に保持されます。" });
}

export type UnsavedChangesGuard = ReturnType<typeof createUnsavedChangesGuard>;
