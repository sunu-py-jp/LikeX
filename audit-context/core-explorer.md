# Core / Explorer context map

Context-only pass; findings and remediation are intentionally deferred.

## Reachability and trust boundaries

- Core is React-free and exports pure model, JSON, ZIP, Office XML/relationships, embedded-image and text-search helpers through `packages/core/package.json:12-65`. Imported Office bytes and user search strings are untrusted; host callbacks/options are trusted code.
- Core Office import budgets: compressed 32 MiB, 4,096 members, per-member 16 MiB, aggregate 64 MiB; XML depth 64, 600,000 nodes, 16 MiB bytes/text (`packages/core/src/ooxml/types.ts:20-29`). Metadata profile permits 512 MiB input but selectively reads bounded members (`zip-reader.ts:25-157`).
- ZIP readers reject unsafe member paths, duplicate names, encrypted/unsupported formats, mismatched local headers/sizes, overlapping/unregistered bytes and CRC mismatch. Streaming consumers must call `validate()` before accepting to verify unread members (`zip-stream-reader.ts:35-37,87-195`). Metadata intentionally does not validate unread payload CRC/content (`zip-reader.ts:20-24`).
- XML parser has no DOM, DTD, declared entities or external resolution; attributes use null-prototype records (`xml.ts:20-58`). Relationship parser returns external targets without fetching; each caller must decide whether an external target is acceptable (`relationships.ts:22-40`).
- Explorer accepts host `Entry[]`, actual browser Files, file/directory drag-drop and clipboard entries, source URLs/Blob readers, permissions and content-inspection callbacks. Pure models are not an authentication boundary. Entry permissions are inherited from ancestors and optionally recursively applied; invalid resolver results deny operations (`entry-permissions.ts:62-122`).
- Explorer preview selects inert text for HTML/SVG; direct URLs allow only HTTP(S)/Blob; PDF iframe defaults to empty sandbox (`preview-formats.ts:20-70`, `ui/file-preview.tsx:101-110`). The host may explicitly omit sandbox and owns redirects/CSP/content types (`model/preview.ts:18-24`). Text/CSV rendered through React text, no raw HTML sink found in reviewed Core/Explorer source search (`ui/file-preview.tsx:127-173`).
- Upload extension/size/content/count constraints are host-configured; all enforced checks complete before staging. Content inspection evidence is private WeakMap state keyed by File and inspector identity (`upload.ts:290-340`, `upload-content.ts:190-285`). PDF/PPTX share serial inspection lane; videos/audio concurrency four (`upload.ts:354-425`). Folder native reads bounded to 16 (`state/clipboard-import.ts:9,68-137`).
- ZIP export validates relative names before reading all content sequentially; rejects path traversal and ZIP64 boundary. Explorer snapshots and tree validation precede export traversal (`model/archive.ts:5-34`, Core `zip.ts:42-89,101-172`).

## Invariants / unenforced assumptions / open questions

- External relationship target never fetched by Core: established by `relationships.ts:32-38`. Downstream Office code needs independent review.
- PDF tree node/depth bounds applied after `PDFDocument.load`: established `inspection/pdf.ts:18-51`. Bounds on parser/decompressed object stream allocation during load: **nothing found in wrapper**; inspect pdf-lib implementation/dependency advisory in hunting phase.
- PDF inspection timeout/cancel can stop awaiting; JavaScript parser currently receives no AbortSignal (`inspection/pdf.ts:19`). Whether parsing cooperates/yields early enough before tree walk remains open.
- Explorer custom PDF URLs may redirect; destination MIME/origin constraints enforced by component: **nothing found**, documented host contract `model/preview.ts:22-24`. Sandbox default confines rendered document; explicit trusted-host override changes boundary.
- Stable JSON serializer invokes plain-object property accessors during serialization (`stable-json.ts:97,107`); prior model validators must establish data-only input or caller must supply trusted object. Enforced accessor policy in this helper: **nothing found**.
- No library-imposed cardinality/depth cap during native directory discovery beyond cycle detection (`clipboard-import.ts:139-187`); upload quotas happen later. Browser local entry capabilities are user initiated. Audit whether staged discovery count is sufficiently constrained by host quotas.
- Permission enforcement controller call sites and detached-window lifecycle still require deeper phase-2 trace; pure `applyAction` does not accept permission callbacks (`draft.ts:180-184`) by design.

## Concrete next audit surfaces

1. `inspection/pdf.ts` → pdf-lib `PDFDocument.load` / compressed object stream and tree traversal behavior.
2. Core XML streaming tokenization/entity handling and regex preflight expansion budgets.
3. ZIP input profiles, aggregate allocations, cancellation, mutable returned buffers and member identity.
4. Explorer preview URL/Blob MIME transitions, PDF sandbox overrides and thumbnail decoding.
5. Controller permission checks at async result application, host callback mutation and save/download gating.
