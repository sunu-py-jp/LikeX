/** Internal Office Open XML package parts; no browser or persistence ownership. */
export type XlsxPart = { path: string; content: Blob };
export type XlsxRelationship = { id: string; type: string; target: string };
export type XlsxContentType = { extension?: string; partName?: string; contentType: string };
