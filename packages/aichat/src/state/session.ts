import { createModelEditorController } from "../core";
import type { MaybePromise, ModelEditorAdapter, ModelEditorOptions, ModelEditorTaskContext, OperationContext } from "../core";
import { createAIChatMessage, executeAIChatCommands, getAIChatConversation, normalizeAIChat, normalizeAIChatAttachment, parseAIChat, serializeAIChat } from "../model";
import type { AIChatAttachment, AIChatCommand, AIChatConversation, AIChatMessage, AIChatModel } from "../model";

export type AIChatFeature = "send" | "retry" | "attachments" | "edit" | "delete" | "conversations" | "history" | "import" | "export";
export type AIChatFeatures = Partial<Record<AIChatFeature, boolean>>;
export type AIChatSendRequest = { aichat: AIChatModel; conversation: AIChatConversation; messages: readonly AIChatMessage[]; prompt: AIChatMessage; retry: boolean };
export type AIChatSendHandler = (request: AIChatSendRequest, context: OperationContext) => MaybePromise<string | AsyncIterable<string>>;
export type AIChatSessionOptions = Omit<ModelEditorOptions<AIChatModel, AIChatFeature>, "onEditRequest"> & {
  onEditRequest?: (request: { aichat: AIChatModel }, context: OperationContext) => MaybePromise<boolean>;
  onSend?: AIChatSendHandler;
};
export const AICHAT_FEATURES: readonly AIChatFeature[] = ["send", "retry", "attachments", "edit", "delete", "conversations", "history", "import", "export"];
export const aiChatEditorAdapter: ModelEditorAdapter<AIChatModel, AIChatCommand, AIChatFeature> = {
  normalize: normalizeAIChat, serialize: serializeAIChat,
  execute: (aichat, commands) => executeAIChatCommands(aichat, commands).aichat,
  features: AICHAT_FEATURES,
  getCommandFeatures(command) {
    switch (command.type) {
      case "aichat.replace": return ["import"];
      case "aichat.update": return ["edit"];
      case "conversation.add": case "conversation.update": return ["conversations"];
      case "conversation.delete": return ["conversations", "delete"];
      case "message.add": return command.message.attachments?.length ? ["send", "attachments"] : ["send"];
      case "message.respond": return ["send"];
      case "message.update": return command.patch.attachments ? ["edit", "attachments"] : ["edit"];
      case "message.delete": return ["delete"];
    }
  },
};

/** Stop waiting even when a host provider ignores AbortSignal; still observe late rejections. */
function waitForResponse<T>(input: MaybePromise<T>, signal: AbortSignal): Promise<{ value: T } | null> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); resolve(null); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    Promise.resolve(input).then(value => { cleanup(); resolve(signal.aborted ? null : { value }); }, cause => { cleanup(); if (signal.aborted) resolve(null); else reject(cause); });
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
}

/** A React-free session. The host provides persistence, uploads, and response generation. */
export function createAIChatSession(initialAIChat: AIChatModel, initialOptions: AIChatSessionOptions = {}) {
  let options = initialOptions;
  function editorOptions(value: AIChatSessionOptions): ModelEditorOptions<AIChatModel, AIChatFeature> {
    return { ...value, onEditRequest: value.onEditRequest ? ({ model }, context) => value.onEditRequest!({ aichat: model }, context) : undefined };
  }
  const editor = createModelEditorController(aiChatEditorAdapter, initialAIChat, editorOptions(options));
  let active: { conversationId: string; messageId: string; cancel(): void } | null = null;
  async function respond(context: ModelEditorTaskContext<AIChatModel, AIChatCommand>, conversationId: string, prompt: AIChatMessage, assistantId: string, retry: boolean, handler: AIChatSendHandler) {
    if (context.signal.aborted) return;
    let content = "";
    const apply = (status: "streaming" | "complete" | "cancelled" | "error", error?: string) => context.apply({ type: "message.respond", conversationId, messageId: assistantId, content, status, ...(error ? { error } : {}) });
    const current = { conversationId, messageId: assistantId, cancel() { apply("cancelled"); } };
    active = current;
    editor.setNotice(null);
    try {
      const aichat = editor.getModel(), conversation = getAIChatConversation(aichat, conversationId)!;
      const index = conversation.messages.findIndex(message => message.id === assistantId);
      const messages = Object.freeze(conversation.messages.slice(0, index));
      const pending = await waitForResponse(handler({ aichat, conversation, messages, prompt, retry }, { signal: context.signal, requestId: context.requestId }), context.signal);
      if (!pending) return;
      const response = pending.value;
      if (typeof response === "string") { content = response; apply("complete"); return; }
      if (!response || typeof response[Symbol.asyncIterator] !== "function") throw new Error("onSend must return text or an AsyncIterable of text chunks.");
      const iterator = response[Symbol.asyncIterator]();
      let finished = false;
      try {
        for (;;) {
          const result = await waitForResponse(iterator.next(), context.signal);
          if (!result) return;
          if (result.value.done) { finished = true; break; }
          const chunk = result.value.value;
          if (typeof chunk !== "string") throw new Error("Response chunks must be strings.");
          content += chunk;
          if (!apply("streaming") && context.signal.aborted) return;
        }
      } finally {
        // A suspended generator's return() can also wait indefinitely, so do not block cancellation.
        if (!finished && iterator.return) { try { void Promise.resolve(iterator.return()).catch(() => {}); } catch { /* Host cleanup is best effort. */ } }
      }
      if (!context.signal.aborted) apply("complete");
    } catch (cause) {
      if (!context.signal.aborted) {
        const error = cause instanceof Error ? cause.message : "応答を取得できませんでした。";
        content = getAIChatConversation(editor.getModel(), conversationId)?.messages.find(message => message.id === assistantId)?.content ?? "";
        apply("error", error.slice(0, 10_000));
        editor.setNotice({ kind: "error", text: error });
      }
    } finally { if (active === current) active = null; }
  }
  async function send(conversationId: string, content: string, attachments: readonly AIChatAttachment[] = []): Promise<boolean> {
    if (!content.trim() && !attachments.length) return false;
    let accepted = false;
    const handler = options.onSend;
    await editor.runTask("send", async context => {
      const prompt = createAIChatMessage({ role: "user", content, ...(attachments.length ? { attachments: [...attachments] } : {}) });
      const assistant = handler ? createAIChatMessage({ role: "assistant", content: "", status: "streaming", replyTo: prompt.id }) : null;
      const commands: AIChatCommand[] = [{ type: "message.add", conversationId, message: prompt }];
      if (assistant) commands.push({ type: "message.add", conversationId, message: assistant });
      if (!context.apply(commands)) return;
      accepted = true;
      if (handler && assistant) await respond(context, conversationId, prompt, assistant.id, false, handler);
    });
    return accepted;
  }
  async function retry(conversationId: string, messageId: string): Promise<boolean> {
    const handler = options.onSend;
    if (!handler || !editor.getSnapshot().features.send) return false;
    let accepted = false;
    await editor.runTask("retry", async context => {
      const conversation = getAIChatConversation(context.model, conversationId), message = conversation?.messages.find(item => item.id === messageId);
      const prompt = conversation?.messages.find(item => item.id === message?.replyTo);
      if (!message || message.role !== "assistant" || !prompt || prompt.role !== "user") throw new Error("再試行する応答が見つかりません。");
      context.apply({ type: "message.respond", conversationId, messageId, content: "", status: "streaming" });
      accepted = true;
      await respond(context, conversationId, prompt, messageId, true, handler);
    });
    return accepted;
  }
  function cancel() { try { active?.cancel(); } finally { active = null; editor.cancelPending(); } }
  return Object.freeze({
    ...editor, send, retry, cancel,
    getAIChat: editor.getModel,
    getActiveResponse: () => active ? { conversationId: active.conversationId, messageId: active.messageId } : null,
    configure(next: AIChatSessionOptions) {
      if (active && (next.readOnly !== options.readOnly || !!next.onSave !== !!options.onSave || AICHAT_FEATURES.some(key => (next.features?.[key] !== false) !== (options.features?.[key] !== false)))) cancel();
      options = next; editor.configure(editorOptions(next));
    },
    async importNative(input: string) {
      const snapshot = editor.getSnapshot(); if (snapshot.readOnly || !snapshot.features.import) return null;
      const aichat = parseAIChat(input); cancel(); return editor.replace(aichat);
    },
    exportNative() { if (!editor.getSnapshot().features.export) return null; return serializeAIChat(editor.getModel()); },
    async prepareAttachments(worker: (context: OperationContext) => Promise<readonly AIChatAttachment[]>): Promise<AIChatAttachment[] | null> {
      if (!editor.getSnapshot().features.send) return null;
      let attachments: AIChatAttachment[] | null = null;
      const complete = await editor.runTask("attachments", async context => {
        const pending = await waitForResponse(worker(context), context.signal);
        if (!pending) return;
        const result = pending.value;
        if (!Array.isArray(result) || result.length > 100) throw new Error("添付ファイルは100件までです。");
        attachments = result.map(normalizeAIChatAttachment);
        if (new Set(attachments.map(item => item.id)).size !== attachments.length) throw new Error("添付ファイルのIDが重複しています。");
      });
      return complete ? attachments : null;
    },
    dispose() { active = null; editor.dispose(); },
  });
}
export type AIChatSession = ReturnType<typeof createAIChatSession>;
