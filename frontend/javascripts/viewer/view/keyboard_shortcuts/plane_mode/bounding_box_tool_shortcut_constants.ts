import {
  KeyboardShortcutCollisionEntityName,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutMetaInfo,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum PlaneBoundingBoxToolNoLoopedKeyboardShortcuts {
  CREATE_BOUNDING_BOX = "CREATE_BOUNDING_BOX",
  TOGGLE_CURSOR_STATE_FOR_MOVING = "TOGGLE_CURSOR_STATE_FOR_MOVING",
}

export const DEFAULT_PLANE_BOUNDING_BOX_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneBoundingBoxToolNoLoopedKeyboardShortcuts> =
  {
    [PlaneBoundingBoxToolNoLoopedKeyboardShortcuts.CREATE_BOUNDING_BOX]: [[["c"]]],
    [PlaneBoundingBoxToolNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_MOVING]: [
      [["Control"]],
      [["Meta"]],
    ],
  };

export const PlaneBoundingBoxToolNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneBoundingBoxToolNoLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneBoundingBoxToolNoLoopedKeyboardShortcuts, string> = {
      [PlaneBoundingBoxToolNoLoopedKeyboardShortcuts.CREATE_BOUNDING_BOX]: "Create new cell",
      [PlaneBoundingBoxToolNoLoopedKeyboardShortcuts.TOGGLE_CURSOR_STATE_FOR_MOVING]:
        "Enable moving the hovered bounding box",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.PLANE_BOUNDING_BOX_TOOL,
              looped: false,
              collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_BOUNDING_BOX_TOOL,
            },
          ] as [PlaneBoundingBoxToolNoLoopedKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneBoundingBoxToolNoLoopedKeyboardShortcuts>;
  })();
