import {
  type KeyboardShortcutsMap,
  type KeyboardShortcutHandlerMetaInfoMap,
  KeyboardShortcutDomain,
  KeyboardShortcutCollisionDomain,
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
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_MOVE_TOOL]: [[["ctrl", "k"], ["m"]]],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_SKELETON_TOOL]: [
      [["ctrl", "k"], ["s"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_BRUSH_TOOL]: [[["ctrl", "k"], ["b"]]],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_BRUSH_ERASE_TOOL]: [
      [["ctrl", "k"], ["e"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_LASSO_TOOL]: [[["ctrl", "k"], ["l"]]],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_LASSO_ERASE_TOOL]: [
      [["ctrl", "k"], ["r"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_SEGMENT_PICKER_TOOL]: [
      [["ctrl", "k"], ["p"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_QUICK_SELECT_TOOL]: [
      [["ctrl", "k"], ["q"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_BOUNDING_BOX_TOOL]: [
      [["ctrl", "k"], ["x"]],
    ],
    [PlaneControllerToolSwitchingKeyboardShortcuts.SWITCH_TO_PROOFREADING_TOOL]: [
      [["ctrl", "k"], ["q"]],
    ],
  } as const;

export const PlaneLoopDelayedNavigationKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneControllerToolSwitchingKeyboardShortcuts> =
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
      Object.entries(withDescription).map(([handlerId, description]) => [
        handlerId,
        {
          description,
          domain: KeyboardShortcutDomain.PLANE_NAVIGATION,
          looped: true,
          collisionDomains: [KeyboardShortcutCollisionDomain.PLANE_MODE],
        },
      ]),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneControllerToolSwitchingKeyboardShortcuts>;
  })();
