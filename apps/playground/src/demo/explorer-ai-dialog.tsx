import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import type { ExplorerContextMenuContext, ExplorerItemInfo } from "@likex/explorer";
import "./explorer-ai-dialog.css";

type Request = {
  id: number;
  entry: ExplorerItemInfo;
  container: HTMLElement;
  filename: string;
  busy: boolean;
};
type PendingRequest = {
  id: number;
  timer?: ReturnType<typeof setTimeout>;
  cleanup: () => void;
  resolve: (file: File | undefined) => void;
};

function resultFilename(entry: ExplorerItemInfo, context: ExplorerContextMenuContext): string {
  const base = entry.name.replace(/\.[^.]+$/, "") || entry.name;
  const used = new Set(context.getEntries().filter(item => item.parent === entry.parent).map(item => item.name));
  const stem = `${base}-AI指示結果`;
  let filename = `${stem}.txt`, suffix = 2;
  while (used.has(filename)) filename = `${stem} (${suffix++}).txt`;
  return filename;
}

/** Parent-owned mock UI. Only the returned File is later applied by Explorer. */
export function useExplorerAiDialog() {
  const [request, setRequest] = useState<Request | null>(null);
  const pending = useRef<PendingRequest | null>(null);
  const sequence = useRef(0);
  const finish = useCallback((file?: File) => {
    const current = pending.current;
    if (!current) return;
    pending.current = null;
    clearTimeout(current.timer);
    current.cleanup();
    current.resolve(file);
    setRequest(null);
  }, []);

  useEffect(() => () => {
    const current = pending.current;
    pending.current = null;
    if (current) {
      clearTimeout(current.timer);
      current.cleanup();
      current.resolve(undefined);
    }
  }, []);

  const generate = useCallback((context: ExplorerContextMenuContext, signal: AbortSignal): Promise<File | undefined> => {
    finish();
    if (signal.aborted || context.target.kind !== "entry" || context.target.entry.kind !== "file")
      return Promise.resolve(undefined);
    const container = context.container;
    if (!container?.isConnected) return Promise.resolve(undefined);
    const entry = context.target.entry;
    return new Promise(resolve => {
      const id = ++sequence.current;
      const abort = () => { if (pending.current?.id === id) finish(); };
      pending.current = { id, resolve, cleanup: () => signal.removeEventListener("abort", abort) };
      signal.addEventListener("abort", abort, { once: true });
      setRequest({ id, entry, container, filename: resultFilename(entry, context), busy: false });
    });
  }, [finish]);

  const execute = useCallback((instruction: string) => {
    if (!request || request.busy || !instruction.trim() || pending.current?.id !== request.id) return;
    setRequest({ ...request, busy: true });
    pending.current.timer = setTimeout(() => {
      if (pending.current?.id !== request.id) return;
      const text = [
        "AIに指示 — デモのモック結果",
        "",
        `対象ファイル: ${request.entry.name}`,
        `対象パス: ${request.entry.path}`,
        "",
        "入力された指示:",
        instruction.trim(),
        "",
        "これは動作確認用のテキストです。外部のAIサービスへの送信や本文の解析は行っていません。",
        "結果は元のファイルと同じフォルダに追加され、保存ボタンを押すまでは下書きとして保持されます。",
        "",
      ].join("\n");
      finish(new File([text], request.filename, { type: "text/plain" }));
    }, 1500);
  }, [request, finish]);

  return {
    generate,
    // Once submitted, the component's progress/cancel UI takes over. Keeping a
    // modal open here would prevent editing even in confirm/reject modes.
    dialog: request && !request.busy ? createPortal(
      <InstructionDialog key={request.id} request={request} onCancel={() => finish()} onExecute={execute} />,
      request.container,
    ) : null,
  };
}

function InstructionDialog({ request, onCancel, onExecute }: {
  request: Request;
  onCancel: () => void;
  onExecute: (instruction: string) => void;
}) {
  const [instruction, setInstruction] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const id = useId();
  useEffect(() => {
    const ownerDocument = request.container.ownerDocument;
    const previous = ownerDocument.activeElement as HTMLElement | null;
    textarea.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, [request.container]);

  const keyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // Parent Explorer shortcuts must not consume text or close a different UI.
    event.stopPropagation();
    if (event.key === "Escape") { event.preventDefault(); onCancel(); return; }
    if (event.key !== "Tab") return;
    const focusable = Array.from(panel.current?.querySelectorAll<HTMLElement>("textarea:not([disabled]),button:not([disabled])") ?? []);
    const first = focusable[0], last = focusable[focusable.length - 1];
    const active = request.container.ownerDocument.activeElement;
    if (event.shiftKey && active === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && active === last) { event.preventDefault(); first?.focus(); }
  };

  return <div className="likex-demo-ai-backdrop" onKeyDown={keyDown}
    onPointerDown={event => { event.stopPropagation(); if (event.target === event.currentTarget) onCancel(); }}
    onClick={event => event.stopPropagation()} onContextMenu={event => { event.preventDefault(); event.stopPropagation(); }}>
    <div ref={panel} className="likex-demo-ai-dialog" role="dialog" aria-modal="true"
      aria-labelledby={`${id}-title`} aria-describedby={`${id}-description`} aria-busy={request.busy}>
      <h2 id={`${id}-title`}>AIに指示</h2>
      <p id={`${id}-description`}>「{request.entry.name}」への指示を入力してください。デモの結果を同じフォルダへテキストファイルとして追加します。</p>
      <form onSubmit={event => { event.preventDefault(); onExecute(instruction); }}>
        <label htmlFor={`${id}-instruction`}>指示</label>
        <textarea ref={textarea} id={`${id}-instruction`} value={instruction} readOnly={request.busy}
          onChange={event => setInstruction(event.target.value)} rows={5} maxLength={4000}
          placeholder="例：重要なポイントをまとめてください" />
        <p className="likex-demo-ai-status" role="status">{request.busy ? "モックの処理を実行しています…" : "実際のAIサービスには接続しません。"}</p>
        <div className="likex-demo-ai-actions">
          <button type="button" onClick={onCancel}>キャンセル</button>
          <button type="submit" className="likex-demo-ai-execute" disabled={request.busy || !instruction.trim()}>
            {request.busy ? "実行中…" : "実行"}
          </button>
        </div>
      </form>
    </div>
  </div>;
}
