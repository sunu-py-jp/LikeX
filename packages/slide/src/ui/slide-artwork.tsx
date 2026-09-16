"use client";

/* Embedded images stay local to the JSON document. */
/* eslint-disable @next/next/no-img-element */
import type { CSSProperties, ReactNode } from "react";
import type { Slide, SlideDeck, SlideElement, SlideShapeElement } from "../model/types";

export function elementStyle(element: SlideElement): CSSProperties {
  return { left: element.x, top: element.y, width: element.width, height: element.height,
    transform: `rotate(${element.rotation}deg)`, opacity: element.opacity };
}

function Shape({ element }: { element: SlideShapeElement }) {
  const { width, height } = element;
  const common = { fill: element.fill, stroke: element.stroke, strokeWidth: element.strokeWidth,
    strokeLinejoin: "round" as const, vectorEffect: "non-scaling-stroke" as const };
  const pad = element.strokeWidth / 2;
  let shape: ReactNode;
  switch (element.shape) {
    case "ellipse": shape = <ellipse cx={width / 2} cy={height / 2} rx={Math.max(0, width / 2 - pad)} ry={Math.max(0, height / 2 - pad)} {...common} />; break;
    case "triangle": shape = <polygon points={`${width / 2},${pad} ${width - pad},${height - pad} ${pad},${height - pad}`} {...common} />; break;
    case "diamond": shape = <polygon points={`${width / 2},${pad} ${width - pad},${height / 2} ${width / 2},${height - pad} ${pad},${height / 2}`} {...common} />; break;
    case "arrow": shape = <polygon points={`${pad},${height * .28} ${width * .65},${height * .28} ${width * .65},${pad} ${width - pad},${height / 2} ${width * .65},${height - pad} ${width * .65},${height * .72} ${pad},${height * .72}`} {...common} />; break;
    case "line": shape = <line x1={pad} y1={pad} x2={width - pad} y2={height - pad} {...common} fill="none" />; break;
    default: shape = <rect x={pad} y={pad} width={Math.max(0, width - element.strokeWidth)} height={Math.max(0, height - element.strokeWidth)} rx={element.shape === "roundRect" ? Math.min(width, height) * .12 : 0} {...common} />;
  }
  return <><svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} aria-hidden="true">{shape}</svg>
    {element.text && <div className="lxp-shape-text" style={{ color: element.textColor, fontSize: element.fontSize }}>{element.text}</div>}</>;
}

/** Shared by the editor, slide thumbnails and presentation view. */
export function SlideElementContent({ element }: { element: SlideElement }) {
  if (element.type === "image") return <img className="lxp-element-image" src={element.src} alt={element.alt} draggable={false} />;
  if (element.type === "shape") return <Shape element={element} />;
  return <div className="lxp-element-text" style={{
    fontSize: element.fontSize, fontFamily: element.fontFamily, color: element.color,
    fontWeight: element.bold ? 700 : 400, fontStyle: element.italic ? "italic" : "normal",
    textAlign: element.align, justifyContent: element.verticalAlign === "middle" ? "center" : element.verticalAlign === "bottom" ? "flex-end" : "flex-start",
    background: element.fill,
  }}>{element.text}</div>;
}

export function SlideArtwork({ deck, slide, scale = 1 }: { deck: Pick<SlideDeck, "width" | "height">; slide: Slide; scale?: number }) {
  return <div className="lxp-artwork" aria-hidden="true" style={{ width: deck.width, height: deck.height, background: slide.background,
    transform: `scale(${scale})`, transformOrigin: "top left" }}>
    {slide.elements.map(element => <div key={element.id} className="lxp-element" style={elementStyle(element)}><SlideElementContent element={element} /></div>)}
  </div>;
}
