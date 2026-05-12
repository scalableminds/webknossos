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
