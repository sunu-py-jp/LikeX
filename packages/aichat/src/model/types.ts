/** Persisted metadata only. Uploading and opening attachment bytes belongs to the host. */
export type AIChatAttachment = { id: string; name: string; mediaType: string; size: number; url?: string };
export type AIChatReference = { id: string; title: string; url?: string; description?: string };
export type AIChatToolCall = { id: string; name: string; status: "pending" | "running" | "complete" | "error"; detail?: string };
export type AIChatMessageRole = "user" | "assistant" | "system" | "tool";
export type AIChatMessageStatus = "complete" | "streaming" | "error" | "cancelled";
export type AIChatMessage = {
  id: string; role: AIChatMessageRole; content: string; createdAt: string; status: AIChatMessageStatus;
  replyTo?: string; error?: string; attachments?: AIChatAttachment[]; references?: AIChatReference[]; toolCalls?: AIChatToolCall[];
};
export type AIChatMessageInput = Pick<AIChatMessage, "role" | "content"> & Partial<Omit<AIChatMessage, "role" | "content">>;
export type AIChatConversation = { id: string; title: string; messages: AIChatMessage[] };
export type AIChatModel = { format: "likex.aichat"; version: 1; id: string; title: string; conversations: AIChatConversation[] };
export type AIChatInput = Partial<Pick<AIChatModel, "id" | "title" | "conversations">>;
export type AIChatCommand =
  | { type: "aichat.update"; title: string }
  | { type: "aichat.replace"; aichat: AIChatModel }
  | { type: "conversation.add"; id?: string; title?: string }
  | { type: "conversation.update"; conversationId: string; title: string }
  | { type: "conversation.delete"; conversationId: string }
  | { type: "message.add"; conversationId: string; message: AIChatMessageInput }
 | { type: "message.update"; conversationId: string; messageId: string; patch: Partial<Pick<AIChatMessage, "content" | "status" | "error" | "attachments" | "references" | "toolCalls">> }
 | { type: "message.respond"; conversationId: string; messageId: string; content: string; status: AIChatMessageStatus; error?: string }
  | { type: "message.delete"; conversationId: string; messageId: string; cascadeReplies?: boolean };
export type AIChatCommandResult = { aichat: AIChatModel; changed: boolean; results: { type: AIChatCommand["type"]; conversationId?: string; messageId?: string }[] };
