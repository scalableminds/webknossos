import {
  KeyboardShortcutCollisionDomain,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum PlaneVolumeNoLoopedKeyboardShortcuts {
  CREATE_NEW_CELL = "CREATE_NEW_CELL",
  INTERPOLATE_SEGMENTATION = "INTERPOLATE_SEGMENTATION",
  COPY_SEGMENT_ID = "COPY_SEGMENT_ID",
  BRUSH_PRESET_SMALL = "BRUSH_PRESET_SMALL",
  BRUSH_PRESET_MEDIUM = "BRUSH_PRESET_MEDIUM",
  BRUSH_PRESET_LARGE = "BRUSH_PRESET_LARGE",
}

export const DEFAULT_PLANE_NO_LOOPED_VOLUME_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneVolumeNoLoopedKeyboardShortcuts> =
  {
    [PlaneVolumeNoLoopedKeyboardShortcuts.CREATE_NEW_CELL]: [[["c"]]],
    [PlaneVolumeNoLoopedKeyboardShortcuts.INTERPOLATE_SEGMENTATION]: [[["v"]]],
    [PlaneVolumeNoLoopedKeyboardShortcuts.COPY_SEGMENT_ID]: [[["ctrl", "i"]]],
    [PlaneVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_SMALL]: [[["ctrl", "k"], ["1"]]],
    [PlaneVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_MEDIUM]: [[["ctrl", "k"], ["2"]]],
    [PlaneVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_LARGE]: [[["ctrl", "k"], ["3"]]],
  };

export const PlaneVolumeNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneVolumeNoLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneVolumeNoLoopedKeyboardShortcuts, string> = {
      [PlaneVolumeNoLoopedKeyboardShortcuts.CREATE_NEW_CELL]: "Create new cell",
      [PlaneVolumeNoLoopedKeyboardShortcuts.INTERPOLATE_SEGMENTATION]:
        "Interpolate annotation between latest drawn sections",
      [PlaneVolumeNoLoopedKeyboardShortcuts.COPY_SEGMENT_ID]: "Copy segment id under cursor",
      [PlaneVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_SMALL]: "Switch to small brush",
      [PlaneVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_MEDIUM]: "Switch to medium sized brush",
      [PlaneVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_LARGE]: "Switch to large brush",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(([handlerId, description]) => [
        handlerId,
        {
          description,
          domain: KeyboardShortcutDomain.PLANE_VOLUME_TOOL,
          looped: false,
          collisionDomains: [
            KeyboardShortcutCollisionDomain.PLANE_MODE,
            KeyboardShortcutCollisionDomain.PLANE_VOLUME_TOOL,
          ],
        },
      ]),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneVolumeNoLoopedKeyboardShortcuts>;
  })();

export enum PlaneControllerLoopDelayedConfigKeyboardShortcuts {
  DECREASE_BRUSH_SIZE = "DECREASE_BRUSH_SIZE",
  INCREASE_BRUSH_SIZE = "INCREASE_BRUSH_SIZE",
}
export const DEFAULT_PLANE_LOOP_DELAYED_CONFIG_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneControllerLoopDelayedConfigKeyboardShortcuts> =
  {
    [PlaneControllerLoopDelayedConfigKeyboardShortcuts.DECREASE_BRUSH_SIZE]: [[["shift", "i"]]],
    [PlaneControllerLoopDelayedConfigKeyboardShortcuts.INCREASE_BRUSH_SIZE]: [[["shift", "o"]]],
  };

export const PlaneLoopDelayedConfigKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneControllerLoopDelayedConfigKeyboardShortcuts> =
  {
    [PlaneControllerLoopDelayedConfigKeyboardShortcuts.DECREASE_BRUSH_SIZE]: {
      description: "Decrease brush size",
      domain: KeyboardShortcutDomain.PLANE_CONFIGURATIONS,
      looped: true,
      collisionDomains: [KeyboardShortcutCollisionDomain.PLANE_MODE],
    },
    [PlaneControllerLoopDelayedConfigKeyboardShortcuts.INCREASE_BRUSH_SIZE]: {
      description: "Increase brush size",
      domain: KeyboardShortcutDomain.PLANE_CONFIGURATIONS,
      looped: true,
      collisionDomains: [KeyboardShortcutCollisionDomain.PLANE_MODE],
    },
  };
