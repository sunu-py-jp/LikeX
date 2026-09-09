"use client";

import { useExplorerFields } from "../state/explorer-context";
import type { ExplorerCustomMenu } from "../state/use-explorer-context-menu";
import { ContextMenu } from "./explorer-overlays";
import { menuItemClass, menuSeparatorClass } from "./explorer-controls";

export function ExplorerCustomMenuItems({ menu, separate = false, defer }: {
  menu: ExplorerCustomMenu | null;
  separate?: boolean;
  defer: (action: () => void) => void;
}) {
  const { runCustomContextMenu, customContextMenuBusy, saving, refreshing } = useExplorerFields(
    "runCustomContextMenu", "customContextMenuBusy", "saving", "refreshing",
  );
  if (!menu?.items.length) return null;
  return <>
    {separate && <ContextMenu.Separator className={menuSeparatorClass} />}
    {menu.items.map(item => <ContextMenu.Item key={item.id} className={menuItemClass}
      disabled={item.disabled || customContextMenuBusy || saving || refreshing}
      onSelect={() => defer(() => { void runCustomContextMenu(menu, item); })}>
      {item.icon}{item.label}
    </ContextMenu.Item>)}
  </>;
}
