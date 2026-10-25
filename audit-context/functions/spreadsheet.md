# Spreadsheet input-path context (context phase only)

## `parseWorkbook` / `fileToWorkbook` / `normalizeWorkbook`

**Purpose:** Convert untrusted SPON text or host-supplied runtime objects into the frozen workbook used by UI, commands and exports.

**Inputs & Assumptions:** SPON text is untrusted. Runtime objects are host-supplied and are treated as unvalidated data at normalization. `parseWorkbook` requires string input and a 64 Mi UTF-16-character limit before JSON.parse (`src/model/serialization.ts:L20-L25`). No separate JSON nesting budget was found before JSON.parse; subsequent decoding accesses the known schema and discards other fields during normalization.

**Outputs & Effects:** New frozen snapshot; no network or persistence. SPON accepts only explicitly identified v1/v2 row-oriented formats (`src/model/native-file.ts:L51-L87`). Runtime format remains version 1 (`src/model/workbook/normalize.ts:L19-L20`).

**Block-by-Block:**
- Decode: validate format/version, 1–100 sheets, row/column dimensions and row array length, reject legacy flat cells, cap cells at 100,000, validate column keys, rebuild null-prototype cell maps (`native-file.ts:L51-L87`).
- Normalize: unique sheet IDs/names, dimensions, sparse cells, per-cell value/format/validation; normalize sizes, image/drawing/comment/merge/rule/table/filter children (`workbook/normalize.ts:L15-L57`).
- Finish: enforce workbook-wide cells/drawings/comments/formatRanges/merges, validate names, connector bindings, table/filter separation and data validation (`workbook/snapshot.ts:L13-L36`).

**Cross-Function Dependencies:** `normalizeResources` enforces raster resources; `normalizeMerges` validates geometry; `normalizeCellFormat` constrains properties, dimensions, flags and text; `finishWorkbook` establishes coupled invariants. Normalization produces null-prototype cells and resource dictionaries (`normalize.ts:L34`, `image-resources.ts:L118`).

**Open Questions:** Native/runtime normalization has per-cell text limits but aggregate text handling should be compared with XLSX's 32 Mi-character retained-text budget. Direct public pure-model calls may accept prevalidated snapshots; classify each public entry's validation precondition before judging host-object behavior.

---

## `importSpreadsheetXlsx` / `readWorksheetXml`

**Purpose:** XLSX package import to one isolated workbook plus bounded diagnostics.

**Inputs & Assumptions:** ArrayBuffer/Uint8Array/Blob-like input untrusted; host options/signal are trusted integration controls but are validated (`src/import/types.ts:L98-L111`). Compressed default 128 MiB; expanded default 5× compressed; metadata 16 MiB; 4096 ZIP entries; XML depth 64; retained nodes 600,000 (`types.ts:L86-L111`). Archive-capacity changes do not change model limits (`model/types.ts:L185-L192`).

**Outputs & Effects:** Frozen normalized workbook and warnings (`src/import/import-xlsx.ts:L252-L256`). Source XML never enters a browser HTML parser.

**Block-by-Block:**
- Input/archive: Core streaming ZIP validates declared+actual sizes/CRC, path structure, entry overlap and cancellation; Spreadsheet wraps errors and caps individual metadata reads (`src/import/zip.ts:L18-L29`; `packages/core/src/ooxml/zip-stream-reader.ts:L38-L129`).
- Package: reject macro/encrypted/binary content, malformed relationships, required missing parts; external relationships are recorded as omitted and not fetched (`import-xlsx.ts:L46-L85`, `relationships.ts:L7-L13`). Core internal relationship targets reject escape, URL syntax and duplicate IDs (`core/src/ooxml/relationships.ts:L10-L39`).
- Worksheet stream: 1,048,576×16,384 source coordinate bitsets detect duplicate cells/rows. Values outside model grid fail; blank formatting outside is discarded. Nonempty source cells are counted before materializing retained nodes (`worksheet-stream.ts:L20-L119`). Source XML invokes a bounded Core parser with retained-node budget and a callback that can release nodes (`L58-L62`, `L120-L140`).
- Optional features: missing auxiliary parts or invalid drawings/styles can recover with warnings; archive failures and aborts must propagate (`recovery.ts:L4-L7`). At the end, **all archive members**, even ignored ones, are validated before committing (`import-xlsx.ts:L252-L256`).

**Cross-Function Dependencies:** `officeXml.parseXml`, `parseXmlStream`, `readOfficeRelationships`, `openOfficePackageReader`; Core owns those implementations. `readWorksheet`, `formatRanges.apply`, `retainCellData`, `readWorksheetExtras`, `normalizeWorkbook` enforce model constraints after streaming conversion. Calculation may run for validation/filter rows before final normalization (`import-xlsx.ts:L230-L255`).

**Open Questions:** Resource accounting across shared-string tables, optional-feature recovery and repeated format-range expansion deserves path-by-path follow-up; current context has not derived worst-case aggregate operation counts. Verify that every optional-feature catch calls `rethrowImportFailure` where archive reads occur.

---

## `createWorkbookCalculator` / `tokenizeFormula`

**Purpose:** Interpret formula text using an explicit grammar and allowlisted handlers.

**Inputs & Assumptions:** Cell formula text untrusted; calculator comments say input workbook already validated (`src/model/formula.ts:L117`). `calculateWorkbook` itself does not normalize (`L264-L268`); callers must establish validation. Establishment is path-dependent; for arbitrary direct API objects, nothing found inside this function.

**Outputs & Effects:** Null-prototype per-sheet result dictionaries; error codes for grammar/reference/cycle/budget errors. No JS source evaluation (`L119-L126`, `L138-L146`).

**Block-by-Block:**
- Tokenizer limits 4096 characters, 2048 tokens; finite numeric literal and closed strings; explicit operator/name/reference grammar (`L15-L52`). Parser recursion bounded by referenceDepth=128 (`L65-L114`).
- Calculator shared 200,000 evaluation-step budget; per-cell recursion/cycle detection; parsed-formula cache (`L118-L146`). Ranges enforce valid sheet bounds and materialization limit 10,000 (`L156-L178`).
- Scalar values bounded; concatenated strings capped; allowlisted handler lookup uses `Object.hasOwn` (`L181-L253`). Wildcards use an explicit loop charged to workbook tick, not input-created regular expressions (`formula-functions/matching.ts:L5-L36`).

**Cross-Function Dependencies:** `FUNCTION_HANDLERS` and its text, lookup, conditional aggregation implementations must charge tick or bound their outputs; `checked` validates scalar output; `getFormattedCell` can consult range-format metadata.

**Open Questions:** Bound the work performed inside each handler and format-range lookup relative to `evaluationSteps`; formula parse costs do not use tick but are bounded individually. Nothing found here that limits the count of equivalent formatted-region lookups independent of sheet metadata size.

---

## `normalizeImageResource` / drawing and DOM display

**Purpose:** Restrict file-provided image payloads and drawables before DOM rendering.

**Inputs & Assumptions:** Resource and drawing fields untrusted. Accepted resources are PNG/JPEG/WebP/GIF canonical base64 data URLs; dimensions must match decoded headers (`src/model/image-resources.ts:L86-L107`). No SVG or remote URL resource entry path was found.

**Outputs & Effects:** Frozen resources cached by identity. Per-image 5 MiB, total 20 MiB, dimension 10,000, pixels 16 million; max 1000 images (`model/types.ts:L189-L190`, `image-resources.ts:L110-L130`). Drawings require finite dimensions, in-sheet anchors, validated IDs/resource refs, color grammar that rejects URL paints (`annotations.ts:L25-L85`).

**Block-by-Block:** Header validation walks bounded input bytes; metadata checks precede browser image decoding (`image-resources.ts:L14-L71`). Resource normalization constructs a canonical new frozen object before caching (`L86-L107`). XLSX image import reads embedded raster parts only and commits resources only once the owning drawing passed normalization (`import/drawing-media.ts:L18-L48`). UI uses `<img src={resource.dataUrl}>` (`ui/spreadsheet-drawings.tsx:L80`) and React text children; a targeted search found no `dangerouslySetInnerHTML`, `innerHTML`, `window.open`, `href=` or JS evaluation in Spreadsheet source.

**Cross-Function Dependencies:** Browser native raster decoder is outside source scope; EXIF orientation parser returns display dimensions. Cell format color validation uses a broader textual constraint (`formatting/normalize.ts:L5-L7`) than drawing colors, but cell renderer assigns `backgroundColor`/`color` rather than CSS `background` (`ui/grid/cell-style.ts:L14`).

**Open Questions:** Inspect the remaining CSS consumers of normalized cell colors and all export pathways before classifying that distinction. Image headers establish dimensions but not full raster structure validity; browser/native decoder behavior is an external dependency.

---

## Clipboard and asynchronous import publication

**Purpose:** Clipboard and selected-file actions share model mutation/transaction contracts.

**Inputs & Assumptions:** Clipboard text is untrusted; HTML is only token-extracted, not DOM-inserted (`state/clipboard/browser-clipboard.ts:L4`, `L44-L54`). `parseTsv` caps input at 10 Mi characters, 10,000 cells, 100,000 chars/cell and rejects unclosed quotes (`model/tsv.ts:L4-L30`). Table-writing commands additionally accept CSV/TSV via `parseTableDelimitedText`, which applies the same character/cell bounds and quote validation (`model/tables/data.ts:L6-L57`); the initial context's statement that no CSV path was found is corrected here.

**Outputs & Effects:** Clipboard HTML generation escapes text and attributes (`browser-clipboard.ts:L24-L30`). Paste prepares a validated destination before writes, respects protected partial merges, formats, validation, comments and feature policies (`model/editing/paste.ts:L22-L101`).

**Block-by-Block:** Import captures draft/revision/options, checks mutation/read-only/feature/saving conditions, creates AbortController, aborts on unmount or disabled edit state (`state/use-spreadsheet-import.ts:L20-L74`). It rechecks current draft before and after asynchronous parse/review and before transaction publication (`L83-L119`). SPON Blob bytes checked before `.text()`, text length checked by parser (`L89-L95`).

**Cross-Function Dependencies:** `getMutationFailure`, `applyTransaction`, `capturePendingEdits` establish host edit permissions and stale-target guarantees. Pure model APIs intentionally do not authorize the caller.

**Open Questions:** Browser clipboard Blob reads happen before model size limits; browser item-count/HTML size limits were not found in `readBrowserClipboard` itself. Distinguish browser-native clipboard capacity and model parsing cost in follow-up.
