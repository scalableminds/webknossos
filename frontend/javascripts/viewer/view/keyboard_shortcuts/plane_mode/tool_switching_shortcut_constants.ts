import {
  KeyboardShortcutCollisionEntityName,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutMetaInfo,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum PlaneControllerToolSwitchingKeyboardShortcuts {
  SWITCH_TO_MOVE_TOOL = "SWITCH_TO_MOVE_TOOL",
  SWITCH_TO_SKELETON_TOOL = "SWITCH_TO_SKELETON_TOOL",
  SWITCH_TO_BRUSH_TOOL = "SWITCH_TO_BRUSH_TOOL",
  SWITCH_TO_BRUSH_ERASE_TOOL = "SWITCH_TO_BRUSH_ERASE_TOOL",
  SWITCH_TO_LASSO_TOOL = "SWITCH_TO_LASSO_TOOL",
  SWITCH_TO_LASSO_ERASE_TOOL = "SWITCH_TO_LASSO_ERASE_TOOL",
  SWITCH_TO_SEGMENT_PICKER_TOOL = "SWITCH_TO_SEGMENT_PICKER_TOOL",
  SWITCH_TO_QUICK_SELECT_TOOL = "SWITCH_TO_QUICK_SELECT_TOOL",
  SWITCH_TO_BOUNDING_BOX_TOOL = "SWITCH_TO_BOUNDING_BOX_TOOL",
  SWITCH_TO_PROOFREADING_TOOL = "SWITCH_TO_PROOFREADING_TOOL",
}

export const DEFAULT_PLANE_TOOL_SWITCHING_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneControllerToolSwitchingKeyboardShortcuts> =
  {
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_MOVE_TOOL]: [
      [["Control", "k"], ["m"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_SKELETON_TOOL]: [
      [["Control", "k"], ["s"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_BRUSH_TOOL]: [
      [["Control", "k"], ["b"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_BRUSH_ERASE_TOOL]: [
      [["Control", "k"], ["e"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_LASSO_TOOL]: [
      [["Control", "k"], ["l"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_LASSO_ERASE_TOOL]: [
      [["Control", "k"], ["r"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_SEGMENT_PICKER_TOOL]: [
      [["Control", "k"], ["p"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_QUICK_SELECT_TOOL]: [
      [["Control", "k"], ["q"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_BOUNDING_BOX_TOOL]: [
      [["Control", "k"], ["x"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_PROOFREADING_TOOL]: [
      [["Control", "k"], ["o"]],
    ],
  } as const;

export const PlaneToolSwitchingKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneControllerToolSwitchingKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneControllerToolSwitchingKeyboardShortcuts, string> = {
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_MOVE_TOOL]: "Move Tool",
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_SKELETON_TOOL]: "Skeleton Tool",
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_BRUSH_TOOL]: "Brush Tool",
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_BRUSH_ERASE_TOOL]:
        "Brush Erase Tool",
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_LASSO_TOOL]: "Lasso Tool",
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_LASSO_ERASE_TOOL]:
        "Lasso Erase Tool",
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_SEGMENT_PICKER_TOOL]:
        "Segment Picker Tool",
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_QUICK_SELECT_TOOL]:
        "Quick Select Tool",
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_BOUNDING_BOX_TOOL]:
        "Bounding Box Tool",
      [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_PROOFREADING_TOOL]:
        "Proofreading Tool",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.PLANE_TOOL_SWITCHING,
              collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_MODE,
            },
          ] as [PlaneControllerToolSwitchingKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneControllerToolSwitchingKeyboardShortcuts>;
  })();
