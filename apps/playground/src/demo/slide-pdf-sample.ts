/** An original, three-page vector PDF. ASCII keeps byte offsets deterministic. */
export function createSlidePdfSample(): Uint8Array {
  const text = (x: number, y: number, size: number, value: string) =>
    `BT /F1 ${size} Tf ${x} ${y} Td (${value}) Tj ET`;
  const pages = [
    { width: 960, height: 540, content: [
      "0.055 0.12 0.2 rg 0 0 960 540 re f", "0.26 0.86 0.71 rg 62 450 52 5 re f",
      text(62, 410, 15, "NORTHSTAR / PRODUCT STRATEGY"), "1 1 1 rg",
      text(60, 292, 54, "Make complex work"), text(60, 224, 54, "feel simple."),
      "0.65 0.74 0.82 rg", text(64, 136, 19, "One platform. Connected teams. Clear decisions."),
      text(64, 42, 12, "PDF VIEWING SAMPLE"), text(856, 42, 12, "01 / 03"),
    ].join("\n") },
    { width: 960, height: 540, content: [
      "0.97 0.97 0.95 rg 0 0 960 540 re f", "0.055 0.12 0.2 rg",
      text(56, 466, 15, "A SHARED OPERATING PICTURE"), text(56, 402, 36, "Three steps. One connected workflow."),
      ...["Collect", "Connect", "Act"].flatMap((label, index) => {
        const x = 56 + index * 290;
        return ["1 1 1 rg", `${x} 128 264 218 re f`, "0.26 0.66 0.56 rg", text(x + 22, 300, 18, `0${index + 1}`),
          "0.055 0.12 0.2 rg", text(x + 22, 238, 28, label), "0.34 0.4 0.47 rg",
          text(x + 22, 184, 14, ["Bring information together.", "Share context across teams.", "Turn insight into action."][index])];
      }),
      "0.26 0.66 0.56 RG 3 w 324 242 m 342 242 l S 614 242 m 632 242 l S",
      "0.34 0.4 0.47 rg", text(56, 42, 12, "Original PDF vectors remain sharp when zooming."), text(856, 42, 12, "02 / 03"),
    ].join("\n") },
    { width: 595, height: 842, content: [
      "0.97 0.97 0.95 rg 0 0 595 842 re f", "0.055 0.12 0.2 rg",
      text(48, 766, 13, "APPENDIX / DELIVERY NOTES"), text(48, 690, 36, "The next chapter"),
      "0.26 0.66 0.56 rg 48 652 499 4 re f", "0.34 0.4 0.47 rg",
      text(48, 598, 16, "A portrait page can live in the same document."),
      text(48, 566, 16, "Each page keeps its original size and orientation."),
      ...["01  Understand the current workflow", "02  Agree on a focused pilot", "03  Measure outcomes and expand"].flatMap((label, index) => [
        "1 1 1 rg", `48 ${396 - index * 96} 499 72 re f`, "0.055 0.12 0.2 rg", text(68, 424 - index * 96, 18, label),
      ]),
      "0.34 0.4 0.47 rg", text(48, 48, 12, "NORTHSTAR / ORIGINAL DEMO"), text(483, 48, 12, "03 / 03"),
    ].join("\n") },
  ];
  const objects = ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [4 0 R 6 0 R 8 0 R] /Count 3 >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>"];
  for (const page of pages) {
    const streamId = objects.length + 2;
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${page.width} ${page.height}] /Resources << /Font << /F1 3 0 R >> >> /Contents ${streamId} 0 R >>`,
      `<< /Length ${page.content.length} >>\nstream\n${page.content}\nendstream`);
  }
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) { offsets.push(pdf.length); pdf += `${index + 1} 0 obj\n${object}\nendobj\n`; }
  const xref = pdf.length;
  pdf += `xref\n0 ${offsets.length}\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}`;
  pdf += `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return new TextEncoder().encode(pdf);
}
