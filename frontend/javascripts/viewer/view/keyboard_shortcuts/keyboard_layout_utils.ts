/**
 * Keyboard Layout Utilities
 *
 * ## Why shortcuts use `@code` notation
 *
 * Keyboard shortcuts that use symbol or punctuation keys (e.g. `+`, `#`, `[`) are stored
 * as the value of `KeyboardEvent.code` prefixed with `@` (e.g. `@BracketRight`) rather than
 * the literal character the key produces. We cannot use `KeyboardEvent.key` directly for two reasons:
 *
 * 1. **Modifier interference** (main reason) – `key` reflects the character *after* modifiers
 *    are applied. On a German keyboard, `Shift + 1` yields `!` via `key`, so the shortcut
 *    library we use (keystrokes) would have to be configured as `Shift + !`. That is highly
 *    unintuitive: users expect the shortcut label to read `Shift + 1`, not `Shift + !`.
 *
 * 2. **Layout variance** – the same physical key produces different characters on different
 *    layouts: `BracketRight` is `]` on US but `+` on German. If a shortcut were stored as
 *    `Shift + !`, it would break entirely on layouts where `!` requires a different modifier
 *    combination or cannot be produced at all.
 *
 * Using `code` (the physical key position) avoids both problems. Note that this only applies
 * to symbol/punctuation keys; regular letter keys (`[a-zA-Z]`) are stored as literal characters
 * because they are stable across the layouts we support.
 *
 * ## Resolving display labels
 *
 * Storing keys by `code` means the labels are US-centric by default (`BracketRight` → `]`),
 * which may not match what the key actually shows on the user's keyboard. To display the
 * correct character we maintain a `layoutMap`: a map from `KeyboardEvent.code`s to the unmodified
 * character they produce on the user's current layout.
 *
 * ## Building the layout map
 *
 * Browsers differ in what they expose:
 *
 * - **Chrome / Edge** support the [Keyboard Layout API](https://developer.mozilla.org/en-US/docs/Web/API/Keyboard_API).
 *   On init we call `navigator.keyboard.getLayoutMap()` to get a complete code→character map
 *   immediately. A global `keydown` listener watches for mismatches to detect mid-session
 *   layout switches and re-fetches the full map when one is detected.
 *
 * - **Firefox / Safari** do not support the API. Instead we restore whatever was persisted
 *   to `localStorage` from a previous session, then learn new entries organically: every
 *   unmodified key press (no Shift/Ctrl/Alt/Meta) teaches us the mapping for that code.
 *   If the stored layout no longer matches (detected when a known code yields a different
 *   character -> likely a layout switch done by the user), the entire map is cleared and
 *   rebuilt from scratch.
 *
 * - **Cold start / unknown keys** – when a code is not yet in the map, `displayKeyName`
 *   falls back to a hard-coded US layout table so the UI always shows *something* sensible
 *   rather than the raw `@code` string. The shortcut itself is always active regardless of
 *   whether the label is resolved.
 *
 * See also: docs/ui/keyboard_shortcuts.md, "Key labels for special symbol keys".
 */
import UserLocalStorage from "libs/user_local_storage";
import { document } from "libs/window";
import {
  setKeyboardLayoutMapAction,
  setKeyboardLayoutMapEntryAction,
} from "viewer/model/actions/settings_actions";
import Store from "viewer/store";
import type { UnmodifiedLayoutMap } from "./keyboard_shortcut_types";

const LOCAL_STORAGE_KEY = "keyboardLayoutMap";

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

function seedDigits(base: UnmodifiedLayoutMap = new Map()): UnmodifiedLayoutMap {
  const result = new Map(base);
  for (let i = 0; i <= 9; i++) {
    if (!(`Digit${i}` in result)) {
      result.set(`Digit${i}`, String(i));
    }
  }
  return result;
}

function persistToLocalStorage(map: UnmodifiedLayoutMap) {
  const mapAsObject = JSON.stringify(Object.fromEntries(map.entries()));
  UserLocalStorage.setItem(LOCAL_STORAGE_KEY, mapAsObject, false);
}

// Returns whether the Keyboard Layout API is available in this browser.
// When false, sign keys may temporarily display as "@code" until runtime-learned.
export function isKeyboardLayoutApiAvailable(): boolean {
  return "keyboard" in navigator && "getLayoutMap" in ((navigator as any).keyboard as object);
}

async function loadFromLayoutAPI(): Promise<boolean> {
  try {
    const layoutMap: Map<string, string> = await (navigator as any).keyboard.getLayoutMap();
    const map: UnmodifiedLayoutMap = new Map();
    for (const [code, key] of layoutMap) {
      map.set(code, key);
    }
    const seeded = seedDigits(map);
    Store.dispatch(setKeyboardLayoutMapAction(seeded));
    persistToLocalStorage(seeded);
    return true;
  } catch {
    // API call failed — fall through to empty map; runtime keydowns will fill it in.
  }
  return false;
}

// Called once from model_initialization.ts after the shortcut config is dispatched.
export async function initializeKeyboardLayoutMap(): Promise<void> {
  if (isKeyboardLayoutApiAvailable()) {
    const successful = await loadFromLayoutAPI();
    if (successful) {
      // Still listen to keyboard input to detect layout changes.
      document.addEventListener("keydown", registerKeyForLayoutMap, { capture: true });
      return;
    }
    // API call failed — fall through to empty map; runtime keydowns will fill it in.
  }
  // Firefox / Safari: restore from localStorage so labels are available immediately.
  const stored = UserLocalStorage.getItem(LOCAL_STORAGE_KEY, false);
  let parsed: Record<string, string> = {};
  if (stored) {
    try {
      parsed = JSON.parse(stored);
    } catch {
      // Corrupt entry — start fresh without recovering previous layout information.
    }
  }
  const parsedAsMap = new Map(Object.entries(parsed));
  const seeded = seedDigits(parsedAsMap);
  Store.dispatch(setKeyboardLayoutMapAction(seeded));
  // Register a global keydown listener to learn new keys organically.
  document.addEventListener("keydown", registerKeyForLayoutMap, { capture: true });
}

// Called from the shortcut recorder modal's keydown handler (all browsers) and the global
// keydown listener registered above (non-API browsers only).
export function registerKeyForLayoutMap(e: KeyboardEvent) {
  // Only learn unmodified, non-dead, single-character key presses.
  const isEventModified =
    e.shiftKey || e.ctrlKey || e.altKey || e.metaKey || e.key === "Dead" || e.key.length !== 1;
  if (isEventModified) {
    return;
  }

  const currentMap = Store.getState().keyboardConfiguration.unmodifiedLayoutMap;
  const existing = currentMap.get(e.code);

  if (isKeyboardLayoutApiAvailable()) {
    // API path: re-fetch the full layout map when a mismatch is detected (user switched layout).
    if (existing != null && existing !== e.key) {
      loadFromLayoutAPI();
    }
  } else {
    // Non-API path: learn keys one by one; clear the whole map on layout switch.
    if (existing == null) {
      const copy = new Map(currentMap);
      const updated = copy.set(e.code, e.key);
      Store.dispatch(setKeyboardLayoutMapEntryAction(e.code, e.key));
      persistToLocalStorage(updated);
    } else if (existing !== e.key) {
      // Layout changed — clear stale entries, keep only this new mapping + digit seeds.
      const newMap = new Map<string, string>().set(e.code, e.key);
      const fresh = seedDigits(newMap);
      Store.dispatch(setKeyboardLayoutMapAction(fresh));
      persistToLocalStorage(fresh);
    }
  }
}

// Translates a stored key name to a human-readable display string.
//   "a"             → "a"     (unchanged — letter)
//   "Shift"         → "Shift" (unchanged — modifier)
//   "F1"            → "F1"    (unchanged — named key)
//   "@BracketRight" → "+" on German keyboard, "]" on US (via layout map)
export function displayKeyName(key: string, layoutMap: UnmodifiedLayoutMap): string {
  if (!key.startsWith("@")) {
    return key;
  }
  const code = key.slice(1);
  const fromMap = layoutMap.get(code);
  if (fromMap != null) {
    return fromMap;
  }
  const fromFallback = US_LAYOUT_FALLBACK[code];
  if (fromFallback != null) {
    return fromFallback;
  }
  return key;
}
