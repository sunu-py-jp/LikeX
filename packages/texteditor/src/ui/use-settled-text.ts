import { useEffect, useState } from "react";

/** From this length on, whole-source work (syntax checks, formatting) waits for a pause in typing. */
export const SETTLED_TEXT_LENGTH = 50_000;
const SETTLE_DELAY = 300;

/**
 * The text to run whole-source work on. Short text is returned as is, so nothing changes for
 * ordinary files. Long text is returned once it has stopped changing for a moment; `key`
 * identifies what is being shown, and a different key is never delayed.
 */
export function useSettledText(text: string, key: string): string {
  const [settled, setSettled] = useState({ key, text });
  if (settled.key !== key) setSettled({ key, text });
  const long = text.length >= SETTLED_TEXT_LENGTH, current = settled.key === key ? settled.text : text;
  useEffect(() => {
    if (!long || current === text) return;
    const timer = setTimeout(() => setSettled({ key, text }), SETTLE_DELAY);
    return () => clearTimeout(timer);
  }, [text, key, long, current]);
  return long ? current : text;
}
