/** Browser-compatible contracts also usable with ES2022-only consumer typings. */
export type OfficePackageInput = ArrayBuffer | Uint8Array | { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> };
export type OfficePackageSignal = {
  readonly aborted: boolean; readonly reason: unknown; throwIfAborted(): void;
  addEventListener(type: "abort", listener: () => void, options?: { once?: boolean }): void;
  removeEventListener(type: "abort", listener: () => void): void;
};
/** Fixed budgets cover both declared sizes and actual decompressed output. */
export const OFFICE_PACKAGE_LIMITS = Object.freeze({
  inputBytes: 32 * 1024 * 1024, entries: 4096,
  entryBytes: 16 * 1024 * 1024, totalBytes: 64 * 1024 * 1024,
  xmlBytes: 16 * 1024 * 1024, xmlDepth: 64, xmlNodes: 600_000, xmlText: 16 * 1024 * 1024,
});
