"use client";

/* Embedded images stay local to the JSON document. */
/* eslint-disable @next/next/no-img-element */
import type { CSSProperties } from "react";
import type { Slide, SlideDeck, SlideElement, SlideShapeElement } from "../model/types";
import { resolveSlideAppearance } from "../model/index";
import { getSlideLineMarkers } from "../render/line-markers";
import { getSlideShapeGeometry, SHAPE_TEXT_STYLE, SLIDE_TEXT_STYLE } from "../render/render-style";

export function elementStyle(element: SlideElement): CSSProperties {
  return { left: element.x, top: element.y, width: element.width, height: element.height,
    transform: `rotate(${element.rotation}deg)`, opacity: element.opacity };
}

function Shape({ element }: { element: SlideShapeElement }) {
  const { width, height } = element;
  const common = { fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth,
    strokeLinejoin: "round" as const, vectorEffect: element.shape === "line" ? undefined : "non-scaling-stroke" as const };
  const geometry = getSlideShapeGeometry(element);
  const shape = geometry.kind === "ellipse" ? <ellipse cx={geometry.cx} cy={geometry.cy} rx={geometry.rx} ry={geometry.ry} {...common} />
    : geometry.kind === "polygon" ? <polygon points={geometry.points.map(point => point.join(",")).join(" ")} {...common} />
    : geometry.kind === "line" ? <line x1={geometry.x1} y1={geometry.y1} x2={geometry.x2} y2={geometry.y2} {...common} fill="none" strokeLinecap="round" />
    : <rect x={geometry.x} y={geometry.y} width={geometry.width} height={geometry.height} rx={geometry.radius} {...common} />;
  return <><svg style={element.shape === "line" ? { overflow: "visible" } : undefined} width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{shape}{getSlideLineMarkers(element).map((marker, index) => marker.kind === "ellipse" ? <ellipse key={index} style={{ pointerEvents: "visiblePainted" }} cx={marker.cx} cy={marker.cy} rx={marker.rx} ry={marker.ry} transform={`rotate(${marker.rotation * 180 / Math.PI} ${marker.cx} ${marker.cy})`} fill={element.stroke} stroke={element.stroke} strokeWidth={element.strokeWidth} /> : marker.kind === "polygon" ? <polygon key={index} style={{ pointerEvents: "visiblePainted" }} points={marker.points.map(point => point.join(",")).join(" ")} fill={element.stroke} stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinejoin="round" /> : <polyline key={index} style={{ pointerEvents: "visiblePainted" }} points={marker.points.map(point => point.join(",")).join(" ")} fill="none" stroke={element.stroke} strokeWidth={element.strokeWidth} strokeLinejoin="round" />)}</svg>
    {element.text && <div className="lxp-shape-text" style={{ color: element.textColor, fontSize: element.fontSize, fontFamily: SHAPE_TEXT_STYLE.fontFamily, padding: `${SHAPE_TEXT_STYLE.paddingY}px ${SHAPE_TEXT_STYLE.paddingX}px`, lineHeight: SHAPE_TEXT_STYLE.lineHeight }}>{element.text}</div>}</>;
}

/** Shared by the editor, slide thumbnails and presentation view. */
export function SlideElementContent({ element }: { element: SlideElement }) {
  if (element.type === "image") return <img className="lxp-element-image" src={element.src} alt={element.alt} draggable={false} />;
  if (element.type === "shape") return <Shape element={element} />;
  return <div className="lxp-element-text" style={{
    fontSize: element.fontSize, fontFamily: element.fontFamily, color: element.color,
    fontWeight: element.bold ? 700 : 400, fontStyle: element.italic ? "italic" : "normal",
    textAlign: element.align, justifyContent: element.verticalAlign === "middle" ? "center" : element.verticalAlign === "bottom" ? "flex-end" : "flex-start",
    background: element.fill, padding: `${SLIDE_TEXT_STYLE.paddingY}px ${SLIDE_TEXT_STYLE.paddingX}px`, lineHeight: SLIDE_TEXT_STYLE.lineHeight,
  }}>{element.text}</div>;
}

export function SlideArtwork({ deck, slide, scale = 1 }: { deck: SlideDeck; slide: Slide; scale?: number }) {
  const appearance = resolveSlideAppearance(deck, slide);
  return <div className="lxp-artwork" aria-hidden="true" style={{ width: deck.width, height: deck.height, background: appearance.background,
    transform: `scale(${scale})`, transformOrigin: "top left" }}>
    {appearance.inheritedElements.map((element, index) => <div key={`inherited:${index}:${element.id}`} className="lxp-element lxp-inherited-element" style={elementStyle(element)}><SlideElementContent element={element} /></div>)}
    {appearance.localElements.map(element => <div key={element.id} data-slide-element-id={element.id} className="lxp-element" style={elementStyle(element)}><SlideElementContent element={element} /></div>)}
  </div>;
}
