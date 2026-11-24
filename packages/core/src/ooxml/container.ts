import type { OfficePackageInput, OfficePackageMetadataInput, OfficePackageSignal } from "./types";

/** Outer container of an Office file: OOXML is a ZIP, the 97–2003 binary formats are compound files. */
export type OfficeContainerKind = "zip" | "cfb" | "unknown";

const ZIP_SIGNATURE = [0x50, 0x4b, 0x03, 0x04], CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const startsWith = (bytes: Uint8Array, signature: readonly number[]) => bytes.byteLength >= signature.length && signature.every((value, index) => bytes[index] === value);

/** Classifies by leading signature only; a file name or extension is never evidence of the format. */
export function detectOfficeContainerBytes(bytes: Uint8Array): OfficeContainerKind {
  return startsWith(bytes, ZIP_SIGNATURE) ? "zip" : startsWith(bytes, CFB_SIGNATURE) ? "cfb" : "unknown";
}

/** Reads eight bytes of sliceable input (File/Blob); other inputs are inspected in place. */
export async function detectOfficeContainer(input: OfficePackageInput | OfficePackageMetadataInput, signal?: OfficePackageSignal): Promise<OfficeContainerKind> {
  signal?.throwIfAborted();
  if (input instanceof Uint8Array) return detectOfficeContainerBytes(input);
  if (input instanceof ArrayBuffer) return detectOfficeContainerBytes(new Uint8Array(input, 0, Math.min(8, input.byteLength)));
  if (!input || typeof input !== "object") throw new Error("Officeファイルを読み込めません: 入力形式が不正です");
  const source = "slice" in input && typeof input.slice === "function" ? input.slice(0, 8)
    : "arrayBuffer" in input && typeof input.arrayBuffer === "function" ? input : undefined;
  if (!source) throw new Error("Officeファイルを読み込めません: 入力形式が不正です");
  const data = await source.arrayBuffer();
  signal?.throwIfAborted();
  if (!(data instanceof ArrayBuffer)) throw new Error("Officeファイルを読み込めません: 入力データがArrayBufferではありません");
  return detectOfficeContainerBytes(new Uint8Array(data, 0, Math.min(8, data.byteLength)));
}
