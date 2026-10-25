## `normalizeDocument` / `normalizeContent` in packages/document/src/model/document.ts (L70-L191)

**Purpose:** Produce a canonical immutable model from native JSON, Office conversion or editor transactions.

**Inputs & Assumptions:** Untrusted plain-data object. `record` rejects nonplain prototypes/accessors/unsupported keys (`model/validation.ts:L2-L7`). Arrays must be actual arrays and content count checked (`document.ts:L140-L142`). Recursive depth/node count budget is established by `walk` before child traversal (`L73-L75`).

**Outputs & Effects:** Frozen cloned model, new IDs for missing/duplicate IDs, WeakSet normalization cache (`L79-L83,L185-L191`); image cache capped at32 entries/20MiB (`L27-L37`). No network/DOM.

**Block-by-Block:**
- L74-L105 establishes supported node types/attributes and bounded table widths/spans.
- L106-L124 inspects image bytes, aggregates image/text/canvas counts before result is accepted.
- L128-L143 validates text/marks/children and tracks total size.
- L146-L181 builds ProseMirror grammar, checks shape, verifies rectangular nonoverlapping table occupancy and clones JSON.
- L185-L191 caches only fully validated frozen result.

**Cross-Function Dependencies:** `inspectDocumentImage` permits canonical PNG/JPEG+dimensions (`image-source.ts:L4-L39`); `normalizeDocumentMark` invokes allowed link protocols/font/color validation (`document.ts:L48-L65`); ProseMirror `nodeFromJSON/check` is external source dependency. Importer and commands rely on normalizer as final publication gate (`io/import-docx.ts:L214`;model/commands.ts:L210`).

**Open Questions:** Tree traversal/step normalization complexity before final validator; how directly exported documentSchema is used outside component.

---

## `importDocumentDocx` in packages/document/src/io/import-docx.ts (L14-L215)

**Purpose:** Convert bounded Office ZIP/XML into document blocks.

**Inputs & Assumptions:** Untrusted package bytes; caller signal/option functions trusted. Core archive establishes ZIP integrity/budget. Shared parser establishes XML depth/node limits. No filesystem extraction.

**Outputs & Effects:** Fully normalized document + deduplicated warnings (`L214-L215`). Reads embedded archive data only; cooperative yields/checks per64 blocks (`L195`).

**Block-by-Block:**
- L15-L44 rejects invalid input suffix, content/macro types, attached templates and broken relationships before body conversion.
- L59-L77 accepts internal PNG/JPEG images with signature and display geometry checks; final model validates canonical bytes/dimensions.
- L97-L145 interprets supported paragraph/run nodes; skips unsupported embedding and fields; hyperlinks must use allowed protocols.
- L148-L189 converts tables with colspan bound100; model occupancy then enforces rows/columns/overlap.
- L191-L215 limits blocks and builds final page/body, invokes normalizer once.

**Cross-Function Dependencies:** Core `openOfficePackage`, `officeXml.parseXml`, `readRelationships` (all source reviewed); paragraph/table/style helpers perform semantic conversion. Macros/fields never executed. Metadata fields become validated plain strings.

**Open Questions:** Repeated full descendants queries per paragraph/style objects could amplify costs within archive limits; detailed helpers not completely traced in context phase.

---

## `normalizeSlideDeck` in packages/slide/src/model/normalize.ts (L139-L187)

**Purpose:** Validate page/master/layout/catalog integrity and immutable Slide model.

**Inputs & Assumptions:** Untrusted object, strict `record`+`list` validate shape/count; all elements pass geometry/image/text normalization. `normalizeSlideAnimations` establishes temporal correctness and cycle rejection (animation-validation.ts:L105-L184), but no finite count/depth application limit (limits.ts:L17-L26).

**Outputs & Effects:** Frozen deck/page/element objects; caches canonical objects in WeakSets.

**Block-by-Block:**
- L140-L148 normalize pages/master catalog then build ID maps.
- L149-L178 count actual/stored/inherited elements, text and image bytes; reject duplicate references/IDs.
- L179-L187 reject totals and dimensions outside allowed range; publish immutable result.

**Cross-Function Dependencies:** `normalizeSlide` validates IDs/elements/line geometry, master metadata, animation graph (`L108-L129`); imageSource uses embedded validation (image-source.ts:L65-L87); parser calls after file-format restoration (`serialization.ts:L8-L10`).

**Open Questions:** Shared reference expansion in animation normalization and bounds on expensive descendants from imported inputs.

---

## `inspectSlideSvg` in packages/slide/src/model/svg-source.ts (L30-L72)

**Purpose:** Allow static embedded SVG as a Slide image while retaining original source bytes.

**Inputs & Assumptions:** Untrusted source string. Byte and JS length bounded1MiB before shared XML parse. Core XML parser resolves predefined/numeric entities and provides bounded structure.

**Outputs & Effects:** Valid dimensions, throws on unsupported structure. No network/DOM.

**Block-by-Block:**
- L31-L42 bound size, block DTD/PI, validate SVG root namespace and dimension/pixel budget.
- L43-L50 iterative walk, node/depth/text restrictions.
- L51-L67 allowlist attributes, unique IDs, reject backslash/control, allow only fragment url() for paint/clip, check numeric token range.
- L68-L71 cap pending work and verify reference target kind.

**Cross-Function Dependencies:** ImageSource invokes before returning SVG data URI; `createSlideSvgSource` validates before encoding (L76-L80); rendering uses img/data URI or trusted rasterizer, not inline HTML.

**Open Questions:** Fragment graph cycles or repeated geometry complexity and source/XML-browser parsing differences.

---

## `createPdfSource` in packages/slide/src/pdf/pdfjs-source.ts (L71-L126)

**Purpose:** Shared PDF.js source snapshot and task lifecycle.

**Inputs & Assumptions:** Untrusted PDF bytes, trusted injected PDF.js `getDocument`, trusted host supplementary asset URLs (L46-L55). Source snapshot enforces100MiB before copy (L58-L66), actual Blob bytes checked again(L78-L80).

**Outputs & Effects:** PDF.js task, document handle with destroy/cancellation. Adapter disables eval/XFA/autofetch/stream and limits image decode pixels(L82-L84). Rejects >2000pages(L115-L117); viewer custom loader allows up to10000pages (`use-pdf-document.ts:L34-L35`).

**Block-by-Block:**
- L72-L84 validate input/options and submit safe defaults to PDF.js.
- L85-L111 own task destroy and observe late rejected/resolved results.
- L112-L124 validate page count before publishing; destroy on errors and replace password exception message.

**Cross-Function Dependencies:** `wait` observes promises after abort (L16-L43); `createSlidePdfLoader` validates page viewport/canvas total before staging render and no annotation layer (`pdfjs-loader.ts:L15-L20,L45-L79`).

**Open Questions:** Dependency version advisory and host-supplied adapter capabilities are outside input validation guarantees.
