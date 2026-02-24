import {
  KeyboardShortcutCollisionDomain,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum OrthoProofreadingNoLoopedKeyboardShortcuts {
  TOGGLE_MULTICUT_MODE = "TOGGLE_MULTICUT_MODE",
}

export const DEFAULT_ORTHO_PROOFREADING_NO_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<OrthoProofreadingNoLoopedKeyboardShortcuts> =
  {
    [OrthoProofreadingNoLoopedKeyboardShortcuts.TOGGLE_MULTICUT_MODE]: [[["m"]]],
  };

export const OrthoProofreadingNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<OrthoProofreadingNoLoopedKeyboardShortcuts> =
  {
    [OrthoProofreadingNoLoopedKeyboardShortcuts.TOGGLE_MULTICUT_MODE]: {
      description: "Toggle multi cut mode",
      domain: KeyboardShortcutDomain.PLANE_PROOFREADING_TOOL,
      looped: false,
      collisionDomains: [
        KeyboardShortcutCollisionDomain.PLANE_MODE,
        KeyboardShortcutCollisionDomain.PLANE_PROOFREADING_TOOL,
      ],
    },
  };
