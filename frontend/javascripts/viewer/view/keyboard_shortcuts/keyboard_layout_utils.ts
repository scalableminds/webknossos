import { useEffect, useState } from "react";

// US layout fallback for common sign/punctuation key codes.
// Used when navigator.keyboard.getLayoutMap() is unavailable and the key has
// not yet been seen unmodified in the current session.
const US_LAYOUT_FALLBACK: Record<string, string> = {
  Minus: "-",
  Equal: "=",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Semicolon: ";",
  Quote: "'",
  Backquote: "`",
  Comma: ",",
  Period: ".",
  Slash: "/",
  IntlBackslash: "\\",
  IntlRo: "\\",
  NumpadDecimal: ".",
  NumpadMultiply: "*",
  NumpadAdd: "+",
  NumpadSubtract: "-",
  NumpadDivide: "/",
};

// Maps physical key codes to the character produced without any modifier keys.
// Pre-populated with digits (deterministic on all layouts), then enriched via
// the Keyboard Layout API (Chrome/Edge) or runtime keydown observation.
export const codeToUnshiftedKey = new Map<string, string>();

// Subscriber set — callbacks registered by useLayoutMapVersion are called
// whenever the map gains a new or updated entry.
const layoutMapSubscribers = new Set<() => void>();

function notifyLayoutMapSubscribers() {
  for (const cb of layoutMapSubscribers) cb();
}

function setAndNotify(code: string, key: string) {
  if (codeToUnshiftedKey.get(code) === key) return;
  codeToUnshiftedKey.set(code, key);
  notifyLayoutMapSubscribers();
}

// Digits are always at Digit0–Digit9 and always produce "0"–"9" unmodified.
for (let i = 0; i <= 9; i++) {
  codeToUnshiftedKey.set(`Digit${i}`, String(i));
}

// Populate from the Keyboard Layout API when available (Chrome/Edge).
// This covers all sign keys immediately, before the user presses anything.
if ("keyboard" in navigator && "getLayoutMap" in (navigator.keyboard as object)) {
  (navigator.keyboard as any)
    .getLayoutMap()
    .then((layoutMap: Map<string, string>) => {
      for (const [code, key] of layoutMap) {
        setAndNotify(code, key);
      }
    })
    .catch(() => {});
}

export function registerKeyForLayoutMap(e: KeyboardEvent) {
  if (
    !codeToUnshiftedKey.has(e.code) &&
    !e.shiftKey &&
    !e.ctrlKey &&
    !e.altKey &&
    !e.metaKey &&
    e.key !== "Dead"
  ) {
    setAndNotify(e.code, e.key);
  }
}

// Returns whether the Keyboard Layout API is available in this browser.
// When false, sign keys may temporarily display as "@code" until runtime-learned.
export function isKeyboardLayoutApiAvailable(): boolean {
  return "keyboard" in navigator && "getLayoutMap" in (navigator.keyboard as object);
}
// Runtime fallback for Firefox/Safari with do not support the Keyboard Layout API:
// Record every unmodified key press. Builds the map organically as the user types.
if (!isKeyboardLayoutApiAvailable()) {
  document.addEventListener("keydown", registerKeyForLayoutMap, { capture: true });
}

// Translates a stored key name to a human-readable display string.
//   "a"           → "a"    (unchanged — letter)
//   "Shift"       → "Shift" (unchanged — modifier)
//   "F1"          → "F1"   (unchanged — named key)
//   "@BracketRight" → "+" on German keyboard, "]" on US (via layout map)
export function displayKeyName(key: string): string {
  if (!key.startsWith("@")) {
    return key;
  }
  const code = key.slice(1);
  const fromMap = codeToUnshiftedKey.get(code);
  if (fromMap != null) {
    return fromMap;
  }
  const fromFallback = US_LAYOUT_FALLBACK[code];
  if (fromFallback != null) {
    return fromFallback;
  }
  return key;
}

// React hook: re-renders the calling component whenever the layout map gains a
// new entry. Uses setState inside useEffect so the subscription is set up after
// mount and cleaned up on unmount.
export function useLayoutMapVersionMaybe(): number | null {
  if (isKeyboardLayoutApiAvailable()) {
    return null;
  }
  // biome-ignore lint/correctness/useHookAtTopLevel: isKeyboardLayoutApiAvailable is constant and thus there should never be a change in hook order.
  const [changingIndex, forceUpdate] = useState(0);
  // biome-ignore lint/correctness/useHookAtTopLevel: isKeyboardLayoutApiAvailable is constant and thus there should never be a change in hook order.
  useEffect(() => {
    const callback = () => forceUpdate((n) => n + 1);
    layoutMapSubscribers.add(callback);
    return () => {
      layoutMapSubscribers.delete(callback);
    };
  }, []);
  return changingIndex;
}
