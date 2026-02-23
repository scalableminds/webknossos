import {
  type KeyboardShortcutsMap,
  type KeyboardShortcutHandlerMetaInfoMap,
  KeyboardShortcutDomain,
  KeyboardShortcutCollisionDomain,
} from "../keyboard_shortcut_types";

export enum PlaneBoundingBoxNoLoopedKeyboardShortcuts {
  CREATE_BOUNDING_BOX = "CREATE_BOUNDING_BOX",
  TOGGLE_CURSOR_STATE_FOR_MOVING = "TOGGLE_CURSOR_STATE_FOR_MOVING",
  TOGGLE_CURSOR_STATE_FOR_RESIZING = "TOGGLE_CURSOR_STATE_FOR_RESIZING",
}

export const DEFAULT_PLANE_NO_LOOPED_BOUNDING_BOX_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneBoundingBoxNoLoopedKeyboardShortcuts> =
  {
    [PlaneBoundingBoxNoLoopedKeyboardShortcuts.CREATE_BOUNDING_BOX]: [[["c"]]],
    [PlaneBoundingBoxNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_MOVING]: [[["ctrl"]]],
    // TODOM: check whether this is correct / works correctly.
    [PlaneBoundingBoxNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_RESIZING]: [[["meta"]]],
  };

export const PlaneBoundingBoxNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneBoundingBoxNoLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneBoundingBoxNoLoopedKeyboardShortcuts, string> = {
      [PlaneBoundingBoxNoLoopedKeyboardShortcuts.CREATE_BOUNDING_BOX]: "Create new cell",
      [PlaneBoundingBoxNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_MOVING]:
        "Enable moving the hovered bounding box",
      [PlaneBoundingBoxNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_RESIZING]:
        "Enable resizing the hovered bounding box",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(([handlerId, description]) => [
        handlerId,
        {
          description,
          domain: KeyboardShortcutDomain.PLANE_BOUNDING_BOX_TOOL,
          looped: false,
          collisionDomains: [
            KeyboardShortcutCollisionDomain.PLANE_MODE,
            KeyboardShortcutCollisionDomain.PLANE_BOUNDING_BOX_TOOL,
          ],
        },
      ]),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneBoundingBoxNoLoopedKeyboardShortcuts>;
  })();
