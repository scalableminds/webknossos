import { MacCommandOutlined, WindowsOutlined } from "@ant-design/icons";
import { Typography } from "antd";
import type {
  KeyboardHandler,
  KeyboardLoopHandler,
  KeyboardLoopHandlerFn,
  KeyboardNoLoopHandler,
  KeyboardNoLoopHandlerFn,
  KeystrokesKeyComboStr,
} from "libs/input";
import { flatten, uniq } from "lodash-es";
import { isMac } from "viewer/constants";
import type { AnnotationToolId } from "viewer/model/accessors/tool_accessor";
import { Store } from "viewer/singletons";
import { KeyboardKeyIcon } from "../components/keyboard_key_icon";
import {
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
  type KeyboardShortcutId,
} from "./keyboard_shortcut_constants";
import {
  getAllCollidingDomainsOf,
  type KeyboardShortcutCollisionDomain,
  type KeyboardShortcutHandlerMap,
  type KeyboardShortcutsMap,
  type KeyCombination,
  type KeySequence,
  LeafCollisionDomains,
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
function sortKeyCombination(keyCombination: KeyCombination): KeyCombination {
  // Ensure modifiers appear first in canonical order,
  // then non-modifier keys in the order they were pressed (preserved in `order`)
  const modifiersOrder = ["Control", "Meta", "Alt", "Shift"];
  const deduplicatedCombo = uniq(keyCombination);
  const presentModifierSet = new Set(deduplicatedCombo).intersection(MODIFIER_KEYS);
  const nonModifiers = deduplicatedCombo.filter((key) => !MODIFIER_KEYS.has(key));
  const presentModifiers = modifiersOrder.filter((m) => presentModifierSet.has(m));

  // But order may have modifiers after non-modifiers in `order`. We already fixed ordering.
  // Combine modifiers then nonModifiers
  return [...presentModifiers, ...nonModifiers];
}

export function formatKeyCombination(keyCombination: KeyCombination): KeystrokesKeyComboStr {
  // Ensure modifiers appear first in canonical order,
  // then non-modifier keys in the order they were pressed (preserved in `order`)
  return sortKeyCombination(keyCombination)
    .map((key) => escapeReservedKeystrokeCharacters(key))
    .join(" + ");
}

export function keySequenceToKeystrokesComboStr(keySeq: KeySequence): KeystrokesKeyComboStr {
  return keySeq.map((keyCombination) => formatKeyCombination(keyCombination)).join(", ");
}

export function comparableKeySequenceToKeystrokesComboStr(
  keySeq: ComparableKeySequence,
): KeystrokesKeyComboStr {
  return keySeq.map((keyCombination) => formatKeyCombination([...keyCombination])).join(", ");
}

export function keySequenceToUiElements(
  keySequence: KeySequence,
  // Renders a "fancier" version of the combo chain. Currently only used in the info tab.
  useHighlightedIcon: boolean,
  keyPrefix: string = "",
): React.ReactNode[] {
  const uiElements: React.ReactNode[] = [];
  keySequence.forEach((keyCombination, outerIndex) => {
    sortKeyCombination(keyCombination).forEach((key, innerIndex) => {
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
      if (innerIndex < keyCombination.length - 1) {
        uiElements.push(<Text key={`${keyPrefix}${outerIndex}-sep${innerIndex}`}>+</Text>);
      }
    });
    if (outerIndex < keySequence.length - 1) {
      uiElements.push(<Text key={`${keyPrefix}${outerIndex}-chain`}>&gt;</Text>);
    }
  });
  return uiElements;
}

// Builds a InputKeyboard compatible config object for shortcuts given
// my the keyboardHandlerMap with the configured shortcut in shortcutConfig.
export const buildKeyBindingsFromConfig = (
  shortcutConfig: KeyboardShortcutsMap,
  keyboardHandlerMap: Partial<KeyboardShortcutHandlerMap>,
): Record<string, KeyboardHandler> => {
  const mappedShortcuts = flatten(
    Object.entries(shortcutConfig).map(([shortcutId, keySeqAlternatives]) => {
      const isInHandlerMapping = shortcutId in keyboardHandlerMap;
      if (isInHandlerMapping) {
        return keySeqAlternatives.map((chainCombo) => {
          const keystrokesComboStr = keySequenceToKeystrokesComboStr(chainCombo);
          return [keystrokesComboStr, keyboardHandlerMap[shortcutId as KeyboardShortcutId]];
        });
      } else {
        return undefined;
      }
    }),
  ).filter((mapping) => mapping != null);
  return Object.fromEntries(mappedShortcuts);
};

export function keySequenceToComparableKeySequence(keySeq: KeySequence): ComparableKeySequence {
  return keySeq.map((keyCombination: string[]) => new Set<string>(keyCombination));
}

export function areComparableSequencesEqual(
  comparableKeySeq1: ComparableKeySequence,
  comparableKeySeq2: ComparableKeySequence,
): boolean {
  if (comparableKeySeq1.length !== comparableKeySeq2.length) {
    return false;
  }
  for (let index = 0; index < comparableKeySeq1.length; ++index) {
    if (comparableKeySeq1[index].symmetricDifference(comparableKeySeq2[index]).size !== 0) {
      return false;
    }
  }
  return true;
}

// Folds a KeyboardShortcutsMap into a Map from comparable key sequence to all shortcut IDs
// configured to activate on that sequence. An entry with more than one ID is a collision,
// though collision domains are not considered here — that is left to the caller.
export function keyboardShortcutMapToCollidingTuples(
  config: Partial<KeyboardShortcutsMap>,
): Map<ComparableKeySequence, KeyboardShortcutId[]> {
  // Build as a tuple list first: Map uses reference equality for object keys, so we can't
  // use map.get/has to merge entries — we need structural equality via areComparableSequencesEqual.
  // A simple find of a list of tuples makes suits this perfectly.
  const tuples: [ComparableKeySequence, KeyboardShortcutId[]][] = [];

  for (const shortcutIdStr in config) {
    const shortcutId = shortcutIdStr as KeyboardShortcutId;
    for (const keySeq of config[shortcutId]!) {
      const comparableKeySeq = keySequenceToComparableKeySequence(keySeq);
      const existingEntry = tuples.find(([otherChain]) =>
        areComparableSequencesEqual(comparableKeySeq, otherChain),
      );

      if (existingEntry) {
        existingEntry[1].push(shortcutId);
      } else {
        tuples.push([comparableKeySeq, [shortcutId]]);
      }
    }
  }
  return new Map(tuples);
}

// Builds a special keyboard handler activating the shortcut of the currently active tool,
// even when the shortcut is used by multiple tools and thus overloaded.
function buildToolDependentHandler(
  toolToHandlerMap: Partial<Record<AnnotationToolId, KeyboardHandler>>,
): KeyboardHandler {
  const handlers = Object.values(toolToHandlerMap).filter(Boolean) as KeyboardHandler[];
  const isLooped = handlers.some((h) => "onPressedWithRepeat" in h);
  const isDelayed = isLooped && (handlers as KeyboardLoopHandler[]).some((h) => h.delayed);

  if (isLooped) {
    const areAllHandlersLooped = handlers.every((h) => "onPressedWithRepeat" in h);
    if (!areAllHandlersLooped) {
      console.warn("Found overloaded tools shortcut where on handler is looped and the other not");
    }
    const combined: KeyboardLoopHandler = {
      onPressedWithRepeat: (...args: Parameters<KeyboardLoopHandlerFn>) => {
        const activeToolId = Store.getState().uiInformation.activeTool.id;
        const isOriginalEvent = args[1];
        const handler = toolToHandlerMap[activeToolId] as KeyboardHandler | undefined;
        if (!handler) {
          return;
        }
        // Guard against user overloading tool shortcuts where one might be looped and the other not.
        if ("onPressedWithRepeat" in handler) {
          handler.onPressedWithRepeat(...args);
        } else if ("onPressed" in handler && isOriginalEvent) {
          const pressEvent = args[2];
          handler.onPressed(pressEvent);
        }
      },
      onReleased: (...args: Parameters<KeyboardLoopHandlerFn>) => {
        const activeToolId = Store.getState().uiInformation.activeTool.id;
        const handler = toolToHandlerMap[activeToolId] as KeyboardHandler | undefined;
        if (!handler) {
          return;
        }
        if ("onPressedWithRepeat" in handler) {
          handler.onReleased?.(...args);
        } else if ("onReleased" in handler) {
          // One-shot handler expects only the event parameter
          const releaseEvent = args[2];
          handler.onReleased?.(releaseEvent);
        }
      },
    };
    if (isDelayed) {
      combined.delayed = true;
    }
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

// Returns a config compatible with InputKeyboard containing all tool specific shortcuts.
// The shortcut of a tool is only activated if it is active.
export const buildKeyBindingsFromConfigForTools = (
  config: KeyboardShortcutsMap,
  handlerIdMappingPerAnnotationTool: Record<AnnotationToolId, Partial<KeyboardShortcutHandlerMap>>,
): Record<string, KeyboardHandler> => {
  // Narrow the config to only the shortcuts referenced by at least one tool.
  const toolOnlyShortcuts: Partial<KeyboardShortcutsMap> = {};
  for (const annotationToolIdStr of Object.keys(handlerIdMappingPerAnnotationTool)) {
    const annotationToolId = annotationToolIdStr as AnnotationToolId;
    for (const shortcutIdStr of Object.keys(handlerIdMappingPerAnnotationTool[annotationToolId])) {
      const shortcutId = shortcutIdStr as KeyboardShortcutId;
      const handlerAlreadyAdded = shortcutId in toolOnlyShortcuts;
      if (!handlerAlreadyAdded && shortcutId in config) {
        toolOnlyShortcuts[shortcutId] = config[shortcutId];
      }
    }
  }

  // Group shortcut IDs by their configured key sequence, then build one tool-dependent
  // handler per sequence that dispatches to whichever tool is currently active.
  // Attach this handler to the binding returned at the end.
  const keySequenceAndShortcutIdsTuples = keyboardShortcutMapToCollidingTuples(toolOnlyShortcuts);
  const bindings: Record<KeystrokesKeyComboStr, KeyboardHandler> = {};
  for (const [comparableKeySeq, shortcutIds] of keySequenceAndShortcutIdsTuples) {
    const keystrokesComboStr = comparableKeySequenceToKeystrokesComboStr(comparableKeySeq);
    const toolToHandlerMap: Partial<Record<AnnotationToolId, KeyboardHandler>> = {};
    for (const shortcutId of shortcutIds) {
      for (const annotationToolIdStr of Object.keys(handlerIdMappingPerAnnotationTool)) {
        const annotationToolId = annotationToolIdStr as AnnotationToolId;
        if (shortcutId in handlerIdMappingPerAnnotationTool[annotationToolId]) {
          toolToHandlerMap[annotationToolId] =
            handlerIdMappingPerAnnotationTool[annotationToolId][shortcutId];
        }
      }
    }
    const hasAtLeastOneToolWithCurrentShortcut = Object.keys(toolToHandlerMap).length > 0;
    if (hasAtLeastOneToolWithCurrentShortcut) {
      bindings[keystrokesComboStr] = buildToolDependentHandler(toolToHandlerMap);
    }
  }
  return bindings;
};

type ComparableKeySequence = Set<string>[];

export type Collision = {
  keySequence: ComparableKeySequence;
  conflictingShortcutIds: KeyboardShortcutId[];
};

// Returns all collision tuples (ComparableKeySequence, KeyboardShortcutId[]) for a given collision domain.
// Only relevant collision domains are compared — i.e. shortcuts that can genuinely be active at the same time.
// This perspective is taken from the given collisionDomain.
// Collision is represented by on entry in the returned array having multiple shortcutIds.
function createKeySequenceToShortcutIdsTuplesForCollisionDomain(
  collisionDomain: KeyboardShortcutCollisionDomain,
  shortcutMap: KeyboardShortcutsMap,
): Map<ComparableKeySequence, KeyboardShortcutId[]> {
  const collisionDomains = getAllCollidingDomainsOf(collisionDomain);
  const relevantShortcuts: Partial<KeyboardShortcutsMap> = {};
  for (const [shortcutIdStr, meta] of Object.entries(ALL_KEYBOARD_SHORTCUT_META_INFOS)) {
    const shortcutId = shortcutIdStr as KeyboardShortcutId;
    if (collisionDomains.has(meta.getCollisionDomain()) && shortcutId in shortcutMap) {
      relevantShortcuts[shortcutId] = shortcutMap[shortcutId];
    }
  }
  return keyboardShortcutMapToCollidingTuples(relevantShortcuts);
}

const acceptedCollisions: Collision[] = [
  // This collision is accepted as the CYCLE_VIEWMODE handler disables itself in case the proofreading tool is active.
  // The shortcut collision was decided to be ok.
  {
    keySequence: [new Set(["m"])],
    conflictingShortcutIds: ["CYCLE_VIEWMODE", "TOGGLE_MULTICUT_MODE"],
  },
];

function isAcceptedCollision(collision: Collision): boolean {
  return acceptedCollisions.some((accepted) => {
    if (!areComparableSequencesEqual(collision.keySequence, accepted.keySequence)) {
      return false;
    }
    const ids = new Set(collision.conflictingShortcutIds);
    const acceptedIds = new Set(accepted.conflictingShortcutIds);
    return ids.symmetricDifference(acceptedIds).size === 0;
  });
}

// Takes a full KeyboardShortcutsMap and checks for shortcut collisions across all collision domains.
export function checkCollisionsInShortcutMap(shortcutMap: KeyboardShortcutsMap): Collision[] {
  // Keyed by the key sequence as a string so that shortcutIds from different leaf
  // traversals that share the same shortcut are merged into one Collision entry.
  const collisionsByKeySeq = new Map<string, Collision>();

  // Only iterate leaf entities. They will automatically compare themselves with the parent non leaf nodes.
  // Doing the comparison only bottom up in the hierarchy avoid double detecting a collision
  // when when also doing a top down traversal.
  for (const collisionDomain of LeafCollisionDomains) {
    const keySeqAndShortcutIdsTuples = createKeySequenceToShortcutIdsTuplesForCollisionDomain(
      collisionDomain,
      shortcutMap,
    );
    for (const [comparableKeySeq, shortcutIds] of keySeqAndShortcutIdsTuples) {
      // Checking for a collision:
      const uniqueShortcutIds = uniq(shortcutIds);
      const doMultipleShortcutsMapToTheSameKeySeq = uniqueShortcutIds.length > 1;
      if (doMultipleShortcutsMapToTheSameKeySeq) {
        // Found a collision
        const keySeqStringified = JSON.stringify(
          comparableKeySeq.map((set) => Array.from(set).sort()),
        );
        const existing = collisionsByKeySeq.get(keySeqStringified);
        if (existing) {
          for (const id of uniqueShortcutIds) {
            if (!existing.conflictingShortcutIds.includes(id)) {
              existing.conflictingShortcutIds.push(id);
            }
          }
        } else {
          collisionsByKeySeq.set(keySeqStringified, {
            keySequence: comparableKeySeq,
            conflictingShortcutIds: [...uniqueShortcutIds],
          });
        }
      }
    }
  }
  // Filtering out the accepted collision.
  return [...collisionsByKeySeq.values()].filter((collision) => !isAcceptedCollision(collision));
}

// Checks where a single shortcut given via Id and its newly configured key sequences
// collides with an existing shortcut taking collision domains into account.
export function checkCollisionForShortcut(
  keyboardShortcutId: KeyboardShortcutId,
  newKeySequences: KeySequence[],
  existingShortcutMap: KeyboardShortcutsMap,
): Collision[] {
  const metaInfoOfShortcut = ALL_KEYBOARD_SHORTCUT_META_INFOS[keyboardShortcutId];
  if (!metaInfoOfShortcut) {
    return [];
  }

  // Replace the shortcut's existing key sequences alternatives with the key sequences alternatives being validated.
  const tempMap: KeyboardShortcutsMap = { ...existingShortcutMap };
  tempMap[keyboardShortcutId] = newKeySequences;

  const keySeqAndShortcutIdsTuples = createKeySequenceToShortcutIdsTuplesForCollisionDomain(
    metaInfoOfShortcut.getCollisionDomain(),
    tempMap,
  );
  const collisions: Collision[] = [];
  for (const [comparableKeySeq, shortcutIds] of keySeqAndShortcutIdsTuples) {
    const uniqueShortcutIds = uniq(shortcutIds);
    if (shortcutIds.includes(keyboardShortcutId) && uniqueShortcutIds.length > 1) {
      const fullCollision: Collision = {
        keySequence: comparableKeySeq,
        conflictingShortcutIds: uniqueShortcutIds,
      };
      if (!isAcceptedCollision(fullCollision)) {
        collisions.push({
          keySequence: comparableKeySeq,
          conflictingShortcutIds: shortcutIds.filter((id) => id !== keyboardShortcutId),
        });
      }
    }
  }
  return collisions;
}
