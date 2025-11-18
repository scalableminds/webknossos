import type { KeyboardShortcutsMap } from "libs/input";

import {
  DEFAULT_GENERAL_KEYBOARD_SHORTCUTS,
  DEFAULT_GENERAL_EDITING_KEYBOARD_SHORTCUTS,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";

// STORAGE KEY
const STORAGE_KEY = "webknossosCustomShortcuts";

/**
 * Load persisted keyboard shortcuts.
 * Falls back to merged defaults when not available or invalid.
 */
export function loadKeyboardShortcuts(): KeyboardShortcutsMap<string> {
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) return getDefaultShortcuts();

  try {
    // TODOM: add schema check and so on
    return JSON.parse(json) as KeyboardShortcutsMap<string>;
  } catch {
    return getDefaultShortcuts();
  }
}

/**
 * Persist the entire keyboard shortcut map.
 */
export function saveKeyboardShortcuts(map: KeyboardShortcutsMap<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}

/**
 * Merge all default shortcut maps into one.
 */
export function getDefaultShortcuts(): KeyboardShortcutsMap<string> {
  return {
    ...DEFAULT_GENERAL_KEYBOARD_SHORTCUTS,
    ...DEFAULT_GENERAL_EDITING_KEYBOARD_SHORTCUTS,
  };
}
