import {
  KeyboardShortcutCollisionEntityName,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutMetaInfo,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum PlaneControllerLoopedNavigationKeyboardShortcuts {
  MOVE_LEFT = "MOVE_LEFT",
  MOVE_RIGHT = "MOVE_RIGHT",
  MOVE_UP = "MOVE_UP",
  MOVE_DOWN = "MOVE_DOWN",
  YAW_LEFT = "YAW_LEFT",
  YAW_RIGHT = "YAW_RIGHT",
  PITCH_UP = "PITCH_UP",
  PITCH_DOWN = "PITCH_DOWN",
  ALT_ROLL_LEFT = "ALT_ROLL_LEFT",
  ALT_ROLL_RIGHT = "ALT_ROLL_RIGHT",
}

export const DEFAULT_PLANE_LOOPED_NAVIGATION_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneControllerLoopedNavigationKeyboardShortcuts> =
  {
    [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_LEFT]: [[["ArrowLeft"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_RIGHT]: [[["ArrowRight"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_UP]: [[["ArrowUp"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_DOWN]: [[["ArrowDown"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_LEFT]: [[["Shift", "ArrowLeft"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_RIGHT]: [[["Shift", "ArrowRight"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_UP]: [[["Shift", "ArrowUp"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_DOWN]: [[["Shift", "ArrowDown"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_LEFT]: [[["Alt", "ArrowLeft"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_RIGHT]: [[["Alt", "ArrowRight"]]],
  } as const;

export const PlaneNavigationKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneControllerLoopedNavigationKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneControllerLoopedNavigationKeyboardShortcuts, string> = {
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_LEFT]: "Move left",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_RIGHT]: "Move right",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_UP]: "Move up",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_DOWN]: "Move down",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_LEFT]: "Rotate left",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_RIGHT]: "Rotate right",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_UP]: "Rotate up",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_DOWN]: "Rotate down",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_LEFT]: "Roll left",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_RIGHT]: "Roll right",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.PLANE_NAVIGATION,
              looped: true,
              collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_MODE,
            },
          ] as [PlaneControllerLoopedNavigationKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneControllerLoopedNavigationKeyboardShortcuts>;
  })();

// --------------------------- delayed-loop (keyboard with custom delay) ---------------------------------
export enum PlaneControllerLoopDelayedNavigationKeyboardShortcuts {
  MOVE_MULTIPLE_FORWARD = "MOVE_MULTIPLE_FORWARD",
  MOVE_MULTIPLE_BACKWARD = "MOVE_MULTIPLE_BACKWARD",
  MOVE_ONE_BACKWARD = "SHIFT_SPACE",
  MOVE_ONE_FORWARD = "MOVE_ONE_FORWARD",
  MOVE_ONE_FORWARD_DIRECTION_AWARE = "MOVE_ONE_FORWARD_DIRECTION_AWARE",
  MOVE_ONE_BACKWARD_DIRECTION_AWARE = "MOVE_ONE_BACKWARD_DIRECTION_AWARE",
  ZOOM_IN_PLANE = "ZOOM_IN_PLANE",
  ZOOM_OUT_PLANE = "ZOOM_OUT_PLANE",
  INCREASE_MOVE_VALUE_PLANE = "INCREASE_MOVE_VALUE_PLANE",
  DECREASE_MOVE_VALUE_PLANE = "DECREASE_MOVE_VALUE_PLANE",
}

export const DEFAULT_PLANE_LOOP_DELAYED_NAVIGATION_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneControllerLoopDelayedNavigationKeyboardShortcuts> =
  {
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_MULTIPLE_FORWARD]: [
      [["Shift", "f"]],
    ],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_MULTIPLE_BACKWARD]: [
      [["Shift", "d"]],
    ],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_BACKWARD]: [
      [["Shift", "Space"]],
      [["Control", "Space"]],
    ],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_FORWARD]: [[["Space"]]],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_FORWARD_DIRECTION_AWARE]: [
      [["f"]],
    ],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_BACKWARD_DIRECTION_AWARE]: [
      [["d"]],
    ],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.ZOOM_IN_PLANE]: [[["i"]]],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.ZOOM_OUT_PLANE]: [[["o"]]],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.INCREASE_MOVE_VALUE_PLANE]: [[["h"]]],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.DECREASE_MOVE_VALUE_PLANE]: [[["g"]]],
  } as const;

export const PlaneLoopDelayedNavigationKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneControllerLoopDelayedNavigationKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneControllerLoopDelayedNavigationKeyboardShortcuts, string> = {
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_MULTIPLE_FORWARD]:
        "Fast move forward",
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_MULTIPLE_BACKWARD]:
        "Fast move backward",
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_BACKWARD]: "Move backward",
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_FORWARD]: "Move forward",
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_FORWARD_DIRECTION_AWARE]:
        "Move forward (direction aware)",
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_BACKWARD_DIRECTION_AWARE]:
        "Move backward (direction aware)",
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.ZOOM_IN_PLANE]: "Zoom in",
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.ZOOM_OUT_PLANE]: "Zoom out",
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.INCREASE_MOVE_VALUE_PLANE]:
        "Increase move value",
      [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.DECREASE_MOVE_VALUE_PLANE]:
        "Decrease move value",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.PLANE_NAVIGATION,
              looped: true,
              collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_MODE,
            },
          ] as [PlaneControllerLoopDelayedNavigationKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneControllerLoopDelayedNavigationKeyboardShortcuts>;
  })();

export enum PlaneControllerNoLoopGeneralKeyboardShortcuts {
  DOWNLOAD_SCREENSHOT_PLANE = "DOWNLOAD_SCREENSHOT_PLANE",
  CYCLE_TOOLS = "CYCLE_TOOLS",
  CYCLE_TOOLS_BACKWARDS = "CYCLE_TOOLS_BACKWARDS",
}

export const DEFAULT_PLANE_NO_LOOPED_GENERAL_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneControllerNoLoopGeneralKeyboardShortcuts> =
  {
    [PlaneControllerNoLoopGeneralKeyboardShortcuts.DOWNLOAD_SCREENSHOT_PLANE]: [[["q"]]],
    [PlaneControllerNoLoopGeneralKeyboardShortcuts.CYCLE_TOOLS]: [[["w"]]],
    [PlaneControllerNoLoopGeneralKeyboardShortcuts.CYCLE_TOOLS_BACKWARDS]: [[["Shift", "w"]]],
  } as const;

export const PlaneGeneralKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneControllerNoLoopGeneralKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneControllerNoLoopGeneralKeyboardShortcuts, string> = {
      [PlaneControllerNoLoopGeneralKeyboardShortcuts.DOWNLOAD_SCREENSHOT_PLANE]:
        "Download Screenshot(s) of Viewport(s)",
      [PlaneControllerNoLoopGeneralKeyboardShortcuts.CYCLE_TOOLS]:
        "Cycle Through Tools (Move / Skeleton / Brush/ ...)",
      [PlaneControllerNoLoopGeneralKeyboardShortcuts.CYCLE_TOOLS_BACKWARDS]:
        "Cycle Backwards Through Tools (Move / Proofread / Bounding Box / ...)",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.PLANE_NAVIGATION,
              looped: false,
              collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_MODE,
            },
          ] as [PlaneControllerNoLoopGeneralKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneControllerNoLoopGeneralKeyboardShortcuts>;
  })();
