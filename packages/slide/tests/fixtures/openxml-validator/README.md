# Independent Open XML validation

This optional development tool validates complete PPTX packages with Microsoft's
Open XML SDK 3.1.1, using the Office 2007 schema and semantic validators. It is not
a LikeSlide runtime dependency and does not prove that an Office application
plays every effect identically.

Copy this directory to a temporary directory before building, so no build output
is added to the source tree. With .NET SDK 10 installed:

```sh
cp -R packages/slide/tests/fixtures/openxml-validator /tmp/likex-openxml-validator
dotnet build /tmp/likex-openxml-validator/Validator.csproj -p:NuGetAudit=false
dotnet /tmp/likex-openxml-validator/bin/Debug/net10.0/Validator.dll example.pptx
```

The first build restores the MIT-licensed `DocumentFormat.OpenXml` test tool.
Output is one JSON object per file; a nonzero exit status means validation failed.
`Errors` identifies the part, XPath and invalid element. Ordinary Node tests do
not require .NET or network access. To include SDK validation in the independent
animation tests, set `LIKEX_OPENXML_VALIDATOR` to this tool's built DLL and, if
needed, `LIKEX_DOTNET` to the `dotnet` executable.

```sh
LIKEX_OPENXML_VALIDATOR=/tmp/likex-openxml-validator/bin/Debug/net10.0/Validator.dll \
  node --test packages/slide/tests/pptx-animation-interop.test.mjs
```

The test inserts each independent timing fragment into slide 2 of the checked-in
`powerpoint-basic.pptx` fixture. It compares imported animation frames and validates
both resulting input packages and a newly exported animated LikeSlide deck:

- `pptx-animation-main-sequence.xml`: slide click, three numeric keyframes,
  `animRot` angles in 1/60000 degrees, RGB `animClr`, then delayed `animScale` with
  centered scaling in 1/100000 units. The scale fixture has text, so import must
  report that text magnification is not preserved.
- `pptx-animation-interactive-sequence.xml`: the click condition belongs to the
  `interactiveSeq` itself and targets shape 3. Rotation uses `repeatCount="2000"`
  (two iterations) and `autoRev="1"`. An unrelated shape click must not start it.

These inputs intentionally use native rotation/scale behaviors, which need not
match the exporter's chosen numeric-property representation. They exercise
interoperability beyond exporting and immediately importing LikeSlide's own XML.

Primary references used by the independent fixtures and checks:

- [Microsoft: animation markup](https://learn.microsoft.com/en-us/office/open-xml/presentation/working-with-animation)
- [TimeAnimateValue: keyframe times and values](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.timeanimatevalue?view=openxml-3.0.1)
- [CommonTimeNode: repeat counts, durations and autoreverse](https://learn.microsoft.com/en-us/dotnet/api/documentformat.openxml.presentation.commontimenode?view=openxml-3.0.1)
- [PowerPoint timing-tree restrictions](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/55167345-00ff-4d39-b4a8-6ca61d86227a)
- [PowerPoint rotation behavior restrictions](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/39903f1a-fcb4-4aee-81e2-66f4fc7493fd)
- [PowerPoint additional property names](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oe376/baf99b7b-b2a7-44bb-a501-f6147d6c7123)
- [PowerPoint generic animation behavior restrictions](https://learn.microsoft.com/en-us/openspecs/office_standards/ms-oi29500/e9355b93-5184-4ffe-8428-63a08858da2f)

The XML fixtures are authored independently from LikeSlide's exporter according
to these schemas. They are not represented as files saved by Microsoft PowerPoint.
Successful SDK validation does not establish that PowerPoint plays arbitrary
property names (for example `stroke.weight`, `style.fontSize`, or opacity
keyframes). Such playback claims require application-level verification separately.
