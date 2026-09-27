import type { CSSProperties, ReactNode } from "react";
import type { MaybePromise, OperationContext } from "./core";
import type { AIChatAttachment, AIChatCommand, AIChatContentPart, AIChatConversation, AIChatMessage, AIChatModel } from "./model";
import type { AIChatSessionOptions } from "./state/session";
/** Renderers are host code, not part of the serialized conversation. */
export type AIChatPartRendererContext = { message: AIChatMessage };
export type AIChatPartRenderer = (part: AIChatContentPart, context: AIChatPartRendererContext) => ReactNode;
export type AIChatPartRenderers = Readonly<Record<string, AIChatPartRenderer | undefined>>;
export type AIChatProps = AIChatSessionOptions & {
  initialAIChat?: AIChatModel;
  initialConversationId?: string;
  onConversationChange?: (conversation: AIChatConversation) => void;
  onAttachmentUpload?: (files: readonly File[], context: OperationContext) => MaybePromise<readonly AIChatAttachment[]>;
  onAttachmentClick?: (attachment: AIChatAttachment) => void;
  /** Render each message part by its host-defined type; unregistered types show their JSON. */
  partRenderers?: AIChatPartRenderers;
  colorMode?: "light" | "dark" | "system";
  primaryColor?: string;
  title?: string;
  exportFileName?: string;
  className?: string;
  style?: CSSProperties;
};
export type AIChatHandle = {
  getAIChat(): AIChatModel;
  getAIChatConversation(): AIChatConversation;
  selectConversation(id: string): boolean;
  execute(command: AIChatCommand | readonly AIChatCommand[]): Promise<AIChatModel | null>;
  send(content: string, attachments?: readonly AIChatAttachment[]): Promise<boolean>;
  retry(messageId: string): Promise<boolean>;
  cancel(): void;
  save(): Promise<boolean>;
  undo(): Promise<boolean>;
  redo(): Promise<boolean>;
  discard(): void;
  importNative(input: string): Promise<AIChatModel | null>;
  exportNative(): string | null;
};
