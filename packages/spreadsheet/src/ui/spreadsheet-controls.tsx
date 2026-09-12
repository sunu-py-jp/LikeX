"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Command({ children, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; label: string }) {
  return <button type="button" {...props} className={`lxs-command ${props.className ?? ""}`} aria-label={label} title={props.title ?? label}>{children}</button>;
}

const paths = {
  save: "M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h12l4 4v12a2 2 0 0 1-2 2ZM7 3v6h10V3M7 21v-8h10v8",
  undo: "M9 14 4 9l5-5M4 9h10a6 6 0 0 1 0 12",
  redo: "m15 14 5-5-5-5m5 5H10a6 6 0 0 0 0 12",
  copy: "M9 9h12v12H9zM5 15H3V3h12v2",
  paste: "M9 4H5v17h14V4h-4M9 2h6v5H9z",
  cut: "m4 4 16 16M4 20 20 4M8 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm0 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z",
  plus: "M12 5v14M5 12h14",
  close: "m6 6 12 12M6 18 18 6",
  check: "m4 12 5 5L20 6",
  image: "M3 3h18v18H3zM3 17l6-6 4 4 3-3 5 5M7 7h.01",
  text: "M4 4h16M12 4v16M8 20h8",
  comment: "M4 3h16v14H9l-5 4V3ZM8 7h8M8 11h6",
  merge: "M3 3h18v18H3zM12 3v4M12 17v4M5 12h5m-2-2 2 2-2 2m11-2h-5m2-2-2 2 2 2",
  unmerge: "M3 3h18v18H3zM12 3v18M10 12H5m2-2-2 2 2 2m7-2h5m-2-2 2 2-2 2",
  alignLeft: "M4 5h16M4 10h10M4 15h16M4 20h10",
  alignCenter: "M4 5h16M7 10h10M4 15h16M7 20h10",
  alignRight: "M4 5h16M10 10h10M4 15h16M10 20h10",
  alignTop: "M3 3h18M7 7h10M7 11h10M7 15h10",
  alignMiddle: "M3 3h18M7 8h10M7 12h10M7 16h10M3 21h18",
  alignBottom: "M7 9h10M7 13h10M7 17h10M3 21h18",
  wrap: "M3 5h17M3 10h13a4 4 0 0 1 0 8h-5m3-3-3 3 3 3M3 15h4",
  fontColor: "m6 18 6-15 6 15M8.5 12h7M3 22h18",
  fillColor: "m5 3 11 11M9 4l9 9-8 8-9-9 8-8ZM4 14h12m4 1s-2 3-2 4a2 2 0 0 0 4 0c0-1-2-4-2-4Z",
  borders: "M3 3h18v18H3zM3 9h18M3 15h18M9 3v18M15 3v18",
  conditionalFormat: "M3 3h18v18H3zM3 9h18M9 3v18M13 17v-3M17 17v-5",
  search: "M17 10a7 7 0 1 1-14 0 7 7 0 0 1 14 0Zm-2 5 6 6",
  replace: "M14 8a5 5 0 1 1-10 0 5 5 0 0 1 10 0Zm-1 4 5 5M3 18h10m-3-3 3 3-3 3M19 3v7m-3-3 3 3 3-3",
  table: "M3 3h18v18H3zM3 9h18M3 15h18M9 9v12M15 9v12",
  shape: "M3 3h10v10H3zM21 16a5 5 0 1 1-10 0 5 5 0 0 1 10 0Z",
  validation: "M3 4h10v16H3zM6 8h4M6 12h3m5 2 3 3 5-7",
  namedRange: "M9 4h11v16H4V9M4 4h1M4 12h16M12 4v16M1 1h7v7H1z",
  edit: "m16 3 5 5-12 12-6 1 1-6L16 3Zm-2 2 5 5",
} as const;

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
