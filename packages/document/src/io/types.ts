import type { DocumentModel } from "../model/types";
import type { OfficePackageBlob, OfficePackageSignal } from "../ooxml";

export type DocumentDocxOptions = { signal?: OfficePackageSignal };
export type DocumentDocxImportResult = { document: DocumentModel; warnings: string[] };
export type DocumentDocxExportResult = { blob: OfficePackageBlob; warnings: string[] };
