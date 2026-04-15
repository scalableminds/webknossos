import { Validator } from "jsonschema";
import Store from "viewer/store";
import {
  ALL_KEYBOARD_HANDLER_IDS,
  getAllDefaultKeyboardShortcuts,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";
import type { KeyboardShortcutsMap } from "./keyboard_shortcut_types";

export const KeyboardShortcutsSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "KeyboardShortcutsMap",
  type: "object",
  description: "A mapping from handler IDs to arrays of key combos (string[][]).",
  properties: Object.fromEntries(
    ALL_KEYBOARD_HANDLER_IDS.map((id) => [
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
  required: [...ALL_KEYBOARD_HANDLER_IDS],
  additionalProperties: false,
};

export function validateShortcutMapText(input: string): {
  valid: boolean;
  errors: string[];
  parsed: Record<string, string[][][]> | null;
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
export function loadKeyboardShortcuts(): KeyboardShortcutsMap<string> {
  const state = Store.getState();
  if (state.keyboardShortcutsConfig != null) {
    return state.keyboardShortcutsConfig;
  }
  return getAllDefaultKeyboardShortcuts();
}
