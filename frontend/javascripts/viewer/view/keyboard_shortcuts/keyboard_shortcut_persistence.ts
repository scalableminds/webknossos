import { Validator } from "jsonschema";
import Store from "viewer/store";
import {
  ALL_KEYBOARD_SHORTCUT_IDS,
  getAllDefaultKeyboardShortcuts,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";
import type { KeyboardShortcutsMap } from "./keyboard_shortcut_types";

export const KeyboardShortcutsSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "KeyboardShortcutsMap",
  type: "object",
  description: "A mapping from handler IDs to arrays of key combos (string[][]).",
  properties: Object.fromEntries(
    ALL_KEYBOARD_SHORTCUT_IDS.map((id) => [
      id,
      {
        type: "array",
        items: {
          type: "array",
          items: {
            type: "array",
            items: { type: "string" },
          },
        },
      },
    ]),
  ),
};

function isValidShortcutValue(value: unknown): value is string[][][] {
  return (
    Array.isArray(value) &&
    value.every(
      (comboChain) =>
        Array.isArray(comboChain) &&
        comboChain.every(
          (combo) => Array.isArray(combo) && combo.every((key) => typeof key === "string"),
        ),
    )
  );
}

/**
 * Normalizes a raw parsed object into a complete, valid KeyboardShortcutsMap:
 *  - Drops keys not in ALL_KEYBOARD_HANDLER_IDS.
 *  - Falls back to the default combo for any key whose value is missing or
 *    has the wrong shape.
 */
export function sanitizeKeyboardShortcuts(raw: Record<string, unknown>): KeyboardShortcutsMap {
  const defaults = getAllDefaultKeyboardShortcuts();
  const result: Record<string, string[][][]> = {};
  for (const id of ALL_KEYBOARD_SHORTCUT_IDS) {
    result[id] = isValidShortcutValue(raw[id]) ? raw[id] : defaults[id];
  }
  return result as KeyboardShortcutsMap;
}

export function validateShortcutMapText(input: string): {
  valid: boolean;
  errors: string[];
  parsed: KeyboardShortcutsMap | null;
} {
  const errors: string[] = [];
  let parsed: any = null;

  // 1. JSON parsing
  try {
    parsed = JSON.parse(input);
  } catch (err) {
    return { valid: false, errors: ["Invalid JSON: " + err], parsed: null };
  }

  // 2. Schema validation
  const validator = new Validator();
  const schemaResult = validator.validate(parsed, KeyboardShortcutsSchema);

  if (!schemaResult.valid) {
    errors.push(...schemaResult.errors.map((e) => `Schema: ${e.stack}`));
  }

  return {
    valid: errors.length === 0,
    errors,
    parsed,
  };
}

/**
 * Load keyboard shortcuts from the store.
 */
export function loadKeyboardShortcuts(): KeyboardShortcutsMap {
  const state = Store.getState();
  if (state.keyboardShortcutsConfig != null) {
    return state.keyboardShortcutsConfig;
  }
  return getAllDefaultKeyboardShortcuts();
}
