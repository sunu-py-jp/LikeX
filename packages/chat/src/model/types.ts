/** Metadata only: storage, upload, authentication and transport belong to the host. */
export type ChatAttachment = { id: string; name: string; mediaType: string; size: number; url?: string };
export type ChatParticipant = { id: string; name: string; avatarUrl?: string; status?: "online" | "away" | "offline" };
export type ChatReaction = { emoji: string; participantIds: string[] };
export type ChatReadMarker = { participantId: string; messageId: string };
export type ChatMessage = {
  id: string; authorId: string; text: string; createdAt: string; editedAt?: string;
  /** ID of an earlier, top-level message in the same conversation. */
  replyTo?: string; attachments?: ChatAttachment[]; reactions?: ChatReaction[];
};
export type ChatMessageInput = Pick<ChatMessage, "authorId" | "text"> & Partial<Omit<ChatMessage, "authorId" | "text">>;
export type ChatConversationKind = "direct" | "group" | "space";
export type ChatConversation = {
  id: string; kind: ChatConversationKind; title: string; memberIds: string[];
  messages: ChatMessage[]; readMarkers?: ChatReadMarker[];
};
export type ChatModel = { format: "likex.chat"; version: 2; id: string; title: string; participants: ChatParticipant[]; conversations: ChatConversation[] };
export type ChatInput = Partial<Pick<ChatModel, "id" | "title" | "participants" | "conversations">>;
export type ChatCommand =
  | { type: "chat.update"; title: string }
  | { type: "chat.replace"; chat: ChatModel }
  | { type: "participant.add"; participant: ChatParticipant }
  | { type: "participant.update"; participantId: string; patch: Partial<Pick<ChatParticipant, "name" | "avatarUrl" | "status">> }
  | { type: "conversation.add"; id?: string; kind: ChatConversationKind; title?: string; memberIds: string[] }
  | { type: "conversation.update"; conversationId: string; title?: string; memberIds?: string[] }
  | { type: "conversation.delete"; conversationId: string }
  | { type: "conversation.read"; conversationId: string; participantId: string; messageId: string }
  | { type: "message.add"; conversationId: string; message: ChatMessageInput }
  | { type: "message.update"; conversationId: string; messageId: string; patch: Partial<Pick<ChatMessage, "text" | "attachments" | "editedAt">> }
  | { type: "message.delete"; conversationId: string; messageId: string; cascadeReplies?: boolean }
  | { type: "reaction.toggle"; conversationId: string; messageId: string; participantId: string; emoji: string };
export type ChatCommandResult = { chat: ChatModel; changed: boolean; results: { type: ChatCommand["type"]; conversationId?: string; messageId?: string; participantId?: string }[] };
