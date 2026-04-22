import { MacCommandOutlined, WindowsOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import type {
  KeyboardLoopFn,
  KeyboardLoopHandler,
  KeyboardNoLoopHandler,
  KeyboardNoLoopHandlerFn,
} from "libs/input";
import { flatten, uniq } from "lodash-es";
import { isMac } from "viewer/constants";
import type { AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { Store } from "viewer/singletons";
import { KeyboardKeyIcon } from "../components/keyboard_key_icon";
import {
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
  KeyboardShortcutCollisionHierarchy,
} from "./keyboard_shortcut_constants";
import type {
  KeyboardComboChain,
  KeyboardShortcutCollisionEntityName,
  KeyboardShortcutHandlerMap,
  KeyboardShortcutsMap,
} from "./keyboard_shortcut_types";

const { Text } = Typography;
export const MODIFIER_KEYS = new Set(["Control", "Meta", "Alt", "Shift"]);

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
      return isMac ? <MacCommandOutlined /> : <WindowsOutlined />;
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
  const modifiersOrder = ["Control", "Meta", "Alt", "Shift"];
  const deduplicatedCombo = uniq(combo);
  const presentModifierSet = new Set(deduplicatedCombo).intersection(MODIFIER_KEYS);
  const nonModifiers = deduplicatedCombo.filter((key) => !MODIFIER_KEYS.has(key));
  const presentModifiers = modifiersOrder.filter((m) => presentModifierSet.has(m));

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

export function keyComboChainToUiElements(
  comboChain: KeyboardComboChain,
  // Renders a "fancier" version of the combo chain. Currently only used in the info tab.
  useHighlightedIcon: boolean,
  keyPrefix: string = "",
): React.ReactNode[] {
  const uiElements: React.ReactNode[] = [];
  comboChain.forEach((combo, outerIndex) => {
    sortKeyCombo(combo).forEach((key, innerIndex) => {
      if (useHighlightedIcon) {
        uiElements.push(
          <KeyboardKeyIcon
            key={`${keyPrefix}${outerIndex}-${innerIndex}`}
            className="keyboard-key-icon"
          >
            {keyToUiElement(key)}
          </KeyboardKeyIcon>,
        );
      } else {
        uiElements.push(
          <Text
            key={`${keyPrefix}${outerIndex}-${innerIndex}`}
            keyboard
            style={{ whiteSpace: "nowrap" }}
          >
            {keyToUiElement(key)}
          </Text>,
        );
      }
      if (innerIndex < combo.length - 1) {
        uiElements.push(<Text key={`${keyPrefix}${outerIndex}-sep${innerIndex}`}>+</Text>);
      }
    });
    if (outerIndex < comboChain.length - 1) {
      uiElements.push(<Text key={`${keyPrefix}${outerIndex}-chain`}>&gt;</Text>);
    }
  });
  return uiElements;
}

export const buildKeyBindingsFromConfig = (
  config: KeyboardShortcutsMap<string>,
  handlerIdMapping: KeyboardShortcutHandlerMap<string>,
): Record<string, KeyboardNoLoopHandler | KeyboardLoopHandler> => {
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

function keyComboChainToComparableKeyComboChain(
  comboChain: KeyboardComboChain,
): ComparableKeyComboChain {
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

export function keyboardShortcutMapToCollidingTuples<T extends string>(
  config: KeyboardShortcutsMap<T>,
): [ComparableKeyComboChain, T[]][] {
  const result: [ComparableKeyComboChain, T[]][] = [];

  for (const handlerId in config) {
    for (const chain of config[handlerId]) {
      const comparableComboChain = keyComboChainToComparableKeyComboChain(chain);
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

function buildToolDependentHandler(
  toolToHandlerMap: Partial<Record<AnnotationToolId, KeyboardNoLoopHandler | KeyboardLoopHandler>>,
): KeyboardNoLoopHandler | KeyboardLoopHandler {
  const handlers = Object.values(toolToHandlerMap).filter(Boolean) as (
    | KeyboardNoLoopHandler
    | KeyboardLoopHandler
  )[];
  const isLooped = handlers.some((h) => "onPressedWithRepeat" in h);
  const isDelayed = isLooped && (handlers as KeyboardLoopHandler[]).some((h) => h.delayed);

  if (isLooped) {
    const combined: KeyboardLoopHandler = {
      onPressedWithRepeat: (...args: Parameters<KeyboardLoopFn>) => {
        const activeToolId = Store.getState().uiInformation.activeTool.id;
        (toolToHandlerMap[activeToolId] as KeyboardLoopHandler | undefined)?.onPressedWithRepeat(
          ...args,
        );
      },
      onReleased: (...args: Parameters<KeyboardLoopFn>) => {
        const activeToolId = Store.getState().uiInformation.activeTool.id;
        (toolToHandlerMap[activeToolId] as KeyboardLoopHandler | undefined)?.onReleased?.(...args);
      },
    };
    if (isDelayed) combined.delayed = true;
    return combined;
  } else {
    return {
      onPressed: (...args: Parameters<KeyboardNoLoopHandlerFn>) => {
        const activeToolId = Store.getState().uiInformation.activeTool.id;
        (toolToHandlerMap[activeToolId] as KeyboardNoLoopHandler | undefined)?.onPressed(...args);
      },
      onReleased: (...args: Parameters<KeyboardNoLoopHandlerFn>) => {
        const activeToolId = Store.getState().uiInformation.activeTool.id;
        (toolToHandlerMap[activeToolId] as KeyboardNoLoopHandler | undefined)?.onReleased?.(
          ...args,
        );
      },
    };
  }
}

export const buildKeyBindingsFromConfigForTools = (
  config: KeyboardShortcutsMap<string>,
  handlerIdMappingPerAnnotationTool: Record<AnnotationToolId, KeyboardShortcutHandlerMap<string>>,
): Record<string, KeyboardNoLoopHandler | KeyboardLoopHandler> => {
  const toolOnlyShortcuts: KeyboardShortcutsMap<string> = {};
  for (const annotationToolIdStr of Object.keys(handlerIdMappingPerAnnotationTool)) {
    const annotationToolId = annotationToolIdStr as AnnotationToolId;
    for (const handlerId of Object.keys(handlerIdMappingPerAnnotationTool[annotationToolId])) {
      const handlerAlreadyAdded = handlerId in toolOnlyShortcuts;
      if (!handlerAlreadyAdded && handlerId in config) {
        toolOnlyShortcuts[handlerId] = config[handlerId];
      }
    }
  }

  const keyComboChainAndHandlerIds = keyboardShortcutMapToCollidingTuples(toolOnlyShortcuts);
  const bindings: Record<string, KeyboardNoLoopHandler | KeyboardLoopHandler> = {};
  keyComboChainAndHandlerIds.forEach(([comparableComboChain, handlers]) => {
    const stringifiedComboChain = comparableKeyComboChainToKeyCombo(comparableComboChain);
    const toolToHandlerMap: Partial<
      Record<AnnotationToolId, KeyboardNoLoopHandler | KeyboardLoopHandler>
    > = {};
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
      bindings[stringifiedComboChain] = buildToolDependentHandler(toolToHandlerMap);
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

// Returns all collision tuples (comboChain, handlerIds[]) for a given entity. Only handlers whose
// collision entity is an ancestor, descendant, or equal to `entity` are compared — i.e. shortcuts
// that can genuinely be active at the same time.
function getCollisionsForEntityInMap(
  entity: KeyboardShortcutCollisionEntityName,
  shortcutMap: KeyboardShortcutsMap<string>,
  parentMap: Record<string, string | null>,
): [ComparableKeyComboChain, string[]][] {
  const collidableEntities = getCollidableEntities(
    entity,
    KeyboardShortcutCollisionHierarchy,
    parentMap,
  );
  const relevantHandlerIds: string[] = [];
  for (const [handlerId, meta] of Object.entries(ALL_KEYBOARD_SHORTCUT_META_INFOS)) {
    if (collidableEntities.has(meta.collisionEntityName)) {
      relevantHandlerIds.push(handlerId);
    }
  }
  const relevantShortcuts: KeyboardShortcutsMap<string> = {};
  for (const id of relevantHandlerIds) {
    if (id in shortcutMap) {
      relevantShortcuts[id] = shortcutMap[id];
    }
  }
  return keyboardShortcutMapToCollidingTuples(relevantShortcuts);
}

const acceptedCollisions: Collision[] = [
  // This collision is accepted as the CYCLE_VIEWMODE handler disables itself in case the proofreading tool is active.
  // The shortcut collision was decided to be ok.
  {
    keyCombo: [new Set(["m"])],
    conflictingHandlerIds: ["CYCLE_VIEWMODE", "TOGGLE_MULTICUT_MODE"],
  },
];

function isAcceptedCollision(collision: Collision): boolean {
  return acceptedCollisions.some((accepted) => {
    if (!areComboChainsEqual(collision.keyCombo, accepted.keyCombo)) {
      return false;
    }
    const ids = new Set(collision.conflictingHandlerIds);
    const acceptedIds = new Set(accepted.conflictingHandlerIds);
    return ids.symmetricDifference(acceptedIds).size === 0;
  });
}

export function checkCollisionsInShortcutMap(
  shortcutMap: KeyboardShortcutsMap<string>,
): Collision[] {
  const parentMap = buildParentMap(KeyboardShortcutCollisionHierarchy);
  // Keyed by the canonical combo string so that handler IDs from different leaf
  // traversals that share the same shortcut are merged into one Collision entry.
  const collisionsByCombo = new Map<string, Collision>();

  // Only iterate leaf entities. Two sibling leaf nodes (e.g. ARBITRARY_MODE and PLANE_MODE) are
  // never simultaneously active, so they never appear together via a leaf traversal. This avoids
  // false-positive cross-domain collisions.
  const leafEntities = Object.entries(KeyboardShortcutCollisionHierarchy)
    .filter(([, children]) => children.length === 0)
    .map(([entity]) => entity as KeyboardShortcutCollisionEntityName);

  for (const entity of leafEntities) {
    const keyCombosToHandlerIds = getCollisionsForEntityInMap(entity, shortcutMap, parentMap);
    for (const [comboChain, handlerIds] of keyCombosToHandlerIds) {
      if (handlerIds.length > 1) {
        const comboKey = JSON.stringify(comboChain.map((set) => Array.from(set).sort()));
        const existing = collisionsByCombo.get(comboKey);
        if (existing) {
          for (const id of handlerIds) {
            if (!existing.conflictingHandlerIds.includes(id)) {
              existing.conflictingHandlerIds.push(id);
            }
          }
        } else {
          collisionsByCombo.set(comboKey, {
            keyCombo: comboChain,
            conflictingHandlerIds: [...handlerIds],
          });
        }
      }
    }
  }
  return [...collisionsByCombo.values()].filter((collision) => !isAcceptedCollision(collision));
}

export function checkCollisionForShortcut(
  handlerIdOfShortcut: string,
  newKeyCombos: KeyboardComboChain[],
  existingShortcutMap: KeyboardShortcutsMap<string>,
): Collision[] {
  const metaInfoOfShortcut = ALL_KEYBOARD_SHORTCUT_META_INFOS[handlerIdOfShortcut];
  if (!metaInfoOfShortcut) return [];
  const parentMap = buildParentMap(KeyboardShortcutCollisionHierarchy);

  // Replace the handler's existing shortcuts with the new combos being validated.
  const tempMap: KeyboardShortcutsMap<string> = { ...existingShortcutMap };
  tempMap[handlerIdOfShortcut] = newKeyCombos;

  const keyCombosToHandlerIds = getCollisionsForEntityInMap(
    metaInfoOfShortcut.collisionEntityName,
    tempMap,
    parentMap,
  );
  const collisions: Collision[] = [];
  for (const [comboChain, handlerIds] of keyCombosToHandlerIds) {
    if (handlerIds.includes(handlerIdOfShortcut) && handlerIds.length > 1) {
      const fullCollision: Collision = { keyCombo: comboChain, conflictingHandlerIds: handlerIds };
      if (!isAcceptedCollision(fullCollision)) {
        collisions.push({
          keyCombo: comboChain,
          conflictingHandlerIds: handlerIds.filter((id) => id !== handlerIdOfShortcut),
        });
      }
    }
  }
  return collisions;
}
