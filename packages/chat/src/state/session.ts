import { createModelEditorController } from "../core";
import type { MaybePromise, ModelEditorAdapter, ModelEditorExecuteOptions, ModelEditorOptions, OperationContext } from "../core";
import { CHAT_LIMITS, createChatMessage, executeChatCommands, getConversation, normalizeChat, normalizeChatAttachment, parseChat, serializeChat } from "../model";
import type { ChatAttachment, ChatCommand, ChatConversation, ChatMessage, ChatModel } from "../model";

export type ChatFeature = "send" | "attachments" | "edit" | "delete" | "conversations" | "reactions" | "threads" | "search" | "read" | "history" | "import" | "export";
export type ChatFeatures = Partial<Record<ChatFeature, boolean>>;
export type ChatSendRequest = { chat: ChatModel; conversation: ChatConversation; message: ChatMessage };
/** Acknowledges delivery. Throw to preserve the draft; no assistant response is generated. */
export type ChatSendHandler = (request: ChatSendRequest, context: OperationContext) => MaybePromise<void>;
export type ChatSessionOptions = Omit<ModelEditorOptions<ChatModel, ChatFeature>, "onEditRequest"> & {
  currentUserId: string;
  onEditRequest?: (request: { chat: ChatModel }, context: OperationContext) => MaybePromise<boolean>;
  onSend?: ChatSendHandler;
};
export const CHAT_FEATURES: readonly ChatFeature[] = ["send", "attachments", "edit", "delete", "conversations", "reactions", "threads", "search", "read", "history", "import", "export"];
export const chatEditorAdapter: ModelEditorAdapter<ChatModel, ChatCommand, ChatFeature> = {
  normalize: normalizeChat, serialize: serializeChat,
  execute: (chat, commands) => executeChatCommands(chat, commands).chat,
  features: CHAT_FEATURES,
  getCommandFeatures(command) {
    switch (command.type) {
      case "chat.replace": return ["import"];
      case "chat.update": case "participant.update": return ["edit"];
      case "participant.add": case "conversation.add": case "conversation.update": return ["conversations"];
      case "conversation.delete": return ["conversations", "delete"];
      case "conversation.read": return ["read"];
      case "message.add": return ["send", ...(command.message.attachments?.length ? ["attachments" as const] : []), ...(command.message.replyTo ? ["threads" as const] : [])];
      case "message.update": return command.patch.attachments ? ["edit", "attachments"] : ["edit"];
      case "message.delete": return ["delete"];
      case "reaction.toggle": return ["reactions"];
    }
  },
};

/** Observe late failures and stop waiting even if a host ignores AbortSignal. */
function waitForResponse<T>(input: MaybePromise<T>, signal: AbortSignal): Promise<{ value: T } | null> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); resolve(null); };
    const cleanup = () => signal.removeEventListener("abort", abort);
    Promise.resolve(input).then(value => { cleanup(); resolve(signal.aborted ? null : { value }); }, cause => { cleanup(); if (signal.aborted) resolve(null); else reject(cause); });
    if (signal.aborted) abort(); else signal.addEventListener("abort", abort, { once: true });
  });
}

/** A local editor session; persistence, access control, uploads and realtime transport belong to the host. */
export function createChatSession(initialChat: ChatModel, initialOptions: ChatSessionOptions) {
  let options = initialOptions;
  let historyInvalidated = false;
  let alive = true;
  const listeners = new Set<() => void>();
  function validateUser(chat: ChatModel, currentUserId: string) {
    if (!chat.participants.some(item => item.id === currentUserId)) throw new Error("currentUserId must identify a chat participant.");
  }
  validateUser(normalizeChat(initialChat), options.currentUserId);
  function editorOptions(value: ChatSessionOptions, resetHistory = false): ModelEditorOptions<ChatModel, ChatFeature> {
    return { ...value, features: { ...value.features, history: (resetHistory || !historyInvalidated) && value.features?.history !== false }, onEditRequest: value.onEditRequest ? ({ model }, context) => value.onEditRequest!({ chat: model }, context) : undefined };
  }
  function authorize(chat: ChatModel, command: ChatCommand) {
    const userId = options.currentUserId;
    validateUser(chat, userId);
    if (command.type === "chat.replace") { validateUser(normalizeChat(command.chat), userId); return; }
    if (command.type === "participant.update" && command.participantId !== userId) throw new Error("自分のプロフィールだけを編集できます。");
    if (command.type === "conversation.add") {
      if (!command.memberIds.includes(userId)) throw new Error("自分を含む会話を作成してください。");
      return;
    }
    if (!("conversationId" in command)) return;
    const conversation = getConversation(chat, command.conversationId);
    if (!conversation || !conversation.memberIds.includes(userId)) throw new Error("参加している会話だけを編集できます。");
    if (command.type === "message.add" && command.message.authorId !== userId) throw new Error("自分のメッセージだけを送信できます。");
    if ((command.type === "reaction.toggle" || command.type === "conversation.read") && command.participantId !== userId) throw new Error("自分のリアクション・既読状態だけを変更できます。");
    if (command.type === "message.update" || command.type === "message.delete") {
      const message = conversation.messages.find(item => item.id === command.messageId);
      if (!message || message.authorId !== userId) throw new Error("自分のメッセージだけを編集・削除できます。");
      if (command.type === "message.delete" && command.cascadeReplies && conversation.messages.some(item => item.replyTo === message.id && item.authorId !== userId)) throw new Error("他の参加者の返信があるスレッドは削除できません。");
    }
  }
  const adapter: ModelEditorAdapter<ChatModel, ChatCommand, ChatFeature> = {
    ...chatEditorAdapter,
    normalize(input) { const chat = normalizeChat(input); validateUser(chat, options.currentUserId); return chat; },
    execute(chat, commands) {
      // Stage the entire batch before the controller commits, checking each evolving model.
      if (commands.length > CHAT_LIMITS.commands) throw new Error("Chat command batch exceeds the command limit.");
      let next = chat;
      for (const command of commands) { authorize(next, command); next = executeChatCommands(next, command).chat; }
      return next;
    },
  };
  let editor = createModelEditorController(adapter, initialChat, editorOptions(options));
  function notify() { for (const listener of [...listeners]) { try { listener(); } catch { /* Observers do not roll back committed changes. */ } } }
  let unsubscribeEditor = editor.subscribe(notify);
  function cancel() { editor.cancelPending(); }
  async function send(conversationId: string, text: string, attachments: readonly ChatAttachment[] = [], replyTo?: string): Promise<boolean> {
    if (!text.trim() && !attachments.length) return false;
    const startingEditor = editor, userId = options.currentUserId, handler = options.onSend;
    let accepted = false;
    await startingEditor.runTask("send", async context => {
      const message = createChatMessage({ authorId: userId, text, ...(attachments.length ? { attachments: [...attachments] } : {}), ...(replyTo ? { replyTo } : {}) });
      const command: ChatCommand = { type: "message.add", conversationId, message };
      if (chatEditorAdapter.getCommandFeatures(command).some(feature => !startingEditor.getSnapshot().features[feature])) throw new Error("この機能は無効です。");
      adapter.execute(context.model, [command]);
      const conversation = getConversation(context.model, conversationId)!;
      if (handler) {
        const response = await waitForResponse(handler({ chat: context.model, conversation, message }, { signal: context.signal, requestId: context.requestId }), context.signal);
        if (!response) return;
      }
      if (editor !== startingEditor || options.currentUserId !== userId || context.signal.aborted) return;
      accepted = !!context.apply(command);
    });
    return accepted;
  }
  function syncChat(input: ChatModel, settings: { discardLocalChanges?: boolean } = {}): boolean {
    if (!alive) return false;
    const snapshot = editor.getSnapshot();
    if ((snapshot.dirty || snapshot.busy) && settings.discardLocalChanges !== true) {
      editor.setNotice({ kind: "info", text: "未保存の変更または処理中の操作があるため同期できません。保存後に再同期してください。" }); return false;
    }
    let nextEditor: typeof editor;
    try {
      const next = normalizeChat(input); validateUser(next, options.currentUserId);
      nextEditor = createModelEditorController(adapter, next, editorOptions(options, true));
    } catch (cause) {
      editor.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "同期できませんでした。" }); return false;
    }
    unsubscribeEditor(); editor.dispose();
    editor = nextEditor; historyInvalidated = false;
    unsubscribeEditor = editor.subscribe(notify);
    notify();
    if (snapshot.dirty) { try { options.onDirtyChange?.(false); } catch { /* Observer only. */ } }
    return true;
  }
  return Object.freeze({
    getSnapshot: () => editor.getSnapshot(), getModel: () => editor.getModel(), getChat: () => editor.getModel(),
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; },
    configure(next: ChatSessionOptions) {
      validateUser(editor.getModel(), next.currentUserId);
      if (next.currentUserId !== options.currentUserId) historyInvalidated = true;
      if (next.currentUserId !== options.currentUserId || next.onSend !== options.onSend) cancel();
      options = next; editor.configure(editorOptions(next));
    },
    execute(command: ChatCommand | readonly ChatCommand[], settings?: ModelEditorExecuteOptions) { return editor.execute(command, settings); },
    replace(input: ChatModel) {
      try { validateUser(normalizeChat(input), options.currentUserId); } catch (cause) { editor.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "読み込みできませんでした。" }); return Promise.resolve(null); }
      return editor.replace(input);
    },
    send, cancel, cancelPending: cancel, syncChat,
    save: () => editor.save(),
    undo: () => editor.undo(),
    redo: () => editor.redo(),
    discard: () => editor.discard(),
    setNotice: (notice: Parameters<typeof editor.setNotice>[0]) => editor.setNotice(notice),
    async importNative(input: string) {
      const snapshot = editor.getSnapshot(); if (snapshot.readOnly || !snapshot.features.import || snapshot.busy) return null;
      try { const chat = parseChat(input); validateUser(chat, options.currentUserId); return await editor.replace(chat); }
      catch (cause) { editor.setNotice({ kind: "error", text: cause instanceof Error ? cause.message : "読み込みできませんでした。" }); return null; }
    },
    exportNative() { if (!editor.getSnapshot().features.export) return null; return serializeChat(editor.getModel()); },
    async prepareAttachments(worker: (context: OperationContext) => MaybePromise<readonly ChatAttachment[]>): Promise<ChatAttachment[] | null> {
      const startingEditor = editor;
      if (!startingEditor.getSnapshot().features.send) return null;
      let attachments: ChatAttachment[] | null = null;
      const complete = await startingEditor.runTask("attachments", async context => {
        const pending = await waitForResponse(worker({ signal: context.signal, requestId: context.requestId }), context.signal);
        if (!pending) return;
        const result = pending.value;
        if (!Array.isArray(result) || result.length > 100) throw new Error("添付ファイルは100件までです。");
        attachments = result.map(normalizeChatAttachment);
        if (new Set(attachments.map(item => item.id)).size !== attachments.length) throw new Error("添付ファイルのIDが重複しています。");
      });
      return complete && startingEditor === editor ? attachments : null;
    },
    activate() { alive = true; editor.activate(); },
    dispose() { alive = false; editor.dispose(); },
  });
}
export type ChatSession = ReturnType<typeof createChatSession>;
