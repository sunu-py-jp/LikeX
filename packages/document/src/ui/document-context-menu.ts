import type { ContextMenuAction } from "../browser";
import { documentSchema, getBlock, getDocumentText, DOCUMENT_LIMITS } from "../model/index";
import type { DocumentCommand } from "../model/types";
import type { DocumentEditor } from "../state/use-document-editor";

export type DocumentContextTarget = { kind: "image" | "table"; id: string } | { kind: "document" };
type MenuEnvironment = { isCurrent(): boolean; focus(): void; copyText?: (text: string) => Promise<void> };

/** The menu captures a snapshot, while every action reads the current controller again. */
export function createDocumentContextMenuItems(getEditor: () => DocumentEditor, target: DocumentContextTarget, environment: MenuEnvironment): ContextMenuAction[] {
  const initial = getEditor(), snapshot = initial.session.getSnapshot();
  const policy = JSON.stringify(initial.features);
  const isCurrent = () => {
    const editor = getEditor();
    return environment.isCurrent() && editor.session.getSnapshot() === snapshot && editor.readOnly === initial.readOnly && JSON.stringify(editor.features) === policy;
  };
  const items: ContextMenuAction[] = [];
  function add(id: string, label: string, action: () => unknown, options: { write?: boolean; disabled?: boolean; danger?: boolean; separatorBefore?: boolean } = {}) {
    if (options.write && initial.readOnly) return;
    items.push({ id, label, disabled: !!initial.busy || options.disabled, danger: options.danger, separatorBefore: options.separatorBefore,
      onSelect: () => {
        if (!isCurrent() || getEditor().busy || options.disabled || (options.write && !getEditor().editable)) return;
        return action();
      } });
  }
  async function execute(command: DocumentCommand) {
    const result = await getEditor().execute(command, { isCurrent });
    if (result && environment.isCurrent()) environment.focus();
  }
  if (target.kind === "document") {
    const text = getDocumentText(snapshot.document);
    add("document-copy", "文書全体をコピー", () => environment.copyText?.(text), { disabled: !environment.copyText || !text });
    add("document-select", "文書全体を選択", () => {
      getEditor().select({ from: 0, to: documentSchema.nodeFromJSON(snapshot.document.content).content.size }); environment.focus();
    });
    if (initial.features.history) {
      add("document-undo", "元に戻す", () => getEditor().history("undo", isCurrent), { write: true, disabled: !snapshot.canUndo, separatorBefore: true });
      add("document-redo", "やり直す", () => getEditor().history("redo", isCurrent), { write: true, disabled: !snapshot.canRedo });
    }
    return items;
  }
  if (!initial.features[target.kind === "image" ? "images" : "tables"]) return items;
  const block = getBlock(snapshot.document, target.id);
  if (!block || block.node.type !== target.kind) return items;
  const name = target.kind === "image" ? "画像" : "表";
  add(`${target.kind}-select`, `${name}を選択`, () => { getEditor().select({ from: block.from, to: block.to }); environment.focus(); });
  if (block.node.type === "image") {
    const { src, alt, width, height } = block.node.attrs;
    add("image-duplicate", "画像を複製", () => execute({ type: "image.insert", at: block.to, src, alt, width, height }), { write: true });
    for (const [scale, label] of [[.8, "画像を縮小 (80%)"], [1.25, "画像を拡大 (125%)"]] as const) {
      const nextWidth = width! * scale, nextHeight = height! * scale;
      add(scale < 1 ? "image-shrink" : "image-enlarge", label, () => execute({ type: "image.update", id: block.id, width: nextWidth }),
        { write: true, disabled: Math.min(nextWidth, nextHeight) < 1 || Math.max(nextWidth, nextHeight) > DOCUMENT_LIMITS.imageDimension });
    }
  }
  add(`${target.kind}-delete`, `${name}を削除`, () => execute({ type: "block.delete", id: block.id }), { write: true, danger: true, separatorBefore: true });
  return items;
}

/** Ordinary text keeps the browser menu, including spelling and native clipboard actions. */
export function resolveDocumentContextTarget(target: HTMLElement, viewport: HTMLElement): { target: DocumentContextTarget; anchor: HTMLElement } | null {
  if (!viewport.contains(target)) return null;
  const image = target.closest<HTMLElement>("img[data-document-id]");
  if (!image && target.closest("p,h1,h2,h3,h4,h5,h6,a,input,textarea,button,select")) return null;
  const table = target.closest<HTMLElement>("table[data-document-id]");
  const resource = image ?? table;
  if (resource && viewport.contains(resource)) return { target: { kind: image ? "image" : "table", id: resource.getAttribute("data-document-id")! }, anchor: resource };
  if (target.closest(".lxd-editor,input,textarea,button,select,a,[contenteditable=true]")) return null;
  return { target: { kind: "document" }, anchor: viewport };
}
