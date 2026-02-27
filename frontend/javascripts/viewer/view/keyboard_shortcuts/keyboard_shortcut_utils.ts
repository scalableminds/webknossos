import type {
  KeyBindingLoopMap,
  KeyBindingMap,
  KeyboardHandlerFn,
  KeyboardLoopFn,
  KeyboardLoopHandler,
  KeyboardNoLoopHandler,
} from "libs/input";
import { flatten } from "lodash-es";
import type { AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { Store } from "viewer/singletons";
import type {
  KeyboardComboChain,
  KeyboardShortcutLoopedHandlerMap,
  KeyboardShortcutNoLoopedHandlerMap,
  KeyboardShortcutsMap,
} from "./keyboard_shortcut_types";

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

export function keyToKeyEventName(raw: string): string {
  if (!raw) return raw;
  // unify common names
  switch (raw) {
    case " ":
    case "spacebar":
      return "space";
    case "esc":
      return "escape";
    case "left":
      return "arrowleft";
    case "right":
      return "arrowright";
    case "up":
      return "arrowup";
    case "down":
      return "arrowdown";
    case "meta":
      return "super";
    case "ctrl":
      return "control";
    default:
      return raw;
  }
}

function escapeReservedKeystrokeCharacters(key: string): string {
  if (["+", ">", ","].includes(key)) {
    return `\\${key}`;
  }
  return key;
}

export function formatKeyCombo(combo: string[]): string {
  // Ensure modifiers appear first in canonical order,
  // then non-modifier keys in the order they were pressed (preserved in `order`)
  const modifiersOrder = ["ctrl", "meta", "super", "alt", "shift"];
  const presentModifiers: string[] = [];
  const nonModifiers: string[] = [];
  const adjustKey = (key: string) => escapeReservedKeystrokeCharacters(keyToKeyEventName(key));

  const seen = new Set<string>();
  for (const k of combo) {
    const n = k.toLowerCase();
    if (MODIFIER_KEYS.has(n)) {
      seen.add(n);
    } else {
      if (!seen.has(n)) {
        // only add non-modifier if not a modifier (keeps uniqueness) and escape reserved characters.
        nonModifiers.push(adjustKey(n));
        seen.add(n);
      }
    }
  }

  for (const m of modifiersOrder) {
    if (seen.has(m)) presentModifiers.push(adjustKey(m));
  }

  // But order may have modifiers after non-modifiers in `order`. We already fixed ordering.
  // Combine modifiers then nonModifiers
  const parts = [...presentModifiers, ...nonModifiers];
  return parts.join(" + ");
}

export function formatKeyComboChain(comboChain: KeyboardComboChain): string {
  return comboChain.map((combo) => formatKeyCombo(combo)).join(", ");
}

export function formatComparableKeyComboChain(comboChain: ComparableKeyComboChain): string {
  return comboChain.map((combo) => formatKeyCombo([...combo])).join(", ");
}

export const buildKeyBindingsFromConfigAndMapping = (
  config: KeyboardShortcutsMap<string>,
  handlerIdMapping: KeyboardShortcutNoLoopedHandlerMap<string>,
): KeyBindingMap => {
  const mappedShortcuts = flatten(
    Object.entries(config).map(([handlerId, keyChainCombos]) => {
      const isInHandlerMapping = handlerId in handlerIdMapping;
      if (isInHandlerMapping) {
        return keyChainCombos.map((chainCombo) => {
          const keyComboStr = formatKeyComboChain(chainCombo);
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
  const mappedShortcuts = flatten(
    Object.entries(config).map(([handlerId, keyChainCombos]) => {
      const isInHandlerMapping = handlerId in handlerIdMapping;
      if (isInHandlerMapping) {
        return keyChainCombos.map((chainCombo) => {
          const keyComboStr = formatKeyComboChain(chainCombo);
          return [keyComboStr, handlerIdMapping[handlerId]];
        });
      } else {
        return undefined;
      }
    }),
  ).filter((mapping) => mapping != null);
  return Object.fromEntries(mappedShortcuts);
};

type ComparableKeyComboChain = Set<string>[];
function keyComboChainToSetArray(comboChain: KeyboardComboChain): ComparableKeyComboChain {
  return comboChain.map((keyCombo: string[]) => new Set<string>(keyCombo));
}

function areComboChainsEqual(
  chain1: ComparableKeyComboChain,
  chain2: ComparableKeyComboChain,
): boolean {
  if (chain1.length !== chain2.length) {
    return false;
  }
  for (let index = 0; index < chain1.length; ++index) {
    if (chain1[index].symmetricDifference(chain2[index]).size !== 0) {
      return false;
    }
  }
  return true;
}

export function invertKeyboardShortcutMap<T extends string>(
  config: KeyboardShortcutsMap<T>,
): [ComparableKeyComboChain, T[]][] {
  const result: [ComparableKeyComboChain, T[]][] = [];

  for (const handlerId in config) {
    for (const chain of config[handlerId]) {
      const comparableComboChain = keyComboChainToSetArray(chain);
      const existingEntry = result.find(([otherChain, _]) =>
        areComboChainsEqual(comparableComboChain, otherChain),
      );

      if (existingEntry) {
        existingEntry[1].push(handlerId);
      } else {
        result.push([comparableComboChain, [handlerId]]);
      }
    }
  }
  return result;
}

function buildToolDependentNoLoppedHandler(
  toolToHandlerMap: Partial<Record<AnnotationToolId, KeyboardNoLoopHandler>>,
): KeyboardNoLoopHandler {
  return {
    onPressed: (...args: Parameters<KeyboardHandlerFn>) => {
      const activeToolId = Store.getState().uiInformation.activeTool.id;
      toolToHandlerMap[activeToolId]?.onPressed(...args);
    },
    onReleased: (...args: Parameters<KeyboardHandlerFn>) => {
      const activeToolId = Store.getState().uiInformation.activeTool.id;
      toolToHandlerMap[activeToolId]?.onReleased?.(...args);
    },
  };
}

function buildToolDependentLoppedHandler(
  toolToHandlerMap: Partial<Record<AnnotationToolId, KeyboardLoopHandler>>,
): KeyboardLoopHandler {
  return {
    onPressedWithRepeat: (...args: Parameters<KeyboardLoopFn>) => {
      const activeToolId = Store.getState().uiInformation.activeTool.id;
      toolToHandlerMap[activeToolId]?.onPressedWithRepeat(...args);
    },
    onReleased: (...args: Parameters<KeyboardLoopFn>) => {
      const activeToolId = Store.getState().uiInformation.activeTool.id;
      toolToHandlerMap[activeToolId]?.onReleased?.(...args);
    },
  };
}

export const buildKeyBindingsFromConfigAndMappingForTools = (
  config: KeyboardShortcutsMap<string>,
  handlerIdMappingPerAnnotationTool: Record<
    AnnotationToolId,
    KeyboardShortcutNoLoopedHandlerMap<string>
  >,
): KeyBindingMap => {
  const keyComboChainAndHandlerIds = invertKeyboardShortcutMap(config);
  const bindings: KeyBindingMap = {};
  keyComboChainAndHandlerIds.forEach(([comparableComboChain, handlers]) => {
    const stringifiedComboChain = formatComparableKeyComboChain(comparableComboChain);
    const toolToHandlerMap: Partial<Record<AnnotationToolId, KeyboardNoLoopHandler>> = {};
    for (const handler of handlers) {
      for (const annotationToolIdStr of Object.keys(handlerIdMappingPerAnnotationTool)) {
        const annotationToolId = annotationToolIdStr as AnnotationToolId;
        if (handler in handlerIdMappingPerAnnotationTool[annotationToolId]) {
          toolToHandlerMap[annotationToolId] =
            handlerIdMappingPerAnnotationTool[annotationToolId][handler];
        }
      }
    }
    const hasAtLeastOneToolWithCurrentShortcut = Object.keys(toolToHandlerMap).length > 0;
    if (hasAtLeastOneToolWithCurrentShortcut) {
      bindings[stringifiedComboChain] = buildToolDependentNoLoppedHandler(toolToHandlerMap);
    }
  });
  return bindings;
};

export const buildKeyBindingsFromConfigAndLoopedMappingForTools = (
  config: KeyboardShortcutsMap<string>,
  handlerIdMappingPerAnnotationTool: Record<
    AnnotationToolId,
    KeyboardShortcutLoopedHandlerMap<string>
  >,
): KeyBindingLoopMap => {
  const keyComboChainAndHandlerIds = invertKeyboardShortcutMap(config);
  const bindings: KeyBindingLoopMap = {};
  keyComboChainAndHandlerIds.forEach(([comparableComboChain, handlers]) => {
    const stringifiedComboChain = formatComparableKeyComboChain(comparableComboChain);
    const toolToHandlerMap: Partial<Record<AnnotationToolId, KeyboardLoopHandler>> = {};
    for (const handler of handlers) {
      for (const annotationToolIdStr of Object.keys(handlerIdMappingPerAnnotationTool)) {
        const annotationToolId = annotationToolIdStr as AnnotationToolId;
        if (handler in handlerIdMappingPerAnnotationTool[annotationToolId]) {
          toolToHandlerMap[annotationToolId] =
            handlerIdMappingPerAnnotationTool[annotationToolId][handler];
        }
      }
    }
    const hasAtLeastOneToolWithCurrentShortcut = Object.keys(toolToHandlerMap).length > 0;
    if (hasAtLeastOneToolWithCurrentShortcut) {
      bindings[stringifiedComboChain] = buildToolDependentLoppedHandler(toolToHandlerMap);
    }
  });
  return bindings;
};
