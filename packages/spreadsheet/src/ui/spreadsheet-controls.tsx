"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Command({ children, label, ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { children: ReactNode; label: string }) {
  return <button type="button" {...props} className={`lxs-command ${props.className ?? ""}`} aria-label={label} title={label}>{children}</button>;
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
} as const;

export function Icon({ name }: { name: keyof typeof paths }) {
  return <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={paths[name]} /></svg>;
}
