import { Validator } from "jsonschema";
import {
  type KeyboardShortcutsMap,
  ALL_KEYBOARD_HANDLER_IDS,
  getAllDefaultKeyboardShortcuts,
} from "viewer/view/keyboard_shortcuts/keyboard_shortcut_constants";

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

// STORAGE KEY
const STORAGE_KEY = "webknossosCustomShortcuts";

/**
 * Load persisted keyboard shortcuts.
 * Falls back to merged defaults when not available or invalid.
 */
export function loadKeyboardShortcuts(): KeyboardShortcutsMap<string> {
  const returnDefaults = () => {
    const defaults = getAllDefaultKeyboardShortcuts();
    saveKeyboardShortcuts(defaults);
    return defaults;
  };
  const json = localStorage.getItem(STORAGE_KEY);
  if (!json) return returnDefaults();

  const { valid, parsed, errors } = validateShortcutMapText(json);
  if (valid) {
    return parsed as KeyboardShortcutsMap<string>;
  }
  console.error("Could not parse stored keyboard shortcuts.", errors);
  console.error("Resetting with defaults.");
  return returnDefaults();
}

/**
 * Persist the entire keyboard shortcut map.
 */
export function saveKeyboardShortcuts(map: KeyboardShortcutsMap<string>): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
}
