"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ComponentProps, type Ref } from "react";
import { AlertDialog as RadixAlert, ContextMenu as RadixContext, Dialog as RadixDialog, DropdownMenu as RadixDropdown } from "radix-ui";
import { useExplorerDom } from "./explorer-dom-context";
import { isComposingKeyEvent } from "../model/keyboard";

type LayerKind = "dialog" | "alert" | "menu";
const LayerContext = createContext<{ kind: LayerKind; open: boolean; dismiss(): void } | null>(null);
const documentLayers = new WeakMap<Document, HTMLElement[]>();

function useForeignDocument() {
  const environment = useExplorerDom();
  return !!environment.document && typeof document !== "undefined" && environment.document !== document;
}

function useLayerRoot(props: { open?: boolean; defaultOpen?: boolean; onOpenChange?(open: boolean): void }, kind: LayerKind) {
  const foreign = useForeignDocument();
  const [localOpen, setLocalOpen] = useState(props.defaultOpen ?? false);
  const open = props.open ?? localOpen;
  const onOpenChange = (next: boolean) => {
    if (props.open === undefined) setLocalOpen(next);
    props.onOpenChange?.(next);
  };
  return { foreign, open, onOpenChange, value: { kind, open, dismiss: () => onOpenChange(false) } };
}

function DropdownRoot(props: ComponentProps<typeof RadixDropdown.Root>) {
  const layer = useLayerRoot(props, "menu");
  return <LayerContext.Provider value={layer.value}><RadixDropdown.Root {...props} open={layer.open} onOpenChange={layer.onOpenChange} modal={layer.foreign ? false : props.modal} /></LayerContext.Provider>;
}

function ContextRoot(props: ComponentProps<typeof RadixContext.Root>) {
  const layer = useLayerRoot(props, "menu");
  return <LayerContext.Provider value={layer.value}><RadixContext.Root {...props} open={layer.open} onOpenChange={layer.onOpenChange} modal={layer.foreign ? false : props.modal} /></LayerContext.Provider>;
}

function DialogRoot(props: ComponentProps<typeof RadixDialog.Root>) {
  const layer = useLayerRoot(props, "dialog");
  return <LayerContext.Provider value={layer.value}><RadixDialog.Root {...props} open={layer.open} onOpenChange={layer.onOpenChange} modal={layer.foreign ? false : props.modal} /></LayerContext.Provider>;
}

function AlertRoot(props: ComponentProps<typeof RadixAlert.Root>) {
  const layer = useLayerRoot(props, "alert");
  return <LayerContext.Provider value={layer.value}>{layer.foreign
    ? <RadixDialog.Root {...props} open={layer.open} onOpenChange={layer.onOpenChange} modal={false} />
    : <RadixAlert.Root {...props} open={layer.open} onOpenChange={layer.onOpenChange} />}</LayerContext.Provider>;
}

function assignRef<T>(ref: Ref<T> | undefined, value: T | null) {
  if (typeof ref === "function") ref(value);
  else if (ref) ref.current = value;
}

function focusable(element: HTMLElement) {
  return element.tabIndex >= 0 && !element.matches(":disabled,[hidden],[aria-hidden=true]") && element.getClientRects().length > 0;
}

function candidates(content: HTMLElement, menu: boolean) {
  const selector = menu
    ? '[role^="menuitem"]:not([data-disabled]):not([aria-disabled="true"])'
    : 'button,input,textarea,select,a[href],[tabindex],iframe,video[controls],audio[controls],summary';
  return Array.from(content.querySelectorAll<HTMLElement>(selector)).filter((element) => menu
    ? element.getClientRects().length > 0 && element.closest('[role="menu"]') === content
    : focusable(element));
}

const hiddenElements = new WeakMap<HTMLElement, { count: number; inert: boolean; ariaHidden: string | null }>();
const scrollLocks = new WeakMap<Document, { count: number; overflow: string }>();

function isolateDialog(content: HTMLElement) {
  const ownerDocument = content.ownerDocument;
  const hidden: HTMLElement[] = [];
  let branch = content;
  while (branch.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling === branch || sibling.tagName === "STYLE" || sibling.tagName === "SCRIPT" || sibling.hasAttribute("data-explorer-overlay")) continue;
      const element = sibling as HTMLElement;
      const prior = hiddenElements.get(element);
      if (prior) prior.count += 1;
      else {
        hiddenElements.set(element, { count: 1, inert: element.inert, ariaHidden: element.getAttribute("aria-hidden") });
        element.inert = true;
        element.setAttribute("aria-hidden", "true");
      }
      hidden.push(element);
    }
    branch = branch.parentElement;
    if (branch === ownerDocument.body) break;
  }
  const lock = scrollLocks.get(ownerDocument);
  if (lock) lock.count += 1;
  else {
    scrollLocks.set(ownerDocument, { count: 1, overflow: ownerDocument.body.style.overflow });
    ownerDocument.body.style.overflow = "hidden";
  }
  return () => {
    for (const element of hidden) {
      const prior = hiddenElements.get(element);
      if (!prior || --prior.count > 0) continue;
      element.inert = prior.inert;
      if (prior.ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", prior.ariaHidden);
      hiddenElements.delete(element);
    }
    const priorLock = scrollLocks.get(ownerDocument);
    if (priorLock && --priorLock.count === 0) {
      ownerDocument.body.style.overflow = priorLock.overflow;
      scrollLocks.delete(ownerDocument);
    }
  };
}

type FocusProps = {
  ref?: Ref<HTMLDivElement>;
  onOpenAutoFocus?(event: Event): void;
  onCloseAutoFocus?(event: Event): void;
  onEscapeKeyDown?(event: KeyboardEvent): void;
};

/** Radix's focus scope still reads the opener's document; child windows use their own DOM events. */
function useLayerContent(props: FocusProps) {
  const foreign = useForeignDocument();
  const environment = useExplorerDom();
  const layer = useContext(LayerContext);
  const [content, setContent] = useState<HTMLDivElement | null>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const restoreFocus = useRef(true);
  const dismissRef = useRef(layer?.dismiss);
  const escapeRef = useRef(props.onEscapeKeyDown);
  useEffect(() => { dismissRef.current = layer?.dismiss; }, [layer?.dismiss]);
  useEffect(() => { escapeRef.current = props.onEscapeKeyDown; }, [props.onEscapeKeyDown]);
  const ref = useCallback((element: HTMLDivElement | null) => {
    setContent(element);
    assignRef(props.ref, element);
  }, [props.ref]);
  const menu = layer?.kind === "menu";

  useEffect(() => {
    if (!foreign || !content) return;
    const ownerDocument = content.ownerDocument;
    const stack = documentLayers.get(ownerDocument) ?? [];
    stack.push(content);
    documentLayers.set(ownerDocument, stack);
    const top = () => stack.at(-1) === content;
    const releaseIsolation = menu ? undefined : isolateDialog(content);
    let lastFocus: HTMLElement | null = null;
    let search = "";
    let searchAt = 0;
    const keydown = (event: globalThis.KeyboardEvent) => {
      if (!top()) return;
      if (event.key === "Escape") {
        if (isComposingKeyEvent(event)) return;
        escapeRef.current?.(event);
        if (event.defaultPrevented) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        dismissRef.current?.();
        return;
      }
      const items = candidates(content, menu);
      const active = ownerDocument.activeElement;
      const index = items.findIndex((item) => item === active);
      let next: HTMLElement | undefined;
      if (event.key === "Tab") {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (!menu) (index < 0 ? (event.shiftKey ? items.at(-1) : items[0]) ?? content : items[(index + (event.shiftKey ? -1 : 1) + items.length) % items.length] ?? content).focus();
        return;
      }
      if (!menu || event.ctrlKey || event.metaKey || event.altKey || event.isComposing) return;
      if (event.key === "ArrowDown") next = items[(index + 1) % items.length];
      else if (event.key === "ArrowUp") next = index < 0 ? items.at(-1) : items[(index - 1 + items.length) % items.length];
      else if (event.key === "Home" || event.key === "PageUp") next = items[0];
      else if (event.key === "End" || event.key === "PageDown") next = items.at(-1);
      else if (event.key.length === 1 && event.key !== " ") {
        const now = Date.now();
        search = now - searchAt < 1000 ? search + event.key : event.key;
        searchAt = now;
        const prefix = Array.from(search).every((char) => char === search[0]) ? search[0] : search;
        const ordered = [...items.slice(index + 1), ...items.slice(0, index + 1)];
        next = ordered.find((item) => item.textContent?.trim().toLocaleLowerCase().startsWith(prefix.toLocaleLowerCase()));
      } else return;
      event.preventDefault();
      event.stopImmediatePropagation();
      next?.focus();
    };
    const focusin = (event: FocusEvent) => {
      if (!top()) return;
      const target = event.target as HTMLElement | null;
      if (target && content.contains(target)) lastFocus = target;
      else if (!menu) (lastFocus?.isConnected ? lastFocus : candidates(content, false)[0] ?? content).focus();
    };
    const pointerdown = (event: globalThis.PointerEvent) => {
      if (!top() || content.contains(event.target as Node)) return;
      if (menu) {
        restoreFocus.current = false;
        dismissRef.current?.();
      }
    };
    const blur = () => {
      if (menu && top()) {
        restoreFocus.current = false;
        dismissRef.current?.();
      }
    };
    const entryFocus = (event: Event) => event.preventDefault();
    content.addEventListener("rovingFocusGroup.onEntryFocus", entryFocus);
    ownerDocument.addEventListener("keydown", keydown, true);
    ownerDocument.addEventListener("focusin", focusin, true);
    ownerDocument.addEventListener("pointerdown", pointerdown, true);
    ownerDocument.defaultView?.addEventListener("blur", blur);
    return () => {
      ownerDocument.removeEventListener("keydown", keydown, true);
      ownerDocument.removeEventListener("focusin", focusin, true);
      ownerDocument.removeEventListener("pointerdown", pointerdown, true);
      ownerDocument.defaultView?.removeEventListener("blur", blur);
      content.removeEventListener("rovingFocusGroup.onEntryFocus", entryFocus);
      const index = stack.indexOf(content);
      if (index >= 0) stack.splice(index, 1);
      releaseIsolation?.();
    };
  }, [foreign, content, menu]);

  return {
    foreign,
    ref,
    onEscapeKeyDown(event: KeyboardEvent) {
      if (isComposingKeyEvent(event)) event.preventDefault();
      else props.onEscapeKeyDown?.(event);
    },
    onOpenAutoFocus(event: Event) {
      if (foreign || !menu) {
        const element = event.target as HTMLElement;
        previousFocus.current = element.ownerDocument.activeElement as HTMLElement | null;
        restoreFocus.current = true;
      }
      props.onOpenAutoFocus?.(event);
      if (!foreign || event.defaultPrevented) return;
      event.preventDefault();
      const element = event.target as HTMLElement;
      const target = layer?.kind === "alert" ? element.querySelector<HTMLElement>("[data-explorer-alert-cancel]") : undefined;
      (target ?? candidates(element, menu)[0] ?? element).focus({ preventScroll: true });
    },
    onCloseAutoFocus(event: Event) {
      props.onCloseAutoFocus?.(event);
      if ((!foreign && menu) || event.defaultPrevented) return;
      event.preventDefault();
      if (!restoreFocus.current) return;
      const element = event.target as HTMLElement;
      const ownerDocument = element.ownerDocument;
      const active = ownerDocument.activeElement as HTMLElement | null;
      if (active?.isConnected && active.closest('[role="dialog"],[role="alertdialog"],[role="menu"]')) return;
      const prior = previousFocus.current;
      const target = prior?.isConnected && !prior.matches(":disabled,[inert]")
        ? prior : environment.dialogContainer ?? ownerDocument.querySelector<HTMLElement>("[data-explorer-root]");
      target?.focus({ preventScroll: true });
    },
  };
}

function DropdownContent(props: ComponentProps<typeof RadixDropdown.Content>) {
  const { foreign, ...focus } = useLayerContent(props);
  // The underlying Menu content forwards this FocusScope callback.
  return <RadixDropdown.Content {...props} {...focus} data-likex-explorer="" data-explorer-foreign-layer={foreign || undefined} />;
}

function ContextContent(props: ComponentProps<typeof RadixContext.Content>) {
  const { foreign, ...focus } = useLayerContent(props);
  return <RadixContext.Content {...props} {...focus} data-likex-explorer="" data-explorer-foreign-layer={foreign || undefined} />;
}

function DialogContent(props: ComponentProps<typeof RadixDialog.Content>) {
  const { foreign, ...focus } = useLayerContent(props);
  return <RadixDialog.Content {...props} {...focus} data-likex-explorer="" aria-modal={foreign ? true : props["aria-modal"]} onInteractOutside={foreign ? (event) => event.preventDefault() : props.onInteractOutside} />;
}

function AlertContent(props: ComponentProps<typeof RadixAlert.Content>) {
  const { foreign, ...focus } = useLayerContent(props);
  return foreign
    ? <RadixDialog.Content {...props} {...focus} data-likex-explorer="" role="alertdialog" aria-modal onInteractOutside={(event) => event.preventDefault()} />
    : <RadixAlert.Content {...props} {...focus} data-likex-explorer="" />;
}

function DialogOverlay(props: ComponentProps<typeof RadixDialog.Overlay>) {
  const foreign = useForeignDocument();
  const layer = useContext(LayerContext);
  if (!foreign) return <RadixDialog.Overlay {...props} data-likex-explorer="" />;
  return layer?.open ? <div {...props} data-likex-explorer="" data-explorer-overlay="" data-state="open" onPointerDown={(event) => {
    props.onPointerDown?.(event);
    if (event.defaultPrevented || event.target !== event.currentTarget) return;
    event.preventDefault();
    if (layer.kind !== "alert" && event.button === 0) layer.dismiss();
  }} /> : null;
}

function AlertOverlay(props: ComponentProps<typeof RadixAlert.Overlay>) {
  return useForeignDocument() ? <DialogOverlay {...props} /> : <RadixAlert.Overlay {...props} data-likex-explorer="" />;
}

function AlertPortal(props: ComponentProps<typeof RadixAlert.Portal>) {
  return useForeignDocument() ? <RadixDialog.Portal {...props} /> : <RadixAlert.Portal {...props} />;
}
function AlertTitle(props: ComponentProps<typeof RadixAlert.Title>) {
  return useForeignDocument() ? <RadixDialog.Title {...props} /> : <RadixAlert.Title {...props} />;
}
function AlertDescription(props: ComponentProps<typeof RadixAlert.Description>) {
  return useForeignDocument() ? <RadixDialog.Description {...props} /> : <RadixAlert.Description {...props} />;
}
function AlertCancel(props: ComponentProps<typeof RadixAlert.Cancel>) {
  return useForeignDocument() ? <RadixDialog.Close {...props} data-explorer-alert-cancel="" /> : <RadixAlert.Cancel {...props} />;
}
function AlertAction(props: ComponentProps<typeof RadixAlert.Action>) {
  return useForeignDocument() ? <RadixDialog.Close {...props} /> : <RadixAlert.Action {...props} />;
}

export const DropdownMenu = { ...RadixDropdown, Root: DropdownRoot, Content: DropdownContent };
export const ContextMenu = { ...RadixContext, Root: ContextRoot, Content: ContextContent };
export const Dialog = { ...RadixDialog, Root: DialogRoot, Content: DialogContent, Overlay: DialogOverlay };
export const AlertDialog = { ...RadixAlert, Root: AlertRoot, Content: AlertContent, Overlay: AlertOverlay, Portal: AlertPortal, Title: AlertTitle, Description: AlertDescription, Cancel: AlertCancel, Action: AlertAction };
