import type { SlideDeck, SlideElement, SlideLayout } from "../model/types";
import { R, header, namespaces, xml, group, colorMap, relationships, fill, type Link } from "./pptx-xml";

export type PptxPlaceholder = { index: number; kind: string };
const placeholderKinds = new Set(["title", "body", "ctrTitle", "subTitle", "dt", "sldNum", "ftr", "hdr", "obj", "chart", "tbl", "clipArt", "dgm", "media", "sldImg", "pic"]);
export const pptxPlaceholder = (layout: SlideLayout | undefined, id: string | undefined): PptxPlaceholder | undefined => {
  const index = layout?.placeholders.findIndex(slot => slot.id === id) ?? -1;
  if (index < 0 || !layout) return;
  const kind = layout.placeholders[index].kind;
  return { index, kind: placeholderKinds.has(kind) ? kind : "obj" };
};
export function pptxMasterPlan(deck: SlideDeck) {
  const defaultMaster = !(deck.masters?.length) || deck.slides.some(slide => !slide.layoutId), offset = defaultMaster ? 2 : 1;
  const masters = (deck.masters ?? []).map((master, i) => ({ master, number: i + offset }));
  const layouts = (deck.layouts ?? []).map((layout, i) => ({ layout, number: i + offset }));
  return { defaultMaster, masters, layouts,
    masterNumbers: new Map(masters.map(item => [item.master.id, item.number])), layoutNumbers: new Map(layouts.map(item => [item.layout.id, item.number])) };
}
export async function writePptxMasterCatalog(plan: ReturnType<typeof pptxMasterPlan>, options: {
  add(path: string, type: string, value: string): void; rels(path: string, value: string): void;
  elements(elements: readonly SlideElement[], links: Link[], sourcePart: string, placeholders?: ReadonlyMap<string, PptxPlaceholder>): string;
  checkpoint(): Promise<void>;
}) {
  const prefix = "application/vnd.openxmlformats-officedocument.presentationml.";
  for (const { master, number } of plan.masters) {
    await options.checkpoint();
    const layouts = plan.layouts.filter(item => item.layout.masterId === master.id), links: Link[] = [
      ...layouts.map(item => ({ id: `rIdLayout${item.number}`, type: `${R}/slideLayout`, target: `../slideLayouts/slideLayout${item.number}.xml` })),
      { id: "rIdTheme", type: `${R}/theme`, target: "../theme/theme1.xml" },
    ];
    const source = `ppt/slideMasters/slideMaster${number}.xml`, elements = options.elements(master.elements, links, source);
    options.add(source, `${prefix}slideMaster+xml`, `${header}<p:sldMaster ${namespaces} preserve="1"><p:cSld name="${xml(master.name)}"><p:bg><p:bgPr>${fill(master.background)}<a:effectLst/></p:bgPr></p:bg><p:spTree>${group}${elements}</p:spTree></p:cSld>${colorMap}<p:sldLayoutIdLst>${layouts.map(item => `<p:sldLayoutId id="${2147483648 + item.number}" r:id="rIdLayout${item.number}"/>`).join("")}</p:sldLayoutIdLst><p:txStyles><p:titleStyle/><p:bodyStyle/><p:otherStyle/></p:txStyles></p:sldMaster>`);
    options.rels(`ppt/slideMasters/_rels/slideMaster${number}.xml.rels`, relationships(links));
  }
  for (const { layout, number } of plan.layouts) {
    await options.checkpoint();
    const links: Link[] = [{ id: "rIdMaster", type: `${R}/slideMaster`, target: `../slideMasters/slideMaster${plan.masterNumbers.get(layout.masterId)}.xml` }];
    const placeholders = new Map(layout.placeholders.map(slot => [slot.element.id, pptxPlaceholder(layout, slot.id)!]));
    const source = `ppt/slideLayouts/slideLayout${number}.xml`, elements = options.elements([...layout.elements, ...layout.placeholders.map(slot => slot.element)], links, source, placeholders);
    options.add(source, `${prefix}slideLayout+xml`, `${header}<p:sldLayout ${namespaces} type="cust" preserve="1"${layout.showMasterShapes === false ? ' showMasterSp="0"' : ""}><p:cSld name="${xml(layout.name)}">${layout.background !== undefined ? `<p:bg><p:bgPr>${fill(layout.background)}<a:effectLst/></p:bgPr></p:bg>` : ""}<p:spTree>${group}${elements}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`);
    options.rels(`ppt/slideLayouts/_rels/slideLayout${number}.xml.rels`, relationships(links));
  }
}
