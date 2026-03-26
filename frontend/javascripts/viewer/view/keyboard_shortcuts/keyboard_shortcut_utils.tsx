import { MacCommandOutlined, WindowsOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import type {
  KeyBindingLoopMap,
  KeyBindingMap,
  KeyboardHandlerFn,
  KeyboardLoopFn,
  KeyboardLoopHandler,
  KeyboardNoLoopHandler,
} from "libs/input";
import { flatten } from "lodash-es";
import type React from "react";
import type { AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { Store } from "viewer/singletons";
import type {
  KeyboardComboChain,
  KeyboardShortcutLoopedHandlerMap,
  KeyboardShortcutNoLoopedHandlerMap,
  KeyboardShortcutsMap,
} from "./keyboard_shortcut_types";

const { Text } = Typography;
export const MODIFIER_KEYS = new Set(["Control", "Meta", "Meta", "Alt", "Shift"]);

// TODOM Refactor to not converte between keyevent name and back too often!

export function keyToUiElement(key: string): React.ReactNode {
  switch (key) {
    case " ":
      return "Space";
    case "esc":
    case "escape":
      return "Esc";
    case "ArrowLeft":
      return "◀";
    case "ArrowRight":
      return "▶";
    case "ArrowUp":
      return "▲";
    case "ArrowDown":
      return "▼";
    case "Meta":
      return (
        <>
          <MacCommandOutlined />/<WindowsOutlined />
        </>
      );
    case "Control":
      return "Ctrl";

    default:
      return key;
  }
}

function escapeReservedKeystrokeCharacters(key: string): string {
  if (["+", ">", ","].includes(key)) {
    return `\\${key}`;
  }
  return key;
}

// Moves modifier keys to the front of the combo.
function sortKeyCombo(combo: string[]): string[] {
  // Ensure modifiers appear first in canonical order,
  // then non-modifier keys in the order they were pressed (preserved in `order`)
  const modifiersOrder = ["Control", "Meta", "Meta", "Alt", "Shift"];
  const presentModifiers: string[] = [];
  const nonModifiers: string[] = [];

  const seen = new Set<string>();
  for (const k of combo) {
    const n = k.toLowerCase();
    if (MODIFIER_KEYS.has(n)) {
      seen.add(n);
    } else {
      if (!seen.has(n)) {
        // only add non-modifier if not a modifier (keeps uniqueness).
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
  return [...presentModifiers, ...nonModifiers];
}

export function formatKeyCombo(combo: string[]): string {
  // Ensure modifiers appear first in canonical order,
  // then non-modifier keys in the order they were pressed (preserved in `order`)
  return sortKeyCombo(combo)
    .map((key) => escapeReservedKeystrokeCharacters(key))
    .join(" + ");
}

export function keyComboChainToKeystrokesConfig(comboChain: KeyboardComboChain): string {
  return comboChain.map((combo) => formatKeyCombo(combo)).join(", ");
}

export function comparableKeyComboChainToKeyCombo(comboChain: ComparableKeyComboChain): string {
  return comboChain.map((combo) => formatKeyCombo([...combo])).join(", ");
}

export function keyComboChainToUiElements(comboChain: KeyboardComboChain): React.ReactNode[] {
  const uiElements: React.ReactNode[] = [];

  comboChain.forEach((combo, outerIndex) => {
    sortKeyCombo(combo).forEach((key, innerIndex) => {
      uiElements.push(
        <Text key={uiElements.length} keyboard style={{ whiteSpace: "nowrap" }}>
          {keyToUiElement(key)}
        </Text>,
      );
      if (innerIndex < combo.length - 1) {
        uiElements.push(<Text key={uiElements.length}>+</Text>);
      }
    });
    if (outerIndex < comboChain.length - 1) {
      uiElements.push(<Text key={uiElements.length}>&gt;</Text>);
    }
  });
  return uiElements;
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
          const keyComboStr = keyComboChainToKeystrokesConfig(chainCombo);
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
          const keyComboStr = keyComboChainToKeystrokesConfig(chainCombo);
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
    const stringifiedComboChain = comparableKeyComboChainToKeyCombo(comparableComboChain);
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
    const stringifiedComboChain = comparableKeyComboChainToKeyCombo(comparableComboChain);
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
