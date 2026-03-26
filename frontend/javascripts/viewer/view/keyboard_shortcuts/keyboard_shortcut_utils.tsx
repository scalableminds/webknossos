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
import type { AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { Store } from "viewer/singletons";
import type {
  KeyboardComboChain,
  KeyboardShortcutLoopedHandlerMap,
  KeyboardShortcutNoLoopedHandlerMap,
  KeyboardShortcutsMap,
} from "./keyboard_shortcut_types";
import {
  KeyboardShortcutCollisionHierarchy,
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
} from "./keyboard_shortcut_constants";

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
  for (const key of combo) {
    if (MODIFIER_KEYS.has(key)) {
      seen.add(key);
    } else {
      if (!seen.has(key)) {
        // only add non-modifier if not a modifier (keeps uniqueness).
        nonModifiers.push(key);
        seen.add(key);
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

function keyComboChainToSetArray(comboChain: KeyboardComboChain): ComparableKeyComboChain {
  return comboChain.map((keyCombo: string[]) => new Set<string>(keyCombo));
}

function areComboChainsEqual(
  comparableComboChain1: ComparableKeyComboChain,
  comparableComboChain2: ComparableKeyComboChain,
): boolean {
  if (comparableComboChain1.length !== comparableComboChain2.length) {
    return false;
  }
  for (let index = 0; index < comparableComboChain1.length; ++index) {
    if (comparableComboChain1[index].symmetricDifference(comparableComboChain2[index]).size !== 0) {
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

type ComparableKeyComboChain = Set<string>[];

export type Collision = {
  keyCombo: ComparableKeyComboChain;
  conflictingHandlerIds: string[];
};

function buildParentMap(hierarchy: Record<string, string[]>): Record<string, string | null> {
  const parentMap: Record<string, string | null> = {};
  for (const [parent, children] of Object.entries(hierarchy)) {
    for (const child of children) {
      parentMap[child] = parent;
    }
    if (!(parent in parentMap)) parentMap[parent] = null;
  }
  return parentMap;
}

function getCollidableEntities(
  entity: string,
  hierarchy: Record<string, string[]>,
  parentMap: Record<string, string | null>,
): Set<string> {
  const collidable = new Set<string>();
  // Add itself
  collidable.add(entity);
  // Add all ancestors (parents, grandparents, etc.)
  let currentParent = parentMap[entity];
  while (currentParent) {
    collidable.add(currentParent);
    currentParent = parentMap[currentParent];
  }
  // Add all descendants
  function addDescendants(ent: string) {
    const children = hierarchy[ent] || [];
    for (const child of children) {
      collidable.add(child);
      addDescendants(child);
    }
  }
  addDescendants(entity);
  return collidable;
}

export function checkCollisionsInShortcutMap(
  shortcutMap: KeyboardShortcutsMap<string>,
): Collision[] {
  const parentMap = buildParentMap(KeyboardShortcutCollisionHierarchy);
  const allCollisions: Collision[] = [];
  const uniqueCollisions = new Set<string>();

  // For each entity, check collisions within its collidable set
  // TODO: only compare top down -> do not include comparing with parent collision entities.
  for (const entity of Object.keys(KeyboardShortcutCollisionHierarchy)) {
    const collidableEntities = getCollidableEntities(
      entity,
      KeyboardShortcutCollisionHierarchy,
      parentMap,
    );
    // Collect handler ids with collisionEntityName in collidableEntities
    const relevantHandlerIds: string[] = [];
    for (const [handlerId, meta] of Object.entries(ALL_KEYBOARD_SHORTCUT_META_INFOS)) {
      if (collidableEntities.has(meta.collisionEntityName)) {
        relevantHandlerIds.push(handlerId);
      }
    }
    // Get the shortcuts for these handlers
    const relevantShortcuts: KeyboardShortcutsMap<string> = {};
    for (const id of relevantHandlerIds) {
      if (id in shortcutMap) {
        relevantShortcuts[id] = shortcutMap[id];
      }
    }
    // Invert to find duplicates
    const inverted = invertKeyboardShortcutMap(relevantShortcuts);
    for (const [comboChain, handlerIds] of inverted) {
      if (handlerIds.length > 1) {
        const collision: Collision = {
          keyCombo: comboChain,
          conflictingHandlerIds: handlerIds,
        };
        const key = JSON.stringify([
          Array.from(comboChain.map((set) => Array.from(set).sort())),
          handlerIds.sort(),
        ]);
        if (!uniqueCollisions.has(key)) {
          uniqueCollisions.add(key);
          allCollisions.push(collision);
        }
      }
    }
  }
  return allCollisions;
}

export function checkCollisionForShortcut(
  handlerIdOfShortcut: string,
  newKeyCombos: KeyboardComboChain[],
  existingShortcutMap: KeyboardShortcutsMap<string>,
): Collision[] {
  const metaInfoOfShortcut = ALL_KEYBOARD_SHORTCUT_META_INFOS[handlerIdOfShortcut];
  if (!metaInfoOfShortcut) return [];
  const collisionEntityNameOfShortcut = metaInfoOfShortcut.collisionEntityName;
  const parentMap = buildParentMap(KeyboardShortcutCollisionHierarchy);
  const collidableEntities = getCollidableEntities(
    collisionEntityNameOfShortcut,
    KeyboardShortcutCollisionHierarchy,
    parentMap,
  );
  // Collect other handler ids
  // TODOM: include own shortcuts but before remove potentially currently edited short.
  const otherHandlerIds: string[] = [];
  for (const [id, metaInfo] of Object.entries(ALL_KEYBOARD_SHORTCUT_META_INFOS)) {
    if (id !== handlerIdOfShortcut && collidableEntities.has(metaInfo.collisionEntityName)) {
      otherHandlerIds.push(id);
    }
  }
  // Create temp map with new combos
  const tempMap: KeyboardShortcutsMap<string> = { ...existingShortcutMap };
  tempMap[handlerIdOfShortcut] = newKeyCombos;
  // Get relevant shortcuts
  const relevantShortcuts: KeyboardShortcutsMap<string> = {};
  for (const id of [...otherHandlerIds, handlerIdOfShortcut]) {
    if (id in tempMap) {
      relevantShortcuts[id] = tempMap[id];
    }
  }
  // Invert and find collisions involving handlerId
  const inverted = invertKeyboardShortcutMap(relevantShortcuts);
  const collisions: Collision[] = [];
  for (const [comboChain, handlerIds] of inverted) {
    if (handlerIds.includes(handlerIdOfShortcut) && handlerIds.length > 1) {
      collisions.push({
        keyCombo: comboChain,
        conflictingHandlerIds: handlerIds.filter((id) => id !== handlerIdOfShortcut),
      });
    }
  }
  return collisions;
}
