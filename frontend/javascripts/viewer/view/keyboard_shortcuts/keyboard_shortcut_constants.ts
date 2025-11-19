import type { KeyboardHandler, KeyboardLoopHandler } from "libs/input";
import _ from "lodash";
import type { Mutable } from "types/globals";

export type ComparableKeyboardCombo = string[];
export type KeyboardComboChain = ComparableKeyboardCombo[];
export type KeyboardShortcutsMap<KeyboardShortcutHandlerId extends string> = Record<
  KeyboardShortcutHandlerId,
  KeyboardComboChain[]
>;

type KeyboardShortcutMetaInfo = {
  description: string;
  // looped is per default false.
  looped?: boolean;
  domain: KeyboardShortcutDomain;
  // No collision domain means colliding with all shortcuts.
  collisionDomains?: KeyboardShortcutCollisionDomain[];
};

export type KeyboardShortcutHandlerMetaInfoMap<KeyboardShortcutHandlerId extends string> = Record<
  KeyboardShortcutHandlerId,
  KeyboardShortcutMetaInfo
>;

export type KeyboardShortcutHandlerMap<KeyboardShortcutHandlerId extends string> = Record<
  KeyboardShortcutHandlerId,
  // looped is per default false.
  KeyboardHandler
>;
export type KeyboardShortcutLoopedHandlerMap<KeyboardShortcutHandlerId extends string> = Record<
  KeyboardShortcutHandlerId,
  // looped is per default false.
  KeyboardLoopHandler
>;

export enum KeyboardShortcutDomain {
  GENERAL = "General",
  GENERAL_EDITING = "General Editing",
  ARBITRARY_NAVIGATION = "Navigation in Arbitrary Mode",
  ARBITRARY_EDITING = "Editing in Arbitrary Mode",
  PLANE_NAVIGATION = "Navigation in Plane Mode",
  PLANE_CONFIGURATIONS = "Change Configurations in Plane Mode",
}

// Default is general -> colliding with all other shortcuts.
enum KeyboardShortcutCollisionDomain {
  MOVE_TOOL = "move_tool",
  GENERAL = "general",
  ARBITRARY_MODE = "arbitrary_mode",
  PLANE_MODE = "plane_mode",
}

// ----------------------------------------------------- Shortcuts used by controller.ts -----------------------------------------------------------------
export enum GeneralKeyboardShortcuts {
  SWITCH_VIEWMODE_PLANE = "SWITCH_VIEWMODE_PLANE",
  SWITCH_VIEWMODE_ARBITRARY = "SWITCH_VIEWMODE_ARBITRARY",
  SWITCH_VIEWMODE_ARBITRARY_PLANE = "SWITCH_VIEWMODE_ARBITRARY_PLANE",
  CYCLE_VIEWMODE = "CYCLE_VIEWMODE",
  TOGGLE_SEGMENTATION = "TOGGLE_SEGMENTATION",
}

export enum GeneralEditingKeyboardShortcuts {
  SAVE = "SAVE",
  UNDO = "UNDO",
  REDO = "REDO",
}

export const DEFAULT_GENERAL_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<GeneralKeyboardShortcuts> = {
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_PLANE]: [[["shift", "1"]]],
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY]: [[["shift", "2"]]],
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY_PLANE]: [[["shift", "3"]]],
  [GeneralKeyboardShortcuts.CYCLE_VIEWMODE]: [[["m"]]],
  [GeneralKeyboardShortcuts.TOGGLE_SEGMENTATION]: [[["3"]]],
} as const;

export const DEFAULT_GENERAL_EDITING_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<GeneralEditingKeyboardShortcuts> =
  {
    [GeneralEditingKeyboardShortcuts.SAVE]: [[["super", "s"]], [["ctrl", "s"]]],
    [GeneralEditingKeyboardShortcuts.UNDO]: [[["super", "z"]], [["ctrl", "z"]]],
    [GeneralEditingKeyboardShortcuts.REDO]: [[["super", "y"]], [["ctrl", "y"]]],
  } as const;

// @ts-ignore TODOM
const GeneralKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<GeneralKeyboardShortcuts> =
  (() => {
    const withDescription = {
      [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_PLANE]: "View in plane mode",
      [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY]: "View in plane arbitrary mode",
      [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY_PLANE]:
        "View in plane arbitrary plane mode",
      [GeneralKeyboardShortcuts.CYCLE_VIEWMODE]: "Cycle through viewing modes",
      [GeneralKeyboardShortcuts.TOGGLE_SEGMENTATION]: "Toggle segmentation layer",
    };
    const withAllInfo = Object.entries(withDescription).map(
      ([handlerId, description]) =>
        [handlerId, { description, domain: KeyboardShortcutDomain.GENERAL, looped: false }] as [
          GeneralKeyboardShortcuts,
          KeyboardShortcutMetaInfo,
        ],
    );
    return Object.fromEntries(withAllInfo);
  })();

// @ts-ignore TODOM
const GeneralEditingKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<GeneralEditingKeyboardShortcuts> =
  (() => {
    const withDescription = {
      [GeneralEditingKeyboardShortcuts.SAVE]: "Save annotation changes",
      [GeneralEditingKeyboardShortcuts.UNDO]: "Undo latest annotation change",
      [GeneralEditingKeyboardShortcuts.REDO]: "Redo latest annotation change",
    };
    const withAllInfo = Object.entries(withDescription).map(
      ([handlerId, description]) =>
        [
          handlerId,
          {
            description,
            domain: KeyboardShortcutDomain.GENERAL_EDITING,
            looped: false,
            collisionDomains: [KeyboardShortcutCollisionDomain.GENERAL],
          },
        ] as [GeneralEditingKeyboardShortcuts, KeyboardShortcutMetaInfo],
    );
    return Object.fromEntries(withAllInfo);
  })();

// ---------------------------------------- Shortcuts used by arbitrary_controller.ts ---------------------------------------------------------------------------

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

// @ts-ignore TODOM
const ArbitraryNavigationKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<ArbitraryControllerNavigationKeyboardShortcuts> =
  (() => {
    const withDescription = {
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
    const withAllInfo = Object.entries(withDescription).map(
      ([handlerId, description]) =>
        [
          handlerId,
          {
            description,
            domain: KeyboardShortcutDomain.ARBITRARY_NAVIGATION,
            looped: true,
            collisionDomains: [KeyboardShortcutCollisionDomain.ARBITRARY_MODE],
          },
        ] as [GeneralEditingKeyboardShortcuts, KeyboardShortcutMetaInfo],
    );
    return Object.fromEntries(withAllInfo);
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
const ArbitraryNavigationConfigKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<ArbitraryControllerNavigationConfigKeyboardShortcuts> =
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

// @ts-ignore TODOM
const ArbitraryNoLoopKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<ArbitraryControllerNoLoopKeyboardShortcuts> =
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
    const withAllInfo = Object.entries(withDescription).map(
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
    );
    return Object.fromEntries(withAllInfo);
  })();

// --------------------------- Plane Controller keyboard handler ids & defaults ---------------------------

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
    [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_LEFT]: [[["left"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_RIGHT]: [[["right"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_UP]: [[["up"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_DOWN]: [[["down"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_LEFT]: [[["shift", "left"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_RIGHT]: [[["shift", "right"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_UP]: [[["shift", "up"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_DOWN]: [[["shift", "down"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_LEFT]: [[["alt", "left"]]],
    [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_RIGHT]: [[["alt", "right"]]],
  } as const;

const PlaneNavigationKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneControllerLoopedNavigationKeyboardShortcuts> =
  (() => {
    const withDescription = {
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_LEFT]: "Move left",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_RIGHT]: "Move right",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_UP]: "Move up",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.MOVE_DOWN]: "Move down",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_LEFT]: "Rotate left",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.YAW_RIGHT]: "Rotate right",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_UP]: "Rotate up",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.PITCH_DOWN]: "Rotate down",
      [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_LEFT]: "Roll left", // TODOM check for correct naming
      [PlaneControllerLoopedNavigationKeyboardShortcuts.ALT_ROLL_RIGHT]: "Roll right", // TODOM check for correct naming
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
      [["shift", "f"]],
    ],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_MULTIPLE_BACKWARD]: [
      [["shift", "d"]],
    ],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_BACKWARD]: [
      [["shift", "space"]],
      [["ctrl", "space"]],
    ],
    [PlaneControllerLoopDelayedNavigationKeyboardShortcuts.MOVE_ONE_FORWARD]: [[["space"]]],
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

const PlaneLoopDelayedNavigationKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneControllerLoopDelayedNavigationKeyboardShortcuts> =
  (() => {
    const withDescription = {
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
      Object.entries(withDescription).map(([handlerId, description]) => [
        handlerId,
        {
          description,
          domain: KeyboardShortcutDomain.PLANE_NAVIGATION,
          looped: true,
          collisionDomains: [KeyboardShortcutCollisionDomain.PLANE_MODE],
        },
      ]),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneControllerLoopDelayedNavigationKeyboardShortcuts>;
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
// --------------------------- no-loop handler ids & defaults ---------------------------------------------

export enum PlaneSkeletonNoLoopedKeyboardShortcuts {
  TOGGLE_ALL_TREES_PLANE = "TOGGLE_ALL_TREES_PLANE",
  TOGGLE_INACTIVE_TREES_PLANE = "TOGGLE_INACTIVE_TREES_PLANE",
  DELETE_ACTIVE_NODE_PLANE = "DELETE_ACTIVE_NODE_PLANE",
  CREATE_TREE_PLANE = "CREATE_TREE_PLANE",
  MOVE_ALONG_DIRECTION = "MOVE_ALONG_DIRECTION",
  MOVE_ALONG_DIRECTION_REVERSED = "MOVE_ALONG_DIRECTION_REVERSED",
  CREATE_BRANCH_POINT_PLANE = "CREATE_BRANCH_POINT_PLANE",
  DELETE_BRANCH_POINT_PLANE = "DELETE_BRANCH_POINT_PLANE",
  RECENTER_ACTIVE_NODE_PLANE = "RECENTER_ACTIVE_NODE_PLANE",
  NEXT_NODE_FORWARD_PLANE = "NEXT_NODE_FORWARD_PLANE",
  NEXT_NODE_BACKWARD_PLANE = "NEXT_NODE_BACKWARD_PLANE",
}

export const DEFAULT_PLANE_NO_LOOPED_SKELETON_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneSkeletonNoLoopedKeyboardShortcuts> =
  {
    [PlaneSkeletonNoLoopedKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]: [[["1"]]],
    [PlaneSkeletonNoLoopedKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]: [[["2"]]],
    // Delete active node
    [PlaneSkeletonNoLoopedKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: [
      [["delete"]],
      [["backspace"]],
    ],
    [PlaneSkeletonNoLoopedKeyboardShortcuts.CREATE_TREE_PLANE]: [[["c"]]],
    [PlaneSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION]: [[["e"]]],
    [PlaneSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]: [[["r"]]],
    // Branches
    [PlaneSkeletonNoLoopedKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: [[["b"]]],
    [PlaneSkeletonNoLoopedKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: [[["j"]]],
    [PlaneSkeletonNoLoopedKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]: [[["s"]]],
    // navigate nodes
    [PlaneSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_BACKWARD_PLANE]: [[["ctrl", ","]]],
    [PlaneSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_FORWARD_PLANE]: [[["ctrl", "."]]],
  };

// TODOM: add meta info

export enum PlaneSkeletonLoopedKeyboardShortcuts {
  MOVE_NODE_LEFT = "MOVE_NODE_LEFT",
  MOVE_NODE_RIGHT = "MOVE_NODE_RIGHT",
  MOVE_NODE_UP = "MOVE_NODE_UP",
  MOVE_NODE_DOWN = "MOVE_NODE_DOWN",
}

export const DEFAULT_PLANE_LOOPED_SKELETON_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneSkeletonLoopedKeyboardShortcuts> =
  {
    [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_LEFT]: [[["shirt" + "left"]]],
    [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_RIGHT]: [[["shirt" + "right"]]],
    [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_UP]: [[["shirt" + "up"]]],
    [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_DOWN]: [[["shirt" + "down"]]],
  };
// TODOM: add meta info

export enum PlaneControllerNoLoopKeyboardShortcuts {
  COPY_SEGMENT_ID = "COPY_SEGMENT_ID",
  DOWNLOAD_SCREENSHOT = "DOWNLOAD_SCREENSHOT",
  CYCLE_TOOLS = "CYCLE_TOOLS",
  CYCLE_TOOLS_BACKWARDS = "CYCLE_TOOLS_BACKWARDS",
  SET_TOOL_MOVE = "SET_TOOL_MOVE",
  BRUSH_PRESET_SMALL = "BRUSH_PRESET_SMALL",
  BRUSH_PRESET_MEDIUM = "BRUSH_PRESET_MEDIUM",
  BRUSH_PRESET_LARGE = "BRUSH_PRESET_LARGE",
  BOUNDING_BOX_EXTENDED = "BOUNDING_BOX_EXTENDED",
  TOOL_DEPENDENT_C = "TOOL_DEPENDENT_C",
  TOOL_DEPENDENT_CTRL = "TOOL_DEPENDENT_CTRL",
  TOOL_DEPENDENT_META = "TOOL_DEPENDENT_META",
}

// TODO -------------------
export const DEFAULT_PLANE_NO_LOOP_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneControllerNoLoopKeyboardShortcuts> =
  {
    [PlaneControllerNoLoopKeyboardShortcuts.COPY_SEGMENT_ID]: [[["ctrl", "i"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.DOWNLOAD_SCREENSHOT]: [[["q"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.CYCLE_TOOLS]: [[["w"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.CYCLE_TOOLS_BACKWARDS]: [[["shift", "w"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.SET_TOOL_MOVE]: [[["m"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.BRUSH_PRESET_SMALL]: [[["1"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.BRUSH_PRESET_MEDIUM]: [[["2"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.BRUSH_PRESET_LARGE]: [[["3"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.BOUNDING_BOX_EXTENDED]: [[["x"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]: [[["1"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]: [[["2"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: [
      [["delete"]],
      [["backspace"]],
    ],
    [PlaneControllerNoLoopKeyboardShortcuts.CREATE_TREE_PLANE]: [[["c"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.MOVE_ALONG_DIRECTION]: [[["e"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]: [[["r"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: [[["b"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: [[["j"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]: [[["s"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.NEXT_NODE_BACKWARD_PLANE]: [[["ctrl", ","]]],
    [PlaneControllerNoLoopKeyboardShortcuts.NEXT_NODE_FORWARD_PLANE]: [[["ctrl", "."]]],
    [PlaneControllerNoLoopKeyboardShortcuts.TOOL_DEPENDENT_C]: [[["c"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.TOOL_DEPENDENT_CTRL]: [[["ctrl"]]],
    [PlaneControllerNoLoopKeyboardShortcuts.TOOL_DEPENDENT_META]: [[["meta"]]],
  } as const;

const PlaneNoLoopKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneControllerNoLoopKeyboardShortcuts> =
  (() => {
    const withDescription = {
      [PlaneControllerNoLoopKeyboardShortcuts.COPY_SEGMENT_ID]: "Copy segment id under cursor",
      [PlaneControllerNoLoopKeyboardShortcuts.DOWNLOAD_SCREENSHOT]: "Download screenshot",
      [PlaneControllerNoLoopKeyboardShortcuts.CYCLE_TOOLS]: "Cycle tools",
      [PlaneControllerNoLoopKeyboardShortcuts.CYCLE_TOOLS_BACKWARDS]: "Cycle tools backwards",
      [PlaneControllerNoLoopKeyboardShortcuts.SET_TOOL_MOVE]: "Switch to move tool",
      [PlaneControllerNoLoopKeyboardShortcuts.BRUSH_PRESET_SMALL]: "Select small brush preset",
      [PlaneControllerNoLoopKeyboardShortcuts.BRUSH_PRESET_MEDIUM]: "Select medium brush preset",
      [PlaneControllerNoLoopKeyboardShortcuts.BRUSH_PRESET_LARGE]: "Select large brush preset",
      [PlaneControllerNoLoopKeyboardShortcuts.BOUNDING_BOX_EXTENDED]: "Bounding box tool",
      [PlaneControllerNoLoopKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]: "Toggle all trees",
      [PlaneControllerNoLoopKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]: "Toggle inactive trees",
      [PlaneControllerNoLoopKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: "Delete active node",
      [PlaneControllerNoLoopKeyboardShortcuts.CREATE_TREE_PLANE]: "Create tree",
      [PlaneControllerNoLoopKeyboardShortcuts.MOVE_ALONG_DIRECTION]:
        "Move skeleton along direction",
      [PlaneControllerNoLoopKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]:
        "Move skeleton along direction reversed",
      [PlaneControllerNoLoopKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: "Create branch point",
      [PlaneControllerNoLoopKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: "Delete branch point",
      [PlaneControllerNoLoopKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]: "Recenter active node",
      [PlaneControllerNoLoopKeyboardShortcuts.NEXT_NODE_BACKWARD_PLANE]:
        "Navigate to previous node",
      [PlaneControllerNoLoopKeyboardShortcuts.NEXT_NODE_FORWARD_PLANE]: "Navigate to next node",
      [PlaneControllerNoLoopKeyboardShortcuts.TOOL_DEPENDENT_C]: "Tool-dependent c key",
      [PlaneControllerNoLoopKeyboardShortcuts.TOOL_DEPENDENT_CTRL]: "Tool-dependent ctrl modifier",
      [PlaneControllerNoLoopKeyboardShortcuts.TOOL_DEPENDENT_META]: "Tool-dependent meta modifier",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(([handlerId, description]) => [
        handlerId,
        {
          description,
          domain: KeyboardShortcutDomain.ARBITRARY_EDITING,
          looped: false,
          collisionDomains: [KeyboardShortcutCollisionDomain.GENERAL],
        },
      ]),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneControllerNoLoopKeyboardShortcuts>;
  })();

// ----- combined objects, types and so on -------------------
export const ALL_KEYBOARD_HANDLER_IDS = [
  ...Object.values(GeneralKeyboardShortcuts),
  ...Object.values(GeneralEditingKeyboardShortcuts),
  ...Object.values(ArbitraryControllerNavigationKeyboardShortcuts),
  ...Object.values(ArbitraryControllerNavigationConfigKeyboardShortcuts),
  ...Object.values(ArbitraryControllerNoLoopKeyboardShortcuts),
  ...Object.values(PlaneControllerLoopedNavigationKeyboardShortcuts),
  ...Object.values(PlaneControllerLoopDelayedNavigationKeyboardShortcuts),
  ...Object.values(PlaneControllerLoopDelayedConfigKeyboardShortcuts),
  ...Object.values(PlaneControllerNoLoopKeyboardShortcuts),
] as const;

export const ALL_KEYBOARD_SHORTCUT_META_INFOS = {
  ...GeneralKeyboardShortcutMetaInfo,
  ...GeneralEditingKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationConfigKeyboardShortcutMetaInfo,
  ...ArbitraryNoLoopKeyboardShortcutMetaInfo,
  ...PlaneNavigationKeyboardShortcutMetaInfo,
  ...PlaneLoopDelayedNavigationKeyboardShortcutMetaInfo,
  ...PlaneNoLoopKeyboardShortcutMetaInfo,
  ...PlaneLoopDelayedConfigKeyboardShortcutMetaInfo,
};

const ALL_KEYBOARD_SHORTCUT_DEFAULTS = {
  ...DEFAULT_GENERAL_KEYBOARD_SHORTCUTS,
  ...DEFAULT_GENERAL_EDITING_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ARBITRARY_NAVIGATION_CONFIG_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ARBITRARY_NO_LOOP_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ARBITRARY_NAVIGATION_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_LOOPED_NAVIGATION_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_LOOP_DELAYED_NAVIGATION_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_LOOP_DELAYED_CONFIG_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_NO_LOOP_KEYBOARD_SHORTCUTS,
} as const;

export function getAllDefaultKeyboardShortcuts(): Mutable<typeof ALL_KEYBOARD_SHORTCUT_DEFAULTS> {
  return _.clone(ALL_KEYBOARD_SHORTCUT_DEFAULTS);
}
