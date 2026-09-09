/** Host operations may complete immediately or asynchronously. */
export type MaybePromise<T> = T | Promise<T>;

export type OperationContext = Readonly<{
  requestId: string;
  /** The owner aborts this signal when the operation or editing session ends. */
  signal: AbortSignal;
}>;

export type EventHandler<TEvent> = (event: TEvent) => MaybePromise<void>;
export type SaveHandler<TPayload, TResult = TPayload> = (payload: TPayload) => MaybePromise<void | TResult>;
export type RefreshHandler<TResult> = () => MaybePromise<TResult>;
export type RequestHandler<TRequest, TResult> = (request: TRequest, context: OperationContext) => MaybePromise<TResult>;
export type EditMode = "view" | "requesting" | "edit";
export type EditEndReason = "saved" | "discarded" | "refreshed" | "ended" | "cancelled" | "read-only" | "unmounted";

/** The field parameter preserves each component's domain vocabulary. */
export type EditPermission<TBaseline, TField extends string = "data"> =
  | boolean
  | Readonly<{ allowed: true } & Partial<Record<TField, TBaseline>>>;

export type EditRequestHandler<TRequest, TBaseline, TField extends string = "data"> = (
  request: TRequest,
  context: OperationContext,
) => MaybePromise<EditPermission<TBaseline, TField>>;
