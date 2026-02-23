import {
  KeyboardShortcutCollisionDomain,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum PlaneProofreadingNoLoopedKeyboardShortcuts {
  TOGGLE_MULTICUT_MODE = "TOGGLE_MULTICUT_MODE",
}

export const DEFAULT_PLANE_NO_LOOPED_PROOFREADING_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneProofreadingNoLoopedKeyboardShortcuts> =
  {
    [PlaneProofreadingNoLoopedKeyboardShortcuts.TOGGLE_MULTICUT_MODE]: [[["m"]]],
  };

export const PlaneProofreadingNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneProofreadingNoLoopedKeyboardShortcuts> =
  {
    [PlaneProofreadingNoLoopedKeyboardShortcuts.TOGGLE_MULTICUT_MODE]: {
      description: "Toggle multi cut mode",
      domain: KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL,
      looped: false,
      collisionDomains: [
        KeyboardShortcutCollisionDomain.PLANE_MODE,
        KeyboardShortcutCollisionDomain.PLANE_PROOFREADING_TOOL,
      ],
    },
  };
