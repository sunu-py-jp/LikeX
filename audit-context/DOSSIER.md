# Input-boundary context — 2026-10-25

This context pass precedes security findings. Existing source-copy compatibility changes were present before the audit and are retained.

| Area | Boundary records |
| --- | --- |
| Core and Explorer | [Map](core-explorer.md), [function records](functions/core-explorer.md) |
| Spreadsheet | [Map](spreadsheet.md), [function records](functions/spreadsheet.md) |
| Document and Slide | [Map](document-slide.md), [function records](functions/document-slide.md) |

Untrusted content enters through native JSON, Office ZIP/XML, PDF adapters, clipboard data, embedded images, search parameters and host-provided file readers. Host callbacks are trusted integration code; browser component permission checks do not replace authorization at the storage/server boundary. UI packages consume common Core ZIP/XML, image and search helpers, so changes to those helpers require downstream import and rendering checks.

The boundary records distinguish enforced byte/structure/complexity budgets from open assumptions. In particular, a bounded input byte count does not itself establish bounded execution time or output allocation. Office imports must complete archive validation before publishing a model; optional-feature recovery must not bypass that invariant. Rendering relies on validated models and text/attribute escaping rather than interpreting imported HTML or script.

Open questions were handed to the next review phase: XML malformed-input complexity, regex replacement expansion, PDF third-party parsing allocation, clipboard pre-read bounds, model aggregate budgets, animation expansion, SVG references and async permission rechecks. This dossier alone is not a vulnerability verdict or a complete security guarantee.
