"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";
import type { SlidePdfViewerProps } from "./viewer-types";
import { notifyPdfObserver, type PdfSession } from "./use-pdf-document";

/** Validate the whole input before sorting/deduplicating, without retaining a host array. */
function normalizePages(value: unknown, pageCount: number): number[] | null {
  if (!Array.isArray(value)) return null;
  for (const page of value) if (!Number.isSafeInteger(page) || page < 1 || page > pageCount) return null;
  return [...new Set<number>(value)].sort((a, b) => a - b);
}
const equalPages = (left: readonly number[], right: readonly number[]) => left.length === right.length && left.every((page, index) => page === right[index]);
type SelectionProps = Pick<SlidePdfViewerProps, "loadPdf" | "initialSelectedPageNumbers" | "selectedPageNumbers" | "onSelectionChange">;
const snapshotInitial = (value: unknown) => Array.isArray(value) ? [...value] : value;

export function usePdfSelection(session: PdfSession | undefined, pageNumber: number, props: SelectionProps, getPageNumber: () => number) {
  const [initial, setInitial] = useState(() => ({ loader: props.loadPdf, pages: snapshotInitial(props.initialSelectedPageNumbers) }));
  const initialPages = initial.loader === props.loadPdf ? initial.pages : snapshotInitial(props.initialSelectedPageNumbers);
  if (initial.loader !== props.loadPdf) setInitial({ loader: props.loadPdf, pages: initialPages });
  const [stored, setStored] = useState<{ session: PdfSession | undefined; pages: number[] }>({ session: undefined, pages: [] });
  const controlled = props.selectedPageNumbers !== undefined;
  const pages = !session ? [] : controlled ? normalizePages(props.selectedPageNumbers, session.pageCount) ?? []
    : stored.session === session ? stored.pages : initialPages === undefined ? [pageNumber]
      : normalizePages(initialPages, session.pageCount) ?? [];
  if (stored.session !== session || controlled && !equalPages(stored.pages, pages)) setStored({ session, pages });
  const current = useRef({ active: false, session, pages, props, controlled, getPageNumber, anchor: pageNumber });
  useLayoutEffect(() => {
    const anchor = current.current.session === session ? current.current.anchor : pages.at(-1) ?? pageNumber;
    current.current = { active: true, session, pages, props, controlled, getPageNumber, anchor };
  });
  useLayoutEffect(() => () => { current.current.active = false; }, []);
  const request = useCallback((input: readonly number[], anchor?: number, resetAnchor = false) => {
    const state = current.current;
    if (!state.active || !state.session || state.controlled && !state.props.onSelectionChange) return false;
    const next = normalizePages(input, state.session.pageCount);
    if (!next) return false;
    if (resetAnchor) state.anchor = next.at(-1) ?? state.getPageNumber();
    else if (anchor !== undefined) state.anchor = anchor;
    if (equalPages(state.pages, next)) return false;
    if (!state.controlled) { state.pages = next; setStored({ session: state.session, pages: next }); }
    notifyPdfObserver(state.props.onSelectionChange, { pageNumbers: [...next], pageNumber: state.getPageNumber(), pageCount: state.session.pageCount });
    return true;
  }, []);
  const selectPages = useCallback((input: readonly number[]) => request(input, undefined, true), [request]);
  const selectPage = useCallback((number: number, options: { extend?: boolean; toggle?: boolean } = {}) => {
    const state = current.current;
    if (!state.session || !Number.isSafeInteger(number) || number < 1 || number > state.session.pageCount) return false;
    if (options.extend) {
      const anchor = state.anchor || state.getPageNumber() || number;
      const first = Math.min(anchor, number), last = Math.max(anchor, number);
      const range = Array.from({ length: last - first + 1 }, (_, index) => first + index);
      return request(options.toggle ? [...state.pages, ...range] : range);
    }
    return request(options.toggle ? state.pages.includes(number) ? state.pages.filter(page => page !== number) : [...state.pages, number] : [number], number);
  }, [request]);
  const getSelectedPageNumbers = useCallback(() => current.current.session ? [...current.current.pages] : [], []);
  return { pages, selectPages, selectPage, getSelectedPageNumbers };
}
