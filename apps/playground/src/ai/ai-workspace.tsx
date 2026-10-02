import { useCallback, useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import LikeAIChat, { createAIChat, type AIChatHandle, type AIChatProps, type AIChatSendHandler, type AIChatResponseChunk } from "@likex/aichat";
import { fetchAIConfig, recentAIMessages, requestAI, type AIConfig, type AIMessage, type AIResult } from "./ai-client";
import { type DocumentAdapter } from "./ai-document";
import { AIRunPart, ToolExecutionPart, createRunPart } from "./ai-trace-parts";
import "../../../../packages/aichat/src/styles.css";
import "./ai-workspace.css";

type Props = { adapter: DocumentAdapter; children: ReactNode; colorMode: "light" | "dark" | "system"; primaryColor?: string; onBusyChange?(busy: boolean): void };
const partRenderers: NonNullable<AIChatProps["partRenderers"]> = {
  "likex.run": (part, { message }) => <AIRunPart part={part} messageStatus={message.status}/>,
  "likex.tool": (part, { message }) => <ToolExecutionPart part={part} messageStatus={message.status}/>,
};
function Sparkles() {
  return <svg width="23" height="23" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true"><path d="m12 3 2.6 6.4L21 12l-6.4 2.6L12 21l-2.6-6.4L3 12l6.4-2.6L12 3Z"/><path d="m20 1 .8 2.2L23 4l-2.2.8L20 7l-.8-2.2L17 4l2.2-.8L20 1Z"/></svg>;
}
function NewChatIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 4H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h13a2 2 0 0 0 2-2v-7"/><path d="m16 3 5 5M9 15l1-5L18 2a2.1 2.1 0 0 1 3 3l-8 8-4 2Z"/></svg>;
}

export function AIWorkspace({ adapter, children, colorMode, primaryColor, onBusyChange }: Props) {
  const [open, setOpen] = useState(adapter.initialChatOpen ?? false), [busy, setBusy] = useState(false), [hasSent, setHasSent] = useState(false);
  const reportBusy = useCallback((value: boolean) => { setBusy(value); onBusyChange?.(value); }, [onBusyChange]);
  const [config, setConfig] = useState<AIConfig | null>(null), [configError, setConfigError] = useState(""), [configAttempt, setConfigAttempt] = useState(0);
  const [steps, setSteps] = useState<string[]>([]), [status, setStatus] = useState("");
  const [creatingChat, setCreatingChat] = useState(false), creatingChatRef = useRef(false);
  const mounted = useRef(false), active = useRef<AbortController | null>(null);
  const chat = useRef<AIChatHandle>(null), launcher = useRef<HTMLButtonElement>(null), drawer = useRef<HTMLElement>(null);
  const drawerId = useId(), titleId = useId();
  const [initialAIChat] = useState(() => createAIChat({ id: `demo-${adapter.module}-assistant`, title: `${adapter.label} AI`, conversations: [{ id: "assistant", title: "資料をAIと編集", messages: [] }] }));
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; active.current?.abort(); }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    void fetchAIConfig(controller.signal).then(value => { if (!controller.signal.aborted) setConfig(value); }, error => {
      if (!controller.signal.aborted) setConfigError(error instanceof Error ? error.message : "AIの設定を確認できませんでした。");
    });
    return () => controller.abort();
  }, [configAttempt]);
  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => {
      const input = drawer.current?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)");
      (input ?? drawer.current?.querySelector<HTMLButtonElement>("button"))?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [open]);

  const close = useCallback(() => {
    active.current?.abort(); chat.current?.cancel();
    setOpen(false); requestAnimationFrame(() => launcher.current?.focus());
  }, []);
  const newChat = useCallback(async () => {
    const handle = chat.current;
    if (!handle || !config?.configured || creatingChatRef.current) return;
    creatingChatRef.current = true; setCreatingChat(true);
    // Invalidate before aborting: late generator cleanup must not overwrite the new conversation's state.
    const pending = active.current; active.current = null;
    pending?.abort(); handle.cancel(); reportBusy(false);
    try {
      const id = crypto.randomUUID();
      const result = await handle.execute({ type: "conversation.add", id, title: "新しいチャット" });
      if (!mounted.current) return;
      if (!result || !handle.selectConversation(id)) {
        setStatus("新しいチャットを作成できませんでした。再試行してください。"); return;
      }
      setHasSent(false); setSteps([]); setStatus("");
      requestAnimationFrame(() => drawer.current?.querySelector<HTMLTextAreaElement>("textarea:not(:disabled)")?.focus());
    } finally {
      creatingChatRef.current = false;
      if (mounted.current) setCreatingChat(false);
    }
  }, [config, reportBusy]);
  const send: AIChatSendHandler = useCallback(async function* (request, context): AsyncGenerator<AIChatResponseChunk> {
    if (!config?.configured) throw new Error(".env に OpenAI または Azure OpenAI の設定を追加し、開発サーバーを再起動してください。");
    const controller = new AbortController(), abort = () => controller.abort(context.signal.reason);
    context.signal.addEventListener("abort", abort, { once: true });
    if (context.signal.aborted) abort();
    active.current?.abort(); active.current = controller;
    const isActive = () => mounted.current && active.current === controller;
    const signal = controller.signal;
    let runId: string | undefined, appliedBatches = 0;
    const targetId = crypto.randomUUID();
    const partIds = new Map<string, string>();
    reportBusy(true); setHasSent(true); setSteps([]); setStatus("現在の内容を確認しています…");
    try {
      const snapshot = await adapter.snapshot(signal);
      const messages = recentAIMessages(request.messages.filter(message => message.role === "user" || message.role === "assistant" && message.status === "complete")
        .map(message => ({ role: message.role as AIMessage["role"], content: message.content })));
      let answer = "", result: AIResult | undefined;
      for await (const event of requestAI({ module: adapter.module, document: snapshot.document, documentTitle: snapshot.documentTitle, selection: snapshot.selection, messages, targetId }, signal,
        async (operation, operationSignal) => {
          operationSignal.throwIfAborted();
          if (!isActive() || operation.targetId !== targetId) throw new DOMException("AIの操作を中止しました。", "AbortError");
          const reply = await adapter.live(operation, operationSignal);
          if (operation.action === "commit" && reply.changed) {
            appliedBatches++;
            if (isActive()) setStatus(`${appliedBatches}件の編集を反映しました。続けて作業しています…`);
          }
          return reply;
        })) {
        signal.throwIfAborted();
        if (!isActive()) throw new DOMException("AIの操作を中止しました。", "AbortError");
        if (event.type === "progress") { setSteps(previous => [...previous.slice(-19), event.message]); setStatus(event.message); }
        else if (event.type === "text") answer += event.text;
        else if (event.type === "run") {
          runId = event.id;
          yield { type: "part", part: createRunPart(event.id) };
        } else if (event.type === "tool") {
          const id = partIds.get(event.call.id) ?? `tool-${partIds.size + 1}`;
          partIds.set(event.call.id, id);
          yield { type: "part", part: { id, type: "likex.tool", data: { ...event.call } } };
        } else result = event;
      }
      if (!result) throw new Error("AIの応答が完了しませんでした。反映済みの変更は残っています。");
      // The result is a completion receipt. Never replace a live document with the server copy.
      const changed = appliedBatches > 0;
      const outcome = changed ? "編集を順次反映しました。本体の「元に戻す」で編集ごとに取り消せます。" : "資料への変更はありません。";
      if (isActive()) setStatus(outcome);
      if (runId) yield { type: "part", part: createRunPart(runId, changed ? "complete" : "unchanged") };
      // Publish the model answer together with verified application status.
      yield `${outcome}${answer.trim() ? `\n\n${answer.trim()}` : ""}`;
    } catch (error) {
      const message = `${signal.aborted ? "停止しました。" : error instanceof Error ? error.message : "AIの操作に失敗しました。"}${appliedBatches ? ` ${appliedBatches}件の反映済みの編集は残っています。「元に戻す」で取り消せます。` : ""}`;
      if (isActive()) setStatus(message);
      if (runId && !signal.aborted && isActive()) yield { type: "part", part: createRunPart(runId, "error", message) };
      throw error;
    } finally {
      context.signal.removeEventListener("abort", abort);
      if (active.current === controller) { active.current = null; if (mounted.current) reportBusy(false); }
    }
  }, [adapter, config, reportBusy]);

  return <div className="playground-ai-workspace" data-ai-module={adapter.module} data-color-mode={colorMode} style={{ "--demo-ai-primary": primaryColor ?? (adapter.module === "slide" ? "#b95634" : "#217346") } as CSSProperties}>
    <div className="playground-ai-canvas">
      <div className="playground-ai-editor">{children}</div>
      {busy && <div className="playground-ai-working"><span>AIが作業中 · 編集できます</span><button type="button" onClick={() => { active.current?.abort(); chat.current?.cancel(); }}>停止</button></div>}
      <button hidden={open} ref={launcher} className="playground-ai-launcher" type="button" aria-label={`${adapter.label}のAIチャットを開く`} aria-expanded={open} aria-controls={drawerId} onClick={() => setOpen(true)}><Sparkles/><span>AI</span></button>
    </div>
    <aside ref={drawer} id={drawerId} className="playground-ai-drawer" hidden={!open} aria-labelledby={titleId} onKeyDown={event => { if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); } }}>
      <header className="playground-ai-drawer-header"><div><Sparkles/><div><h1 id={titleId}>{adapter.label} AI</h1><p>言葉で、いま開いている資料を編集</p></div></div><div className="playground-ai-drawer-actions"><button type="button" onClick={() => { void newChat(); }} aria-label="新しいチャット" title={busy ? "新しいチャット（実行中の処理を停止）" : "新しいチャット"} disabled={!config?.configured || creatingChat}><NewChatIcon/></button><button type="button" onClick={close} aria-label="AIチャットを閉じる" title="閉じる（Esc）">×</button></div></header>
      <div className="playground-ai-connection">
        {configError ? <><span role="alert">{configError}</span><button type="button" onClick={() => { setConfigError(""); setConfigAttempt(value => value + 1); }}>再確認</button></> : config?.configured ? <><span className="playground-ai-dot"/>{config.provider === "azure" ? "Azure OpenAI" : config.provider === "openai" ? "OpenAI" : config.provider}<span className="playground-ai-model">{config.model}</span></> : config ? <div><strong>AIの接続設定が必要です</strong><p>リポジトリ直下の .env に OpenAI または Azure OpenAI の設定を追加して、開発サーバーを再起動してください。設定項目は .env.example を参照できます。</p>{!!config.missing?.length && <p>未設定: {config.missing.join("、")}</p>}</div> : <span role="status">AIの接続設定を確認しています…</span>}
      </div>
      {!hasSent && <div className="playground-ai-suggestions">
        {adapter.introduction ? <><strong>{adapter.introduction.title}</strong><p>{adapter.introduction.description}</p></> : <p>例えば、こんなふうに</p>}
        {adapter.suggestions.map(suggestion => {
          const { label, prompt } = typeof suggestion === "string" ? { label: suggestion, prompt: suggestion } : suggestion;
          return <button key={label} type="button" disabled={!config?.configured || busy} onClick={() => { void chat.current?.send(prompt); }}>{label}<span aria-hidden="true">↗</span></button>;
        })}
      </div>}
      {(status || steps.length > 0) && <div className="playground-ai-progress"><p role="status" aria-live="polite">{busy && <span className="playground-ai-spinner"/>}{status}</p>{steps.length > 0 && <details><summary>実行の詳細 · {steps.length}</summary><ol>{steps.map((step, index) => <li key={`${index}-${step}`}>{step}</li>)}</ol></details>}</div>}
      <div className="playground-ai-chat"><LikeAIChat ref={chat} initialAIChat={initialAIChat} initialConversationId="assistant" onSave={model => model} onSend={send} partRenderers={partRenderers} colorMode={colorMode} primaryColor={primaryColor ?? (adapter.module === "slide" ? "#b95634" : "#217346")} readOnly={!config?.configured} features={{ attachments: false, conversations: true, import: false, export: false, history: false, edit: false, delete: false, retry: false }} style={{ width: "100%", height: "100%", minHeight: 0, border: 0, borderRadius: 0 }}/></div>
    </aside>
  </div>;
}
