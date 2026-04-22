import {
  KeyboardShortcutCollisionEntityName,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum PlaneProofreadingToolNoLoopedKeyboardShortcuts {
  TOGGLE_MULTICUT_MODE = "TOGGLE_MULTICUT_MODE",
}

export const DEFAULT_PLANE_PROOFREADING_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneProofreadingToolNoLoopedKeyboardShortcuts> =
  {
    [PlaneProofreadingToolNoLoopedKeyboardShortcuts.TOGGLE_MULTICUT_MODE]: [[["m"]]],
  };

export const PlaneProofreadingToolNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneProofreadingToolNoLoopedKeyboardShortcuts> =
  {
    [PlaneProofreadingToolNoLoopedKeyboardShortcuts.TOGGLE_MULTICUT_MODE]: {
      description: "Toggle multi cut mode",
      domain: KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL,
      collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_PROOFREADING_TOOL,
    },
  };
