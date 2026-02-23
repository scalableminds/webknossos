import {
  type KeyboardShortcutsMap,
  KeyboardShortcutDomain,
  KeyboardShortcutCollisionDomain,
  type KeyboardShortcutMetaInfo,
  type KeyboardShortcutHandlerMetaInfoMap,
} from "./keyboard_shortcut_types";

export enum ArbitraryControllerNavigationKeyboardShortcuts {
  MOVE_FORWARD_WITH_RECORDING = "MOVE_FORWARD_WITH_RECORDING",
  MOVE_BACKWARD_WITH_RECORDING = "MOVE_BACKWARD_WITH_RECORDING",
  MOVE_FORWARD_WITHOUT_RECORDING = "MOVE_FORWARD_WITHOUT_RECORDING",
  MOVE_BACKWARD_WITHOUT_RECORDING = "MOVE_BACKWARD_WITHOUT_RECORDING",
  YAW_FLYCAM_POSITIVE_AT_CENTER = "YAW_FLYCAM_POSITIVE_AT_CENTER",
  YAW_FLYCAM_INVERTED_AT_CENTER = "YAW_FLYCAM_INVERTED_AT_CENTER",
  PITCH_FLYCAM_POSITIVE_AT_CENTER = "PITCH_FLYCAM_POSITIVE_AT_CENTER",
  PITCH_FLYCAM_INVERTED_AT_CENTER = "PITCH_FLYCAM_INVERTED_AT_CENTER",
  YAW_FLYCAM_POSITIVE_IN_DISTANCE = "YAW_FLYCAM_POSITIVE_IN_DISTANCE",
  YAW_FLYCAM_INVERTED_IN_DISTANCE = "YAW_FLYCAM_INVERTED_IN_DISTANCE",
  PITCH_FLYCAM_POSITIVE_IN_DISTANCE = "PITCH_FLYCAM_POSITIVE_IN_DISTANCE",
  PITCH_FLYCAM_INVERTED_IN_DISTANCE = "PITCH_FLYCAM_INVERTED_IN_DISTANCE",
  ZOOM_IN_ARBITRARY = "ZOOM_IN_ARBITRARY",
  ZOOM_OUT_ARBITRARY = "ZOOM_OUT_ARBITRARY",
}

export const DEFAULT_ARBITRARY_NAVIGATION_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<ArbitraryControllerNavigationKeyboardShortcuts> =
  {
    [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_FORWARD_WITH_RECORDING]: [[["space"]]],
    [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_BACKWARD_WITH_RECORDING]: [
      [["ctrl", "space"]],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_FORWARD_WITHOUT_RECORDING]: [[["f"]]],
    [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_BACKWARD_WITHOUT_RECORDING]: [[["d"]]],
    [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_POSITIVE_AT_CENTER]: [
      [["shift", "left"]],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_INVERTED_AT_CENTER]: [
      [["shift", "right"]],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_POSITIVE_AT_CENTER]: [
      [["shift", "up"]],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_INVERTED_AT_CENTER]: [
      [["shift", "down"]],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_POSITIVE_IN_DISTANCE]: [[["left"]]],
    [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_INVERTED_IN_DISTANCE]: [[["right"]]],
    [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_POSITIVE_IN_DISTANCE]: [
      [["down"]],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_INVERTED_IN_DISTANCE]: [[["up"]]],
    [ArbitraryControllerNavigationKeyboardShortcuts.ZOOM_IN_ARBITRARY]: [[["i"]]],
    [ArbitraryControllerNavigationKeyboardShortcuts.ZOOM_OUT_ARBITRARY]: [[["o"]]],
  } as const;

export const ArbitraryNavigationKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<ArbitraryControllerNavigationKeyboardShortcuts> =
  (() => {
    const withDescription: Record<ArbitraryControllerNavigationKeyboardShortcuts, string> = {
      [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_FORWARD_WITH_RECORDING]:
        "Move forward (while creating nodes)",
      [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_BACKWARD_WITH_RECORDING]:
        "Move backward (while creating nodes)",
      [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_FORWARD_WITHOUT_RECORDING]:
        "Move forward (without creating nodes)",
      [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_BACKWARD_WITHOUT_RECORDING]:
        "Move backward (without creating nodes)",
      [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_POSITIVE_AT_CENTER]:
        "Rotate left around center",
      [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_INVERTED_AT_CENTER]:
        "Rotate right around center",
      [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_POSITIVE_AT_CENTER]:
        "Rotate upwards around center",
      [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_INVERTED_AT_CENTER]:
        "Rotate downwards around center",
      [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_POSITIVE_IN_DISTANCE]:
        "Rotate left in distance",
      [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_INVERTED_IN_DISTANCE]:
        "Rotate right in distance",
      [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_POSITIVE_IN_DISTANCE]:
        "Rotate up in distance",
      [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_INVERTED_IN_DISTANCE]:
        "Rotate down in distance",
      [ArbitraryControllerNavigationKeyboardShortcuts.ZOOM_IN_ARBITRARY]: "Zoom in",
      [ArbitraryControllerNavigationKeyboardShortcuts.ZOOM_OUT_ARBITRARY]: "Zoom out",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.ARBITRARY_NAVIGATION,
              looped: true,
              collisionDomains: [KeyboardShortcutCollisionDomain.ARBITRARY_MODE],
            },
          ] as [ArbitraryControllerNavigationKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<ArbitraryControllerNavigationKeyboardShortcuts>;
  })();

export enum ArbitraryControllerNavigationConfigKeyboardShortcuts {
  INCREASE_MOVE_VALUE_ARBITRARY = "INCREASE_MOVE_VALUE_ARBITRARY",
  DECREASE_MOVE_VALUE_ARBITRARY = "DECREASE_MOVE_VALUE_ARBITRARY",
}

export const DEFAULT_ARBITRARY_NAVIGATION_CONFIG_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<ArbitraryControllerNavigationConfigKeyboardShortcuts> =
  {
    [ArbitraryControllerNavigationConfigKeyboardShortcuts.INCREASE_MOVE_VALUE_ARBITRARY]: [[["h"]]],
    [ArbitraryControllerNavigationConfigKeyboardShortcuts.DECREASE_MOVE_VALUE_ARBITRARY]: [[["g"]]],
  } as const;
export const ArbitraryNavigationConfigKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<ArbitraryControllerNavigationConfigKeyboardShortcuts> =
  {
    [ArbitraryControllerNavigationConfigKeyboardShortcuts.INCREASE_MOVE_VALUE_ARBITRARY]: {
      description: "Increase move value",
      domain: KeyboardShortcutDomain.ARBITRARY_NAVIGATION,
      looped: false,
      collisionDomains: [KeyboardShortcutCollisionDomain.ARBITRARY_MODE],
    },
    [ArbitraryControllerNavigationConfigKeyboardShortcuts.DECREASE_MOVE_VALUE_ARBITRARY]: {
      description: "Decrease move value",
      domain: KeyboardShortcutDomain.ARBITRARY_NAVIGATION,
      looped: false,
      collisionDomains: [KeyboardShortcutCollisionDomain.ARBITRARY_MODE],
    },
  };

export enum ArbitraryControllerNoLoopKeyboardShortcuts {
  TOGGLE_ALL_TREES_ARBITRARY = "TOGGLE_ALL_TREES_ARBITRARY",
  TOGGLE_INACTIVE_TREES_ARBITRARY = "TOGGLE_INACTIVE_TREES_ARBITRARY",
  DELETE_ACTIVE_NODE_ARBITRARY = "DELETE_ACTIVE_NODE",
  CREATE_TREE_ARBITRARY = "CREATE_TREE",
  CREATE_BRANCH_POINT_ARBITRARY = "CREATE_BRANCH_POINT",
  DELETE_BRANCH_POINT_ARBITRARY = "DELETE_BRANCH_POINT",
  RECENTER_ACTIVE_NODE_ARBITRARY = "RECENTER_ACTIVE_NODE",
  NEXT_NODE_FORWARD_ARBITRARY = "NEXT_NODE_FORWARD",
  NEXT_NODE_BACKWARD_ARBITRARY = "NEXT_NODE_BACKWARD",
  ROTATE_VIEW_180 = "ROTATE_VIEW_180",
  DOWNLOAD_SCREENSHOT_ARBITRARY = "DOWNLOAD_SCREENSHOT",
}

export const DEFAULT_ARBITRARY_NO_LOOP_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<ArbitraryControllerNoLoopKeyboardShortcuts> =
  {
    [ArbitraryControllerNoLoopKeyboardShortcuts.TOGGLE_ALL_TREES_ARBITRARY]: [[["1"]]],
    [ArbitraryControllerNoLoopKeyboardShortcuts.TOGGLE_INACTIVE_TREES_ARBITRARY]: [[["2"]]],
    [ArbitraryControllerNoLoopKeyboardShortcuts.DELETE_ACTIVE_NODE_ARBITRARY]: [
      [["delete"]],
      [["backspace"]],
      [["shift", "space"]],
    ],
    [ArbitraryControllerNoLoopKeyboardShortcuts.CREATE_TREE_ARBITRARY]: [[["c"]]],
    [ArbitraryControllerNoLoopKeyboardShortcuts.CREATE_BRANCH_POINT_ARBITRARY]: [[["b"]]],
    [ArbitraryControllerNoLoopKeyboardShortcuts.DELETE_BRANCH_POINT_ARBITRARY]: [[["j"]]],
    [ArbitraryControllerNoLoopKeyboardShortcuts.RECENTER_ACTIVE_NODE_ARBITRARY]: [[["s"]]],
    [ArbitraryControllerNoLoopKeyboardShortcuts.NEXT_NODE_FORWARD_ARBITRARY]: [[["."]]],
    [ArbitraryControllerNoLoopKeyboardShortcuts.NEXT_NODE_BACKWARD_ARBITRARY]: [[[","]]],
    [ArbitraryControllerNoLoopKeyboardShortcuts.ROTATE_VIEW_180]: [[["r"]]],
    [ArbitraryControllerNoLoopKeyboardShortcuts.DOWNLOAD_SCREENSHOT_ARBITRARY]: [[["q"]]],
  } as const;

export const ArbitraryNoLoopKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<ArbitraryControllerNoLoopKeyboardShortcuts> =
  (() => {
    const withDescription = {
      [ArbitraryControllerNoLoopKeyboardShortcuts.TOGGLE_ALL_TREES_ARBITRARY]: "Toggle all trees",
      [ArbitraryControllerNoLoopKeyboardShortcuts.TOGGLE_INACTIVE_TREES_ARBITRARY]:
        "Toggle inactive trees",
      [ArbitraryControllerNoLoopKeyboardShortcuts.DELETE_ACTIVE_NODE_ARBITRARY]:
        "Delete active node",
      [ArbitraryControllerNoLoopKeyboardShortcuts.CREATE_TREE_ARBITRARY]: "Create new tree",
      [ArbitraryControllerNoLoopKeyboardShortcuts.CREATE_BRANCH_POINT_ARBITRARY]:
        "Create branch point",
      [ArbitraryControllerNoLoopKeyboardShortcuts.DELETE_BRANCH_POINT_ARBITRARY]:
        "Delete branch point",
      [ArbitraryControllerNoLoopKeyboardShortcuts.RECENTER_ACTIVE_NODE_ARBITRARY]:
        "Recenter active node",
      [ArbitraryControllerNoLoopKeyboardShortcuts.NEXT_NODE_FORWARD_ARBITRARY]: "Jump to next node",
      [ArbitraryControllerNoLoopKeyboardShortcuts.NEXT_NODE_BACKWARD_ARBITRARY]:
        "Jump to previous node",
      [ArbitraryControllerNoLoopKeyboardShortcuts.ROTATE_VIEW_180]: "Rotate view 180 degrees",
      [ArbitraryControllerNoLoopKeyboardShortcuts.DOWNLOAD_SCREENSHOT_ARBITRARY]:
        "Download screenshot",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.ARBITRARY_EDITING,
              looped: false,
              collisionDomains: [KeyboardShortcutCollisionDomain.ARBITRARY_MODE],
            },
          ] as [ArbitraryControllerNoLoopKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<ArbitraryControllerNoLoopKeyboardShortcuts>;
  })();
