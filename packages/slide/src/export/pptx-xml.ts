export const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
export const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
export const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
export const header = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
export const namespaces = `xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"`;
export const xml = (value: string): string => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;").replace(/\r/g, "&#13;");
export const emu = (pixels: number): number => Math.round(pixels * 9525);
export const group = '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>';
export const colorMap = '<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/>';
export type Link = { id: string; type: string; target: string };
export function relationships(links: Link[]): string {
  return `${header}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${links.map(link => `<Relationship Id="${xml(link.id)}" Type="${xml(link.type)}" Target="${xml(link.target)}"/>`).join("")}</Relationships>`;
}
export function fill(value: string, opacity = 1): string {
  if (value === "transparent") return "<a:noFill/>";
  let hex = value.slice(1); if (hex.length <= 4) hex = [...hex].map(char => char + char).join("");
  const alpha = Math.round(opacity * (hex.length === 8 ? parseInt(hex.slice(6), 16) / 255 : 1) * 100000);
  return `<a:solidFill><a:srgbClr val="${hex.slice(0, 6).toUpperCase()}">${alpha < 100000 ? `<a:alpha val="${alpha}"/>` : ""}</a:srgbClr></a:solidFill>`;
}
export function themeXml(): string {
  const colors = ["000000", "FFFFFF", "1F2937", "F3F4F6", "2563EB", "DC2626", "16A34A", "9333EA", "F59E0B", "0891B2", "2563EB", "7C3AED"];
  const keys = ["dk1", "lt1", "dk2", "lt2", "accent1", "accent2", "accent3", "accent4", "accent5", "accent6", "hlink", "folHlink"];
  const solid = '<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>';
  return `${header}<a:theme xmlns:a="${A}" name="LikeSlide"><a:themeElements><a:clrScheme name="LikeSlide">${keys.map((key, i) => `<a:${key}><a:srgbClr val="${colors[i]}"/></a:${key}>`).join("")}</a:clrScheme><a:fontScheme name="LikeSlide"><a:majorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont><a:minorFont><a:latin typeface="Arial"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont></a:fontScheme><a:fmtScheme name="LikeSlide"><a:fillStyleLst>${solid.repeat(3)}</a:fillStyleLst><a:lnStyleLst>${[9525, 19050, 28575].map(width => `<a:ln w="${width}" cap="flat" cmpd="sng" algn="ctr">${solid}<a:prstDash val="solid"/></a:ln>`).join("")}</a:lnStyleLst><a:effectStyleLst>${'<a:effectStyle><a:effectLst/></a:effectStyle>'.repeat(3)}</a:effectStyleLst><a:bgFillStyleLst>${solid.repeat(3)}</a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;
}
