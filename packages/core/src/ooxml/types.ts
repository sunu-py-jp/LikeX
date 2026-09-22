/** Browser-compatible contracts also usable with ES2022-only consumer typings. */
export type OfficePackageInput = ArrayBuffer | Uint8Array | { readonly size: number; arrayBuffer(): Promise<ArrayBuffer> };
/** Random-access input for metadata inspection without reading embedded media. */
export type OfficePackageMetadataInput = {
  readonly size: number;
  slice(start: number, end: number): { arrayBuffer(): Promise<ArrayBuffer> };
};
/** Minimal view of the Blob returned by Office exporters, without requiring DOM typings. */
export type OfficePackageBlob = {
  readonly size: number;
  readonly type: string;
  arrayBuffer(): Promise<ArrayBuffer>;
  text(): Promise<string>;
};
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
/** Metadata-only ZIP profile; normal Office imports retain their smaller budgets. */
export const OFFICE_PACKAGE_METADATA_LIMITS = Object.freeze({
  inputBytes: 512 * 1024 * 1024, directoryBytes: 8 * 1024 * 1024,
});
