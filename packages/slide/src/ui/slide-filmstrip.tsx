"use client";

import { useEffect, useLayoutEffect, useRef, useState, type MouseEvent, type PointerEvent } from "react";
import { Copy, Plus, Trash2 } from "lucide-react";
import { getDragInsertionIndex } from "../core";
import type { SlideEditor } from "../state/use-slide-editor";
import type { SlideDeck } from "../model/types";
import { SlideArtwork } from "./slide-artwork";
import { startDragEdgeMotion } from "./drag-scroll";
import type { ContextMenuAction } from "../browser";
import { useSlideContextMenu } from "./use-slide-context-menu";

type Drag = { id:string; deck:SlideDeck; pointerId:number; startX:number; startY:number; x:number; y:number; active:boolean; index:number; stop():void };
export function SlideFilmstrip({ editor }: { editor: SlideEditor }) {
  const list = useRef<HTMLOListElement>(null), root = useRef<HTMLElement>(null), dragging = useRef<Drag|null>(null), suppressClick = useRef(false);
  const latest = useRef(editor); useLayoutEffect(()=>{latest.current=editor;});
  const [feedback,setFeedback] = useState<{id:string;index:number;x:number;y:number;line:number}|null>(null);
  const { deck } = editor;
  const openMenu = useSlideContextMenu(editor);
  function contextMenu(event: MouseEvent<HTMLElement>, slideId?: string) {
    if (editor.readOnly) return;
    const items: ContextMenuAction[] = [];
    const disabled = !editor.editable;
    const index = deck.slides.findIndex(slide => slide.id === slideId);
    if (editor.features.addSlides) {
      items.push({ id: "add-slide", label: "新しいスライド", disabled,
        onSelect: () => editor.execute({ type: "slide.add", afterId: slideId }, deck) });
      if (slideId) items.push({ id: "duplicate-slide", label: "スライドを複製", disabled,
        onSelect: () => editor.execute({ type: "slide.duplicate", slideId }, deck) });
    }
    if (slideId && editor.features.reorderSlides) items.push(
      { id: "move-previous", label: "前へ移動", separatorBefore: true, disabled: disabled || index <= 0,
        onSelect: () => editor.execute({ type: "slide.move", slideId, index: index - 1 }, deck) },
      { id: "move-next", label: "後ろへ移動", disabled: disabled || index >= deck.slides.length - 1,
        onSelect: () => editor.execute({ type: "slide.move", slideId, index: index + 1 }, deck) },
    );
    if (slideId && editor.features.deleteSlides) items.push({ id: "delete-slide", label: "スライドを削除", danger: true, separatorBefore: true, disabled: disabled || deck.slides.length <= 1,
      onSelect: () => editor.execute({ type: "slide.delete", slideId }, deck) });
    if (openMenu(event, items)) { stop(); if (slideId) editor.select({ slideId, elementIds: [] }); }
  }
  function stop(cancel=true) { const current=dragging.current;dragging.current=null;current?.stop();setFeedback(null);if(!current?.active)return;suppressClick.current=true;
    const state=latest.current;if(!cancel && current.deck===state.deck && state.editable && state.features.reorderSlides){const from=state.deck.slides.findIndex(slide=>slide.id===current.id);if(from!==current.index)void state.execute({type:"slide.move",slideId:current.id,index:current.index},current.deck);}}
  useLayoutEffect(()=>{const current=dragging.current;if(current&&(current.deck!==deck||!editor.editable||!editor.features.reorderSlides))stop();},[deck,editor.editable,editor.features.reorderSlides]);
  useEffect(()=>()=>{const current=dragging.current;dragging.current=null;current?.stop();},[]);
  function update(current:Drag){const container=list.current,frame=root.current;if(!container||!frame)return;
    if(current.deck!==latest.current.deck||!latest.current.editable||!latest.current.features.reorderSlides){stop();return;}
    if(!current.active&&Math.hypot(current.x-current.startX,current.y-current.startY)<5)return;current.active=true;
    const items=[...container.querySelectorAll<HTMLElement>("[data-filmstrip-id]")].filter(item=>item.dataset.filmstripId!==current.id),bounds=items.map(item=>item.getBoundingClientRect());
    current.index=getDragInsertionIndex(current.y,bounds.map(rect=>({start:rect.top,end:rect.bottom})));
    const rect=frame.getBoundingClientRect(),containerRect=container.getBoundingClientRect();
    const line=bounds.length?(current.index===bounds.length?bounds[bounds.length-1].bottom+6:bounds[current.index].top-6):containerRect.top+8;
    setFeedback({id:current.id,index:current.index,x:Math.max(5,Math.min(rect.width-150,current.x-rect.left+14)),y:Math.max(5,Math.min(rect.height-95,current.y-rect.top+12)),line:line-containerRect.top+container.scrollTop});
  }
  function begin(event:PointerEvent<HTMLElement>,id:string){if(event.button!==0||!editor.editable||!editor.features.reorderSlides)return;const target=event.target as HTMLElement;if(target.closest("button")&&!target.closest(".lxp-slide-thumbnail"))return;
    event.preventDefault();
    event.currentTarget.querySelector<HTMLButtonElement>(".lxp-slide-thumbnail")?.focus({preventScroll:true});
    editor.select({slideId:id,elementIds:[]});const container=list.current,win=container?.ownerDocument.defaultView;if(!container||!win)return;stop();suppressClick.current=false;
    const current:Drag={id,deck,pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:event.clientX,y:event.clientY,active:false,index:deck.slides.findIndex(slide=>slide.id===id),stop(){}};dragging.current=current;
    const move=(event:globalThis.PointerEvent)=>{if(event.pointerId!==current.pointerId)return;current.x=event.clientX;current.y=event.clientY;update(current);};
    const end=(event:globalThis.PointerEvent)=>{
      if(event.pointerId!==current.pointerId)return;
      move(event);
      const bounds=container.getBoundingClientRect();
      const inside=event.clientX>=Math.max(0,bounds.left)&&event.clientX<=Math.min(win.innerWidth,bounds.right)&&
        event.clientY>=Math.max(0,bounds.top)&&event.clientY<=Math.min(win.innerHeight,bounds.bottom);
      stop(!inside);
    },cancel=()=>stop(),lost=(event:globalThis.PointerEvent)=>{if(event.pointerId===current.pointerId)stop();},key=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();stop();}};
    const stopMotion=startDragEdgeMotion(container,()=>current.active?{x:current.x,y:current.y}:null,(_dx,dy)=>{container.scrollTop+=dy;update(current);});
    const capture=event.currentTarget;current.stop=()=>{stopMotion();win.removeEventListener("pointermove",move);win.removeEventListener("pointerup",end);win.removeEventListener("pointercancel",lost);win.removeEventListener("keydown",key,true);win.removeEventListener("blur",cancel);capture.removeEventListener("lostpointercapture",lost);if(capture.hasPointerCapture?.(current.pointerId))capture.releasePointerCapture(current.pointerId);};
    win.addEventListener("pointermove",move);win.addEventListener("pointerup",end);win.addEventListener("pointercancel",lost);win.addEventListener("keydown",key,true);win.addEventListener("blur",cancel);capture.addEventListener("lostpointercapture",lost);capture.setPointerCapture?.(current.pointerId);
  }
  const ghost=feedback?deck.slides.find(slide=>slide.id===feedback.id):undefined;
  return <aside ref={root} className="lxp-filmstrip" aria-label="スライド一覧"
    onContextMenu={event => { if (!(event.target as HTMLElement).closest?.("[data-filmstrip-id]")) contextMenu(event); }}
    onClickCapture={event=>{if(suppressClick.current){suppressClick.current=false;event.preventDefault();event.stopPropagation();}}}>
    <div className="lxp-filmstrip-heading"><span>スライド</span><span>{deck.slides.length}</span></div>
    <ol ref={list} className="lxp-slide-list">
      {feedback&&<li className="lxp-slide-insertion" aria-hidden="true" style={{top:feedback.line}}/>}
      {deck.slides.map((slide, index) => <li key={slide.id} data-filmstrip-id={slide.id} className={`lxp-slide-item${editor.selection.slideId === slide.id ? " is-selected" : ""}${feedback?.id === slide.id ? " is-dragging" : ""}`} onPointerDown={event=>begin(event,slide.id)} onDragStart={event=>event.preventDefault()} onContextMenu={event => contextMenu(event, slide.id)}>
        <span className="lxp-slide-number">{index + 1}</span><div className="lxp-slide-item-main">
          <button type="button" className="lxp-slide-thumbnail" aria-label={`スライド ${index + 1}: ${slide.name}`} aria-current={editor.selection.slideId === slide.id ? "true" : undefined} style={{ aspectRatio: `${deck.width}/${deck.height}` }} onClick={() => editor.select({ slideId: slide.id, elementIds: [] })}>
            <SlideArtwork deck={deck} slide={slide} scale={164 / deck.width} />
          </button><div className="lxp-slide-caption"><span title={slide.name}>{slide.name}</span>
            {editor.features.addSlides && !editor.readOnly && <button type="button" aria-label={`${slide.name}を複製`} title="スライドを複製" disabled={!editor.editable} onClick={() => void editor.execute({ type: "slide.duplicate", slideId: slide.id })}><Copy size={12} /></button>}
            {editor.features.deleteSlides && !editor.readOnly && <button type="button" aria-label={`${slide.name}を削除`} title="スライドを削除" disabled={!editor.editable} onClick={() => void editor.execute({ type: "slide.delete", slideId: slide.id })}><Trash2 size={12} /></button>}
          </div></div>
      </li>)}
    </ol>
    {ghost&&feedback&&<div className="lxp-slide-drag-preview" aria-hidden="true" style={{left:feedback.x,top:feedback.y}}><div style={{width:140,height:140*deck.height/deck.width,overflow:"hidden",position:"relative"}}><SlideArtwork deck={deck} slide={ghost} scale={140/deck.width}/></div><span>{ghost.name}</span></div>}
    {editor.features.addSlides && !editor.readOnly && <button type="button" className="lxp-new-slide" disabled={!editor.editable} onClick={() => void editor.execute({ type: "slide.add", afterId: editor.selection.slideId || undefined })}><Plus size={16} />新しいスライド</button>}
  </aside>;
}
