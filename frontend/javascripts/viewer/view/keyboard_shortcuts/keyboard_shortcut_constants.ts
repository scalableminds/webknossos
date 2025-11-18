import type { KeyboardHandler, KeyboardLoopHandler } from "libs/input";

export type ComparableKeyboardCombo = string[];
export type KeyboardShortcutsMap<KeyboardShortcutHandlerId extends string> = Record<
  KeyboardShortcutHandlerId,
  ComparableKeyboardCombo[]
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

export const KeyboardShortcutsSchema = {
  $schema: "http://json-schema.org/draft-07/schema#",
  title: "KeyboardShortcutsMap",
  type: "object",

  description: "A mapping from key combos to valid handler IDs.",

  patternProperties: {
    ".*": {
      type: "string",
      enum: [
        "SWITCH_VIEWMODE_PLANE",
        "SWITCH_VIEWMODE_ARBITRARY",
        "SWITCH_VIEWMODE_ARBITRARY_PLANE",
        "CYCLE_VIEWMODE",
        "TOGGLE_SEGMENTATION",
        "SAVE",
        "UNDO",
        "REDO",
      ],
    },
  },

  additionalProperties: false,
};

enum KeyboardShortcutDomain {
  GENERAL = "general",
  GENERAL_EDITING = "general_editing",
  ARBITRARY_NAVIGATION = "arbitrary_navigation",
}

// Default is general -> colliding with all other shortcuts.
enum KeyboardShortcutCollisionDomain {
  MOVE_TOOL = "move_tool",
  GENERAL_EDITING = "general_editing",
  ARBITRARY_NAVIGATION = "arbitrary_navigation",
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
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_PLANE]: [["shift", "1"]],
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY]: [["shift", "2"]],
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY_PLANE]: [["shift", "3"]],
  [GeneralKeyboardShortcuts.CYCLE_VIEWMODE]: [["m"]],
  [GeneralKeyboardShortcuts.TOGGLE_SEGMENTATION]: [["3"]],
};

export const DEFAULT_GENERAL_EDITING_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<GeneralEditingKeyboardShortcuts> =
  {
    [GeneralEditingKeyboardShortcuts.SAVE]: [["super", "s"], ["ctrl" + "s"]],
    [GeneralEditingKeyboardShortcuts.UNDO]: [["super", "z"], ["ctrl" + "z"]],
    [GeneralEditingKeyboardShortcuts.REDO]: [["super", "y"], ["ctrl" + "y"]],
  };

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
            collisionDomains: [KeyboardShortcutCollisionDomain.GENERAL_EDITING],
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
    [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_FORWARD_WITH_RECORDING]: [["space"]],
    [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_BACKWARD_WITH_RECORDING]: [
      ["ctrl", "space"],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_FORWARD_WITHOUT_RECORDING]: [["f"]],
    [ArbitraryControllerNavigationKeyboardShortcuts.MOVE_BACKWARD_WITHOUT_RECORDING]: [["d"]],
    [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_POSITIVE_AT_CENTER]: [
      ["shift", "left"],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_INVERTED_AT_CENTER]: [
      ["shift", "right"],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_POSITIVE_AT_CENTER]: [
      ["shift", "up"],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_INVERTED_AT_CENTER]: [
      ["shift", "down"],
    ],
    [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_POSITIVE_IN_DISTANCE]: [["left"]],
    [ArbitraryControllerNavigationKeyboardShortcuts.YAW_FLYCAM_INVERTED_IN_DISTANCE]: [["right"]],
    [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_POSITIVE_IN_DISTANCE]: [["down"]],
    [ArbitraryControllerNavigationKeyboardShortcuts.PITCH_FLYCAM_INVERTED_IN_DISTANCE]: [["up"]],
    [ArbitraryControllerNavigationKeyboardShortcuts.ZOOM_IN_ARBITRARY]: [["i"]],
    [ArbitraryControllerNavigationKeyboardShortcuts.ZOOM_OUT_ARBITRARY]: [["o"]],
  };

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
            collisionDomains: [KeyboardShortcutCollisionDomain.ARBITRARY_NAVIGATION],
          },
        ] as [GeneralEditingKeyboardShortcuts, KeyboardShortcutMetaInfo],
    );
    return Object.fromEntries(withAllInfo);
  })();

export enum ArbitraryControllerNavigationConfigKeyboardShortcuts {
  INCREASE_MOVE_VALUE = "INCREASE_MOVE_VALUE",
  DECREASE_MOVE_VALUE = "DECREASE_MOVE_VALUE",
}

export const DEFAULT_ARBITRARY_NAVIGATION_CONFIG_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<ArbitraryControllerNavigationConfigKeyboardShortcuts> =
  {
    [ArbitraryControllerNavigationConfigKeyboardShortcuts.INCREASE_MOVE_VALUE]: [["h"]],
    [ArbitraryControllerNavigationConfigKeyboardShortcuts.DECREASE_MOVE_VALUE]: [["g"]],
  };
const ArbitraryNavigationConfigKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<ArbitraryControllerNavigationConfigKeyboardShortcuts> =
  {
    [ArbitraryControllerNavigationConfigKeyboardShortcuts.INCREASE_MOVE_VALUE]: {
      description: "Increase move value",
      domain: KeyboardShortcutDomain.ARBITRARY_NAVIGATION,
      looped: false,
      collisionDomains: [KeyboardShortcutCollisionDomain.ARBITRARY_NAVIGATION],
    },
    [ArbitraryControllerNavigationConfigKeyboardShortcuts.DECREASE_MOVE_VALUE]: {
      description: "Decrease move value",
      domain: KeyboardShortcutDomain.ARBITRARY_NAVIGATION,
      looped: false,
      collisionDomains: [KeyboardShortcutCollisionDomain.ARBITRARY_NAVIGATION],
    },
  };

// TODOM Default & meta info

// ----- combined objects, types and so on -------------------
export const ALL_HANDLER_IDS = [
  ...Object.values(GeneralKeyboardShortcuts),
  ...Object.values(GeneralEditingKeyboardShortcuts),
] as const;

export const ALL_KEYBOARD_SHORTCUT_META_INFOS = {
  ...GeneralKeyboardShortcutMetaInfo,
  ...GeneralEditingKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationConfigKeyboardShortcutMetaInfo,
};
