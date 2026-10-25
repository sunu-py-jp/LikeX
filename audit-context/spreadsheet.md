# Spreadsheet context index

Detailed source-cited records: [functions/spreadsheet.md](functions/spreadsheet.md).

## Reachability and trust boundaries

1. `.spon` string → `parseWorkbook` → versioned file decoder → `normalizeWorkbook` → frozen sparse workbook.
2. Runtime host object → `normalizeWorkbook` → same model invariants. Pure operation/calculation APIs may require an already normalized workbook.
3. `.xlsx` bytes → Core bounded streaming ZIP → bounded XML + relationship reader → streamed worksheet conversion + optional-feature recovery → archive-wide final validation → normalized snapshot.
4. Clipboard/browser text → TSV parser → destination/payload validation → common immutable commands.
5. Formula cell text → bounded custom tokenizer/AST interpreter → allowlisted functions with shared evaluation budget.
6. Raster image resources → canonical base64 + size/header/dimension checks → React img. Drawing text, cells and errors → React text, drawing colors → constrained SVG paint.
7. UI async import → capture draft/revision/permissions → abort/staleness checks → one transaction publication.

## Cross-cutting invariants

- XLSX option capacity controls compressed/expanded bytes only; model grid/cells/images/features remain bounded (`src/import/types.ts:L86-L111`, `src/model/types.ts:L185-L192`).
- Native parse, host normalization and XLSX import converge on immutable model validation (`src/model/serialization.ts:L20-L25`, `src/import/import-xlsx.ts:L255-L256`).
- Optional-feature recovery must retain cancellation/archive-integrity failures (`src/import/recovery.ts:L4-L7`).
- Internal relationships stay in the archive; external sources are not fetched (`core/src/ooxml/relationships.ts:L10-L39`, `src/import/import-xlsx.ts:L82-L85`).
- Persistent data dictionaries rebuilt with null prototypes; formula handler lookup requires own properties (`src/model/workbook/normalize.ts:L34`, `src/model/image-resources.ts:L118`, `src/model/formula.ts:L218`).

## Assumptions and next analysis surfaces (not findings)

- Public `calculateWorkbook` trusts validated input; no normalization inside it (`formula.ts:L117-L126`, L264-L268). Review published docs/callers against this precondition.
- Aggregate native/runtime text budget: nothing found beyond per-cell length/cell count plus native serialized size. Compare importer-specific retained text accounting.
- Clipboard `.text()` happens before parser limits; no Blob-size gate found in `readBrowserClipboard` (`browser-clipboard.ts:L44-L54`).
- Derive worst-case work for format ranges/conditional formats/merges and formula handler internals, not only max input lengths.
- Check optional import catch sites against `rethrowImportFailure` and actual archive final validation.
- Confirm every style/export consumer of cell color text; drawing-color constraints and cell-color constraints differ.

Context-only status: no vulnerabilities, exploit claims, severity ratings or remediation conclusions were made in this phase.
