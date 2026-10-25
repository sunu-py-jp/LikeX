## `openOfficePackageMetadata` in packages/core/src/ooxml/zip-reader.ts (L25-L157)

**Purpose:** Read bounded presentation metadata without inflating embedded media.

**Inputs & Assumptions:** Untrusted random-access package; trusted native-like `slice().arrayBuffer()` and optional cancellation signal. Actual length checked against requested range L29-L41. Metadata profile validates declared directory/headers but does not promise unread payload integrity (L20-L24).

**Outputs & Effects:** Immutable paths array, has/read methods; bounded per-part read cache. No network/filesystem writes.

**Block-by-Block:** L26-L57 validates input, ZIP footer, disk/count/directory; L60-L115 validates extra fields, local/central agreement, names, coverage. L118-L155 caches reads, reserves aggregate expanded-byte budget before await, bounds actual decompression, verifies declared size and CRC.

**Cross-Function Dependencies:** `zipName` L159-L164 rejects separators/traversal/percent escaping; `crc32` L14-L18 verifies expanded bytes. Caller `inspection/presentation.ts:15-52` reads only types, root relations, presentation and presentation relations. Model leaves unread payload validation intentionally outside this contract.

**Open Questions:** Behavior of malformed native DecompressionStream output and concurrent cache read failure should be exercised in phase 2.

---

## `parseXml` in packages/core/src/ooxml/xml.ts (L21-L59)

**Purpose:** Parse untrusted Office XML into a bounded plain tree without DOM/external resources.

**Inputs & Assumptions:** Uint8Array under 16 MiB; fatal UTF-8/UTF-16 decoding L22-L28. Attribute and text entity decoder accepts only predefined/numeric XML characters L10-L18.

**Outputs & Effects:** XmlNode with null-prototype attribute records L42; no external calls.

**Block-by-Block:** L29-L33 defines iterative stack/node/text budgets. L35-L39 handles text/comment/CDATA/PI and rejects other declarations. L41 checks end tags. L42-L55 bounds depth/count/attributes/text, rejects duplicates, establishes exactly one root. L57 rejects open stack.

**Cross-Function Dependencies:** `entities` uses builtin regex and numeric conversion only; `textContent` L8 later recursively visits bounded-depth tree. `parseXml` called by relationship parser and Office importers.

**Open Questions:** Complexity of builtin entity regex on malformed long text; streaming parser equivalent behavior should be compared in phase 2.

---

## `createTextSearchMatcher` in packages/core/src/text-search.ts (L121-L173)

**Purpose:** Reusable keyword/regex matcher across modules.

**Inputs & Assumptions:** Untrusted strings/options. 100,000 search chars, 4,096 regex chars; option booleans validated L122-L135. RE2 program upper budget preflight and engine result checked L138-L140.

**Outputs & Effects:** Frozen test/replace object. No network/DOM. Test accepts string only, replacements at most 100,000 chars L163-L170.

**Block-by-Block:** Empty query matches nothing; regex uses RE2JS, escaped literals use native Unicode regex L131-L160; native lastIndex reset each invocation.

**Cross-Function Dependencies:** `assertRegexExpansionBudget` L23-L118 approximates engine repetition cost before compilation. Engine syntax validation retains authority. Explorer wrapper currently delegates through its single core adapter.

**Open Questions:** Output-size budgeting for repeated replacements; preflight accounting for all RE2 Unicode/quoted/class grammar.

---

## `usePreviewSource` / `FilePreview` in packages/explorer/src/state/use-preview-source.ts (L37-L149) and ui/file-preview.tsx (L39-L189)

**Purpose:** Resolve host presentation sources and display bounded/inert preview.

**Inputs & Assumptions:** Host descriptors are trusted integration code; file contents and remote response bytes untrusted. Descriptor URL validated L70-L72. Byte revision/cacheKey supplied by host identifies exact content L96-L97.

**Outputs & Effects:** DOM img/video/PDF iframe or escaped text/CSV. Blob leases released on cancellation/unmount L121-L126. PDF sandbox empty by default (FilePreview L108); explicit `false` is trusted-host choice.

**Block-by-Block:** L48-L60 aborts resolver stale work; target identity gates resolved descriptors L62. L67-L87 validates kind/mode. L99-L120 reads blob, examines initial 512 bytes/MIME, forces HTML/SVG to text, caps text at 1 MiB, validates PDF magic, creates typed object URL. FilePreview renders escaped text L142,L155,L172.

**Cross-Function Dependencies:** `validatePreviewUrl` only HTTP(S)/Blob and no controls; `getPreviewFormat` never makes explicit HTML/SVG active. Media caches own raw/variant Blob URLs. Direct-URL responses not sniffed by component; documented host owns redirects/content types/CSP.

**Open Questions:** Same semantic-key cache reuse and current async cancellation flags need stale-data tests; caller can intentionally relax PDF sandbox.

---

## `inspectPdf` in packages/explorer/src/inspection/pdf.ts (L7-L55)

**Purpose:** Validate/count PDF pages for upload rules.

**Inputs & Assumptions:** Untrusted File ≤100 MiB; size/header/trailer checked L8-L17. Builtin pdf-lib parser trusted to parse before bounded tree walk; allocation budget within parser: nothing found in wrapper.

**Outputs & Effects:** Validated finite page count or throws; no persistence. Abort checked before/after parser and within tree walk.

**Block-by-Block:** L19 `PDFDocument.load` with throwOnInvalidObject, parseSpeed100. L28-L30 rejects encryption. L31-L50 validates catalog, page tree node identity, counts, cycles/depth, total tree nodes. L51 yields every100 nodes.

**Cross-Function Dependencies:** pdf-lib parse internals external source available but not yet followed; `ensureUploadContentInspection` caches validated returned facts only. `inspection/index.ts` owns timeout orchestration; upload scheduler limits PDF/PPTX concurrency to1.

**Open Questions:** parser amplification and interruption before page tree validation.

---

## `assertExplorerEntryPermissions` in packages/explorer/src/model/entry-permissions.ts (L62-L122)

**Purpose:** Share inherited per-entry authorization hints for GUI/command operations.

**Inputs & Assumptions:** Trusted host resolver/current entry tree; resolver synchronous, undefined means allow. Actual server authorization outside this library.

**Outputs & Effects:** Throws typed denial if any current/ancestor/recursive descendant check fails; no modifications.

**Block-by-Block:** L70-L100 expands target/ancestor/recursive checks, rejects cycles/missing IDs. L102 permits absent resolver. L103-L120 reads current callback, validates result and fails closed on thrown/invalid result.

**Cross-Function Dependencies:** `readPermissions` L37-L54 rejects Promise/thenables/prototype mismatches and unknown keys. `checksForExplorerAction` L126-L143 chooses recursive source/destination operations; `checksForExplorerChanges` L159 onward re-evaluates net changes. Pure draft operations intentionally do not execute host auth.

**Open Questions:** All controller/async/download paths must recheck before committing; phase 2 will trace calls.
