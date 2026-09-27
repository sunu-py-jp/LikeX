using DocumentFormat.OpenXml;
using DocumentFormat.OpenXml.Packaging;
using DocumentFormat.OpenXml.Validation;
using System.Text.Json;
if (args.Length == 0) { Console.Error.WriteLine("Usage: Validator <file.pptx> [...]"); return 2; }
var failures = 0;
foreach (var filename in args) {
  try {
    using var document = PresentationDocument.Open(filename, false);
    var validator = new OpenXmlValidator(FileFormatVersions.Office2007);
    var errors = validator.Validate(document).Select(error => new {
      error.Id, Type = error.ErrorType.ToString(), error.Description,
      Part = error.Part?.Uri.ToString(), Path = error.Path?.XPath, Node = error.Node?.OuterXml,
    }).ToArray();
    Console.WriteLine(JsonSerializer.Serialize(new { File = filename, Errors = errors }));
    if (errors.Length != 0) failures++;
  } catch (Exception error) { Console.WriteLine(JsonSerializer.Serialize(new { File = filename, Exception = error.Message })); failures++; }
}
return failures == 0 ? 0 : 1;
