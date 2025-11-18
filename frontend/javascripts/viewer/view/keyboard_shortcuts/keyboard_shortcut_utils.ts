import type { KeyBindingLoopMap, KeyBindingMap } from "libs/input";
import type {
  KeyboardShortcutsMap,
  KeyboardShortcutHandlerMap,
  KeyboardShortcutLoopedHandlerMap,
} from "./keyboard_shortcut_constants";
import _ from "lodash";

export const MODIFIER_KEYS = new Set(["ctrl", "super", "alt", "shift"]);

export function normalizeKeyName(raw: string): string {
  if (!raw) return raw;
  // unify common names
  switch (raw) {
    case " ":
      return "space";
    case "Esc":
    case "Escape":
      return "esc";
    case "ArrowLeft":
      return "left";
    case "ArrowRight":
      return "right";
    case "ArrowUp":
      return "up";
    case "ArrowDown":
      return "down";
    case "Meta":
      return "super";
    case "Control":
      return "ctrl";
    case "Alt":
      return "alt";
    case "Shift":
      return "shift";
    case "Enter":
      return "enter";
    case "Backspace":
      return "backspace";
    case "Delete":
      return "delete";
    case "Tab":
      return "tab";
    default:
      // use lowercased printable
      return raw.length === 1 ? raw.toLowerCase() : raw.toLowerCase();
  }
}

export function formatStrokeFromOrder(order: string[]): string {
  // Ensure modifiers appear first in canonical order,
  // then non-modifier keys in the order they were pressed (preserved in `order`)
  const modifiersOrder = ["ctrl", "super", "alt", "shift"];
  const presentModifiers: string[] = [];
  const nonModifiers: string[] = [];

  const seen = new Set<string>();
  for (const k of order) {
    const n = k.toLowerCase();
    if (MODIFIER_KEYS.has(n)) {
      seen.add(n);
    } else {
      if (!seen.has(n)) {
        // only add non-modifier if not a modifier (keeps uniqueness)
        nonModifiers.push(n);
        seen.add(n);
      }
    }
  }

  for (const m of modifiersOrder) {
    if (seen.has(m)) presentModifiers.push(m);
  }

  // But order may have modifiers after non-modifiers in `order`. We already fixed ordering.
  // Combine modifiers then nonModifiers
  const parts = [...presentModifiers, ...nonModifiers];
  return parts.join(" + ");
}

export const buildKeyBindingsFromConfigAndMapping = (
  config: KeyboardShortcutsMap<string>,
  handlerIdMapping: KeyboardShortcutHandlerMap<string>,
): KeyBindingMap => {
  const mappedShortcuts = _.flatten(
    Object.entries(config).map(([handlerId, keyCombos]) => {
      const isInHandlerMapping = handlerId in handlerIdMapping;
      if (isInHandlerMapping) {
        return keyCombos.map((keyCombo) => {
          const keyComboStr = formatStrokeFromOrder(keyCombo);
          return [keyComboStr, handlerIdMapping[handlerId]];
        });
      } else {
        return undefined;
      }
    }),
  ).filter((mapping) => mapping != null);
  return Object.fromEntries(mappedShortcuts);
};

export const buildKeyBindingsFromConfigAndLoopedMapping = (
  config: KeyboardShortcutsMap<string>,
  handlerIdMapping: KeyboardShortcutLoopedHandlerMap<string>,
): KeyBindingLoopMap => {
  const mappedShortcuts = _.flatten(
    Object.entries(config).map(([handlerId, keyCombos]) => {
      const isInHandlerMapping = handlerId in handlerIdMapping;
      if (isInHandlerMapping) {
        return keyCombos.map((keyCombo) => {
          const keyComboStr = formatStrokeFromOrder(keyCombo);
          return [keyComboStr, handlerIdMapping[handlerId]];
        });
      } else {
        return undefined;
      }
    }),
  ).filter((mapping) => mapping != null);
  return Object.fromEntries(mappedShortcuts);
};
