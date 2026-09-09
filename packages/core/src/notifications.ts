/** Notifications observe an operation; their failures never undo its result. */
export function notifyHost<TArgs extends readonly unknown[]>(
  handler: ((...args: TArgs) => unknown) | undefined,
  ...args: TArgs
): void {
  if (!handler) return;
  try {
    void Promise.resolve(handler(...args)).catch(() => {});
  } catch {
    // Validation and persistence belong to awaited handlers, not observers.
  }
}
