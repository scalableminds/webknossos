import {
  KeyboardShortcutCollisionDomain,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum OrthoBoundingBoxNoLoopedKeyboardShortcuts {
  CREATE_BOUNDING_BOX = "CREATE_BOUNDING_BOX",
  TOGGLE_CURSOR_STATE_FOR_MOVING = "TOGGLE_CURSOR_STATE_FOR_MOVING",
  TOGGLE_CURSOR_STATE_FOR_RESIZING = "TOGGLE_CURSOR_STATE_FOR_RESIZING",
}

export const DEFAULT_ORTHO_BOUNDING_BOX_NO_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<OrthoBoundingBoxNoLoopedKeyboardShortcuts> =
  {
    [OrthoBoundingBoxNoLoopedKeyboardShortcuts.CREATE_BOUNDING_BOX]: [[["c"]]],
    [OrthoBoundingBoxNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_MOVING]: [[["ctrl"]]],
    // TODOM: check whether this is correct / works correctly.
    [OrthoBoundingBoxNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_RESIZING]: [[["meta"]]],
  };

export const OrthoBoundingBoxNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<OrthoBoundingBoxNoLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<OrthoBoundingBoxNoLoopedKeyboardShortcuts, string> = {
      [OrthoBoundingBoxNoLoopedKeyboardShortcuts.CREATE_BOUNDING_BOX]: "Create new cell",
      [OrthoBoundingBoxNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_MOVING]:
        "Enable moving the hovered bounding box",
      [OrthoBoundingBoxNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_RESIZING]:
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
    ) as KeyboardShortcutHandlerMetaInfoMap<OrthoBoundingBoxNoLoopedKeyboardShortcuts>;
  })();
