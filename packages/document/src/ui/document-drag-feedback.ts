import type { EditorView } from "prosemirror-view";
import type { DocumentEditor } from "../state/use-document-editor";
import { startDragEdgeMotion } from "./drag-scroll";

const marker = "application/x-likex-document-drag";
/** Feedback around native ProseMirror drag/drop. Transactions still go through the public command path. */
export function createDocumentDragFeedback(view: EditorView, getEditor: () => DocumentEditor) {
  const doc = view.dom?.ownerDocument, win = doc?.defaultView;
  const token = crypto.randomUUID();
  let active: { model: DocumentEditor["document"]; point:{x:number;y:number}; image:boolean; stop():void } | null = null;
  let rejected = false;
  function cancel() { const current=active;active=null;current?.stop();if(current){rejected=true;view.dragging=null;} }
  function valid() { const current=active, editor=getEditor();return !!current && current.model===editor.session.getSnapshot().document && editor.editable && editor.features.text && (!current.image||editor.features.images); }
  function check() { if(active&&!valid())cancel(); }
  function dragstart(event: DragEvent): boolean {
    if(!doc?.createElement||!win||!event.dataTransfer||event.defaultPrevented)return false;
    cancel();rejected=false;
    const editor=getEditor(), image=(event.target as Element)?.closest?.("img"), isImage=!!image||view.state.selection.$from.nodeAfter?.type.name==="image";
    if(!editor.editable||!editor.features.text||isImage&&!editor.features.images){event.preventDefault();view.dragging=null;return true;}
    const viewport=view.dom.closest<HTMLElement>(".lxd-document-viewport");if(!viewport)return false;
    const badge=doc.createElement("div"),caret=doc.createElement("div");badge.className="lxd-drag-preview";badge.setAttribute("aria-hidden","true");
    badge.textContent=image?.getAttribute("alt")|| (isImage?"画像":view.state.doc.textBetween(view.state.selection.from,view.state.selection.to," ").slice(0,70)||"選択範囲");
    Object.assign(badge.style,{position:"fixed",left:"12px",top:"12px",zIndex:"2147483646",width:"180px",maxHeight:"54px",overflow:"hidden",padding:"8px 10px",font:"12px/1.5 system-ui",color:"#263342",background:"#fff",border:"1px solid #718097",borderRadius:"5px",boxShadow:"0 4px 12px #0003",opacity:".72",pointerEvents:"none"});
    caret.className="lxd-drag-caret";caret.setAttribute("aria-hidden","true");Object.assign(caret.style,{position:"fixed",pointerEvents:"none",zIndex:"2147483645",display:"none",background:"#4775ba",height:"3px"});
    doc.body.append(badge,caret);event.dataTransfer.setData(marker,token);event.dataTransfer.setDragImage?.(badge,12,14);
    const hideBadge=win.setTimeout(()=>{badge.style.visibility="hidden";},0);
    const current={model:editor.session.getSnapshot().document,point:{x:event.clientX,y:event.clientY},image:isImage,stop(){}};active=current;
    view.dom.classList.add("lxd-is-dragging");
    function updatePosition(){if(!valid()){cancel();return;}const rect=viewport!.getBoundingClientRect(),point={left:Math.max(rect.left+2,Math.min(rect.right-2,current.point.x)),top:Math.max(rect.top+2,Math.min(rect.bottom-2,current.point.y))};
      const found=view.posAtCoords(point);if(!found){caret.style.display="none";return;}try{const position=view.state.doc.resolve(found.pos),coords=view.coordsAtPos(found.pos);let x=coords.left,y=coords.top,width=2,height=Math.max(14,coords.bottom-coords.top);
        if(current.image){const before=position.depth?position.before(1):found.pos;const dom=view.nodeDOM(before) as HTMLElement|null;const bounds=dom?.getBoundingClientRect?.();if(bounds){x=bounds.left;y=current.point.y<(bounds.top+bounds.bottom)/2?bounds.top:bounds.bottom;width=bounds.width;height=3;}}
        Object.assign(caret.style,{display:"block",left:`${Math.max(rect.left,x)}px`,top:`${Math.max(rect.top,Math.min(rect.bottom-3,y))}px`,width:`${Math.max(2,Math.min(width,rect.right-x))}px`,height:`${height}px`});
      }catch{caret.style.display="none";}}
    const over=(event:DragEvent)=>{if(!active)return;current.point={x:event.clientX,y:event.clientY};updatePosition();};
    const end=()=>{const running=active;active=null;running?.stop();},drop=(event:DragEvent)=>{if(!view.dom.contains(event.target as Node))cancel();},key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();cancel();}},blur=()=>cancel();
    const stopMotion=startDragEdgeMotion(viewport,()=>active?current.point:null,(dx,dy)=>{viewport.scrollLeft+=dx;viewport.scrollTop+=dy;updatePosition();});
    current.stop=()=>{stopMotion();win.clearTimeout(hideBadge);badge.remove();caret.remove();view.dom.classList.remove("lxd-is-dragging");win.removeEventListener("dragover",over);win.removeEventListener("dragend",end);win.removeEventListener("drop",drop,true);win.removeEventListener("keydown",key,true);win.removeEventListener("blur",blur);};
    win.addEventListener("dragover",over);win.addEventListener("dragend",end);win.addEventListener("drop",drop,true);win.addEventListener("keydown",key,true);win.addEventListener("blur",blur);return false;
  }
  function drop(event:DragEvent):boolean { const own=event.dataTransfer?.getData(marker)===token;if(own&&(rejected||!valid())){event.preventDefault();cancel();view.dragging=null;return true;}
    const current=active;active=null;current?.stop();return false;
  }
  // Register after EditorView's native handler: it clears DataTransfer before
  // serializing its slice. Our marker and preview must be added afterwards.
  const nativeStart=(event:Event)=>{dragstart(event as DragEvent);};
  view.dom?.addEventListener?.("dragstart",nativeStart);
  const unsubscribe=getEditor().session.subscribe(check);
  return { drop, check, cancel, destroy(){cancel();unsubscribe();view.dom?.removeEventListener?.("dragstart",nativeStart);} };
}
