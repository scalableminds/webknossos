import {
  KeyboardShortcutCollisionEntityName,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutMetaInfo,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum PlaneVolumeToolNoLoopedKeyboardShortcuts {
  CREATE_NEW_CELL = "CREATE_NEW_CELL",
  INTERPOLATE_SEGMENTATION = "INTERPOLATE_SEGMENTATION",
  COPY_SEGMENT_ID = "COPY_SEGMENT_ID",
  BRUSH_PRESET_SMALL = "BRUSH_PRESET_SMALL",
  BRUSH_PRESET_MEDIUM = "BRUSH_PRESET_MEDIUM",
  BRUSH_PRESET_LARGE = "BRUSH_PRESET_LARGE",
}

export const DEFAULT_PLANE_VOLUME_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneVolumeToolNoLoopedKeyboardShortcuts> =
  {
    [PlaneVolumeToolNoLoopedKeyboardShortcuts.CREATE_NEW_CELL]: [[["c"]]],
    [PlaneVolumeToolNoLoopedKeyboardShortcuts.INTERPOLATE_SEGMENTATION]: [[["v"]]],
    [PlaneVolumeToolNoLoopedKeyboardShortcuts.COPY_SEGMENT_ID]: [[["Control", "i"]]],
    [PlaneVolumeToolNoLoopedKeyboardShortcuts.BRUSH_PRESET_SMALL]: [[["Control", "k"], ["1"]]],
    [PlaneVolumeToolNoLoopedKeyboardShortcuts.BRUSH_PRESET_MEDIUM]: [[["Control", "k"], ["2"]]],
    [PlaneVolumeToolNoLoopedKeyboardShortcuts.BRUSH_PRESET_LARGE]: [[["Control", "k"], ["3"]]],
  };

export const PlaneVolumeToolNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneVolumeToolNoLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneVolumeToolNoLoopedKeyboardShortcuts, string> = {
      [PlaneVolumeToolNoLoopedKeyboardShortcuts.CREATE_NEW_CELL]: "Create new cell",
      [PlaneVolumeToolNoLoopedKeyboardShortcuts.INTERPOLATE_SEGMENTATION]:
        "Interpolate annotation between latest drawn sections",
      [PlaneVolumeToolNoLoopedKeyboardShortcuts.COPY_SEGMENT_ID]: "Copy segment id under cursor",
      [PlaneVolumeToolNoLoopedKeyboardShortcuts.BRUSH_PRESET_SMALL]: "Switch to small brush",
      [PlaneVolumeToolNoLoopedKeyboardShortcuts.BRUSH_PRESET_MEDIUM]:
        "Switch to medium sized brush",
      [PlaneVolumeToolNoLoopedKeyboardShortcuts.BRUSH_PRESET_LARGE]: "Switch to large brush",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.PLANE_VOLUME_TOOL,
              looped: false,
              collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_VOLUME_TOOL,
            },
          ] as [PlaneVolumeToolNoLoopedKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneVolumeToolNoLoopedKeyboardShortcuts>;
  })();

export enum PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts {
  DECREASE_BRUSH_SIZE = "DECREASE_BRUSH_SIZE",
  INCREASE_BRUSH_SIZE = "INCREASE_BRUSH_SIZE",
}
export const DEFAULT_PLANE_VOLUME_TOOL_LOOP_DELAYED_CONFIG_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts> =
  {
    [PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts.DECREASE_BRUSH_SIZE]: [[["Shift", "i"]]],
    [PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts.INCREASE_BRUSH_SIZE]: [[["Shift", "o"]]],
  };

export const PlaneVolumeToolLoopDelayedConfigKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts> =
  {
    [PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts.DECREASE_BRUSH_SIZE]: {
      description: "Decrease brush size",
      domain: KeyboardShortcutDomain.PLANE_VOLUME_TOOL,
      looped: true,
      collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_VOLUME_TOOL,
    },
    [PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts.INCREASE_BRUSH_SIZE]: {
      description: "Increase brush size",
      domain: KeyboardShortcutDomain.PLANE_VOLUME_TOOL,
      looped: true,
      collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_VOLUME_TOOL,
    },
  };
