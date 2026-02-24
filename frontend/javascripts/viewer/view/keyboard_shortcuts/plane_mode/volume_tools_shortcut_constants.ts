import {
  KeyboardShortcutCollisionDomain,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum OrthoVolumeNoLoopedKeyboardShortcuts {
  CREATE_NEW_CELL = "CREATE_NEW_CELL",
  INTERPOLATE_SEGMENTATION = "INTERPOLATE_SEGMENTATION",
  COPY_SEGMENT_ID = "COPY_SEGMENT_ID",
  BRUSH_PRESET_SMALL = "BRUSH_PRESET_SMALL",
  BRUSH_PRESET_MEDIUM = "BRUSH_PRESET_MEDIUM",
  BRUSH_PRESET_LARGE = "BRUSH_PRESET_LARGE",
}

export const DEFAULT_ORTHO_VOLUME_NO_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<OrthoVolumeNoLoopedKeyboardShortcuts> =
  {
    [OrthoVolumeNoLoopedKeyboardShortcuts.CREATE_NEW_CELL]: [[["c"]]],
    [OrthoVolumeNoLoopedKeyboardShortcuts.INTERPOLATE_SEGMENTATION]: [[["v"]]],
    [OrthoVolumeNoLoopedKeyboardShortcuts.COPY_SEGMENT_ID]: [[["ctrl", "i"]]],
    [OrthoVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_SMALL]: [[["ctrl", "k"], ["1"]]],
    [OrthoVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_MEDIUM]: [[["ctrl", "k"], ["2"]]],
    [OrthoVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_LARGE]: [[["ctrl", "k"], ["3"]]],
  };

export const OrthoVolumeNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<OrthoVolumeNoLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<OrthoVolumeNoLoopedKeyboardShortcuts, string> = {
      [OrthoVolumeNoLoopedKeyboardShortcuts.CREATE_NEW_CELL]: "Create new cell",
      [OrthoVolumeNoLoopedKeyboardShortcuts.INTERPOLATE_SEGMENTATION]:
        "Interpolate annotation between latest drawn sections",
      [OrthoVolumeNoLoopedKeyboardShortcuts.COPY_SEGMENT_ID]: "Copy segment id under cursor",
      [OrthoVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_SMALL]: "Switch to small brush",
      [OrthoVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_MEDIUM]: "Switch to medium sized brush",
      [OrthoVolumeNoLoopedKeyboardShortcuts.BRUSH_PRESET_LARGE]: "Switch to large brush",
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
    ) as KeyboardShortcutHandlerMetaInfoMap<OrthoVolumeNoLoopedKeyboardShortcuts>;
  })();

export enum OrthoVolumeLoopDelayedConfigKeyboardShortcuts {
  DECREASE_BRUSH_SIZE = "DECREASE_BRUSH_SIZE",
  INCREASE_BRUSH_SIZE = "INCREASE_BRUSH_SIZE",
}
export const DEFAULT_ORTHO_VOLUME_LOOP_DELAYED_CONFIG_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<OrthoVolumeLoopDelayedConfigKeyboardShortcuts> =
  {
    [OrthoVolumeLoopDelayedConfigKeyboardShortcuts.DECREASE_BRUSH_SIZE]: [[["shift", "i"]]],
    [OrthoVolumeLoopDelayedConfigKeyboardShortcuts.INCREASE_BRUSH_SIZE]: [[["shift", "o"]]],
  };

export const OrthoVolumeLoopDelayedConfigKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<OrthoVolumeLoopDelayedConfigKeyboardShortcuts> =
  {
    [OrthoVolumeLoopDelayedConfigKeyboardShortcuts.DECREASE_BRUSH_SIZE]: {
      description: "Decrease brush size",
      domain: KeyboardShortcutDomain.PLANE_CONFIGURATIONS,
      looped: true,
      collisionDomains: [KeyboardShortcutCollisionDomain.PLANE_MODE],
    },
    [OrthoVolumeLoopDelayedConfigKeyboardShortcuts.INCREASE_BRUSH_SIZE]: {
      description: "Increase brush size",
      domain: KeyboardShortcutDomain.PLANE_CONFIGURATIONS,
      looped: true,
      collisionDomains: [KeyboardShortcutCollisionDomain.PLANE_MODE],
    },
  };
