import { cloneDeep } from "lodash-es";
import type { Mutable } from "types/type_utils";
import {
  ArbitraryControllerNavigationConfigKeyboardShortcuts,
  ArbitraryControllerNavigationKeyboardShortcuts,
  ArbitraryControllerNoLoopKeyboardShortcuts,
  ArbitraryNavigationConfigKeyboardShortcutMetaInfo,
  ArbitraryNavigationKeyboardShortcutMetaInfo,
  ArbitraryNoLoopKeyboardShortcutMetaInfo,
  DEFAULT_ARBITRARY_NAVIGATION_CONFIG_KEYBOARD_SHORTCUTS,
  DEFAULT_ARBITRARY_NAVIGATION_KEYBOARD_SHORTCUTS,
  DEFAULT_ARBITRARY_NO_LOOP_KEYBOARD_SHORTCUTS,
} from "./arbitrary_mode_keyboard_shortcut_constants";
import {
  KeyboardShortcutCollisionEntityName,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutMetaInfo,
  type KeyboardShortcutsMap,
} from "./keyboard_shortcut_types";
import {
  DEFAULT_PLANE_BOUNDING_BOX_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS,
  PlaneBoundingBoxToolNoLoopedKeyboardShortcutMetaInfo,
  PlaneBoundingBoxToolNoLoopedKeyboardShortcuts,
} from "./plane_mode/bounding_box_tool_shortcut_constants";
import {
  DEFAULT_PLANE_LOOP_DELAYED_NAVIGATION_KEYBOARD_SHORTCUTS,
  DEFAULT_PLANE_LOOPED_NAVIGATION_KEYBOARD_SHORTCUTS,
  DEFAULT_PLANE_NO_LOOPED_GENERAL_KEYBOARD_SHORTCUTS,
  PlaneControllerLoopDelayedNavigationKeyboardShortcuts,
  PlaneControllerLoopedNavigationKeyboardShortcuts,
  PlaneControllerNoLoopGeneralKeyboardShortcuts,
  PlaneGeneralKeyboardShortcutMetaInfo,
  PlaneLoopDelayedNavigationKeyboardShortcutMetaInfo,
  PlaneNavigationKeyboardShortcutMetaInfo,
} from "./plane_mode/general_keyboard_shortcuts_constants";
import {
  DEFAULT_PLANE_PROOFREADING_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS,
  PlaneProofreadingToolNoLoopedKeyboardShortcutMetaInfo,
  PlaneProofreadingToolNoLoopedKeyboardShortcuts,
} from "./plane_mode/proofreading_tool_shortcut_constants";
import {
  DEFAULT_PLANE_SKELETON_TOOL_LOOPED_KEYBOARD_SHORTCUTS,
  DEFAULT_PLANE_SKELETON_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS,
  PlaneSkeletonToolLoopedKeyboardShortcutMetaInfo,
  PlaneSkeletonToolLoopedKeyboardShortcuts,
  PlaneSkeletonToolNoLoopedKeyboardShortcutMetaInfo,
  PlaneSkeletonToolNoLoopedKeyboardShortcuts,
} from "./plane_mode/skeleton_tool_shortcut_constants";
import {
  DEFAULT_PLANE_TOOL_SWITCHING_KEYBOARD_SHORTCUTS,
  PlaneControllerToolSwitchingKeyboardShortcuts,
  PlaneToolSwitchingKeyboardShortcutMetaInfo,
} from "./plane_mode/tool_switching_shortcut_constants";
import {
  DEFAULT_PLANE_VOLUME_TOOL_LOOP_DELAYED_CONFIG_KEYBOARD_SHORTCUTS,
  DEFAULT_PLANE_VOLUME_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS,
  PlaneVolumeToolLoopDelayedConfigKeyboardShortcutMetaInfo,
  PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts,
  PlaneVolumeToolNoLoopedKeyboardShortcutMetaInfo,
  PlaneVolumeToolNoLoopedKeyboardShortcuts,
} from "./plane_mode/volume_tools_shortcut_constants";

// ----------------------------------------------------- Shortcuts used by controller.ts -----------------------------------------------------------------
export enum GeneralKeyboardShortcuts {
  SWITCH_VIEWMODE_PLANE = "SWITCH_VIEWMODE_PLANE",
  SWITCH_VIEWMODE_ARBITRARY = "SWITCH_VIEWMODE_ARBITRARY",
  SWITCH_VIEWMODE_ARBITRARY_PLANE = "SWITCH_VIEWMODE_ARBITRARY_PLANE",
  CYCLE_VIEWMODE = "CYCLE_VIEWMODE",
  TOGGLE_SEGMENTATION = "TOGGLE_SEGMENTATION",
}

export const DEFAULT_GENERAL_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<GeneralKeyboardShortcuts> = {
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_PLANE]: [[["Shift", "1"]]],
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY]: [[["Shift", "2"]]],
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY_PLANE]: [[["Shift", "3"]]],
  [GeneralKeyboardShortcuts.CYCLE_VIEWMODE]: [[["m"]]],
  [GeneralKeyboardShortcuts.TOGGLE_SEGMENTATION]: [[["3"]]],
} as const;

const GeneralKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<GeneralKeyboardShortcuts> =
  (() => {
    const withDescription: Record<GeneralKeyboardShortcuts, string> = {
      [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_PLANE]: "View in plane mode",
      [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY]: "View in plane arbitrary mode",
      [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY_PLANE]:
        "View in plane arbitrary plane mode",
      [GeneralKeyboardShortcuts.CYCLE_VIEWMODE]: "Cycle through viewing modes",
      [GeneralKeyboardShortcuts.TOGGLE_SEGMENTATION]: "Toggle segmentation layer",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.GENERAL,
              looped: false,
              collisionEntityName: KeyboardShortcutCollisionEntityName.GENERAL,
            },
          ] as [GeneralKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<GeneralKeyboardShortcuts>;
  })();

export enum GeneralEditingKeyboardShortcuts {
  SAVE = "SAVE",
  UNDO = "UNDO",
  REDO = "REDO",
}

export const DEFAULT_GENERAL_EDITING_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<GeneralEditingKeyboardShortcuts> =
  {
    [GeneralEditingKeyboardShortcuts.SAVE]: [[["Meta", "s"]], [["Control", "s"]]],
    [GeneralEditingKeyboardShortcuts.UNDO]: [[["Meta", "z"]], [["Control", "z"]]],
    [GeneralEditingKeyboardShortcuts.REDO]: [[["Meta", "y"]], [["Control", "y"]]],
  } as const;

const GeneralEditingKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<GeneralEditingKeyboardShortcuts> =
  (() => {
    const withDescription: Record<GeneralEditingKeyboardShortcuts, string> = {
      [GeneralEditingKeyboardShortcuts.SAVE]: "Save annotation changes",
      [GeneralEditingKeyboardShortcuts.UNDO]: "Undo latest annotation change",
      [GeneralEditingKeyboardShortcuts.REDO]: "Redo latest annotation change",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.GENERAL_EDITING,
              looped: false,
              collisionEntityName: KeyboardShortcutCollisionEntityName.GENERAL,
            },
          ] as [GeneralEditingKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<GeneralEditingKeyboardShortcuts>;
  })();

export enum GeneralLayoutKeyboardShortcuts {
  MAXIMIZE = "MAXIMIZE",
  TOGGLE_LEFT_BORDER = "TOGGLE_LEFT_BORDER",
  TOGGLE_RIGHT_BORDER = "TOGGLE_RIGHT_BORDER",
}

export const DEFAULT_GENERAL_LAYOUT_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<GeneralLayoutKeyboardShortcuts> =
  {
    [GeneralLayoutKeyboardShortcuts.MAXIMIZE]: [[["."]]],
    [GeneralLayoutKeyboardShortcuts.TOGGLE_LEFT_BORDER]: [[["k"]]],
    [GeneralLayoutKeyboardShortcuts.TOGGLE_RIGHT_BORDER]: [[["l"]]],
  } as const;

export const GeneralLayoutKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<GeneralLayoutKeyboardShortcuts> =
  (() => {
    const withDescription: Record<GeneralLayoutKeyboardShortcuts, string> = {
      [GeneralLayoutKeyboardShortcuts.MAXIMIZE]: "Toggle Viewport Maximization",
      [GeneralLayoutKeyboardShortcuts.TOGGLE_LEFT_BORDER]: "Toggle left Sidebars",
      [GeneralLayoutKeyboardShortcuts.TOGGLE_RIGHT_BORDER]: "Toggle right Sidebars",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.GENERAL_LAYOUT,
              looped: false,
              collisionEntityName: KeyboardShortcutCollisionEntityName.GENERAL,
            },
          ] as [GeneralLayoutKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<GeneralLayoutKeyboardShortcuts>;
  })();

export enum CommentsTabKeyboardShortcuts {
  NEXT_COMMENT = "NEXT_COMMENT",
  PREVIOUS_COMMENT = "PREVIOUS_COMMENT",
}

export const DEFAULT_COMMENTS_TAB_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<CommentsTabKeyboardShortcuts> =
  {
    [CommentsTabKeyboardShortcuts.NEXT_COMMENT]: [[["n"]]],
    [CommentsTabKeyboardShortcuts.PREVIOUS_COMMENT]: [[["p"]]],
  } as const;

export const CommentsTabKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<CommentsTabKeyboardShortcuts> =
  (() => {
    const withDescription: Record<CommentsTabKeyboardShortcuts, string> = {
      [CommentsTabKeyboardShortcuts.NEXT_COMMENT]: "Select next comment",
      [CommentsTabKeyboardShortcuts.PREVIOUS_COMMENT]: "Select previous comment",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.GENERAL_COMMENT_TAB,
              looped: false,
              collisionEntityName: KeyboardShortcutCollisionEntityName.GENERAL,
            },
          ] as [CommentsTabKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<CommentsTabKeyboardShortcuts>;
  })();

// Defining the collision domains in a hierarchical tree like order.
// KeyboardShortcutCollisionEntityName.GENERAL is the root from where traversing should be done to get all collision entity names to compare with.

// The hierarchy is:
//             General
//          /           \
//         /             \
// Arbitrary            Plane
//                 /       |      \
//                /        |       \
//         MoveTool   Skeleton Tool  ()...all other tools)
export const KeyboardShortcutCollisionHierarchy: Record<
  KeyboardShortcutCollisionEntityName,
  KeyboardShortcutCollisionEntityName[]
> = {
  [KeyboardShortcutCollisionEntityName.GENERAL]: [
    KeyboardShortcutCollisionEntityName.ARBITRARY_MODE,
    KeyboardShortcutCollisionEntityName.PLANE_MODE,
  ],
  [KeyboardShortcutCollisionEntityName.ARBITRARY_MODE]: [],
  [KeyboardShortcutCollisionEntityName.PLANE_MODE]: [
    KeyboardShortcutCollisionEntityName.PLANE_SKELETON_TOOL,
    KeyboardShortcutCollisionEntityName.PLANE_VOLUME_TOOL,
    KeyboardShortcutCollisionEntityName.PLANE_BOUNDING_BOX_TOOL,
    KeyboardShortcutCollisionEntityName.PLANE_PROOFREADING_TOOL,
  ],
  [KeyboardShortcutCollisionEntityName.PLANE_SKELETON_TOOL]: [],
  [KeyboardShortcutCollisionEntityName.PLANE_VOLUME_TOOL]: [],
  [KeyboardShortcutCollisionEntityName.PLANE_BOUNDING_BOX_TOOL]: [],
  [KeyboardShortcutCollisionEntityName.PLANE_PROOFREADING_TOOL]: [],
};

// ----- combined objects, types and so on -------------------
export const ALL_KEYBOARD_HANDLER_IDS = [
  ...Object.values(GeneralKeyboardShortcuts),
  ...Object.values(GeneralEditingKeyboardShortcuts),
  ...Object.values(GeneralLayoutKeyboardShortcuts),
  ...Object.values(CommentsTabKeyboardShortcuts),
  ...Object.values(ArbitraryControllerNavigationKeyboardShortcuts),
  ...Object.values(ArbitraryControllerNavigationConfigKeyboardShortcuts),
  ...Object.values(ArbitraryControllerNoLoopKeyboardShortcuts),
  ...Object.values(PlaneControllerLoopedNavigationKeyboardShortcuts),
  ...Object.values(PlaneControllerLoopDelayedNavigationKeyboardShortcuts),
  ...Object.values(PlaneControllerNoLoopGeneralKeyboardShortcuts),
  ...Object.values(PlaneControllerToolSwitchingKeyboardShortcuts),
  ...Object.values(PlaneSkeletonToolLoopedKeyboardShortcuts),
  ...Object.values(PlaneSkeletonToolNoLoopedKeyboardShortcuts),
  ...Object.values(PlaneVolumeToolNoLoopedKeyboardShortcuts),
  ...Object.values(PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts),
  ...Object.values(PlaneBoundingBoxToolNoLoopedKeyboardShortcuts),
  ...Object.values(PlaneProofreadingToolNoLoopedKeyboardShortcuts),
] as const;

export type AnyKeyboardHandlerId =
  | GeneralKeyboardShortcuts
  | GeneralEditingKeyboardShortcuts
  | GeneralLayoutKeyboardShortcuts
  | CommentsTabKeyboardShortcuts
  | ArbitraryControllerNavigationKeyboardShortcuts
  | ArbitraryControllerNavigationConfigKeyboardShortcuts
  | ArbitraryControllerNoLoopKeyboardShortcuts
  | PlaneControllerLoopedNavigationKeyboardShortcuts
  | PlaneControllerLoopDelayedNavigationKeyboardShortcuts
  | PlaneControllerNoLoopGeneralKeyboardShortcuts
  | PlaneControllerToolSwitchingKeyboardShortcuts
  | PlaneSkeletonToolLoopedKeyboardShortcuts
  | PlaneSkeletonToolNoLoopedKeyboardShortcuts
  | PlaneVolumeToolNoLoopedKeyboardShortcuts
  | PlaneVolumeToolLoopDelayedConfigKeyboardShortcuts
  | PlaneBoundingBoxToolNoLoopedKeyboardShortcuts
  | PlaneProofreadingToolNoLoopedKeyboardShortcuts;

export const ALL_KEYBOARD_SHORTCUT_META_INFOS: KeyboardShortcutHandlerMetaInfoMap<string> = {
  ...GeneralKeyboardShortcutMetaInfo,
  ...GeneralEditingKeyboardShortcutMetaInfo,
  ...GeneralLayoutKeyboardShortcutMetaInfo,
  ...CommentsTabKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationConfigKeyboardShortcutMetaInfo,
  ...ArbitraryNoLoopKeyboardShortcutMetaInfo,
  ...PlaneNavigationKeyboardShortcutMetaInfo,
  ...PlaneLoopDelayedNavigationKeyboardShortcutMetaInfo,
  ...PlaneGeneralKeyboardShortcutMetaInfo,
  ...PlaneToolSwitchingKeyboardShortcutMetaInfo,
  ...PlaneSkeletonToolNoLoopedKeyboardShortcutMetaInfo,
  ...PlaneSkeletonToolLoopedKeyboardShortcutMetaInfo,
  ...PlaneVolumeToolNoLoopedKeyboardShortcutMetaInfo,
  ...PlaneVolumeToolLoopDelayedConfigKeyboardShortcutMetaInfo,
  ...PlaneBoundingBoxToolNoLoopedKeyboardShortcutMetaInfo,
  ...PlaneProofreadingToolNoLoopedKeyboardShortcutMetaInfo,
};

const ALL_KEYBOARD_SHORTCUT_DEFAULTS = {
  ...DEFAULT_GENERAL_KEYBOARD_SHORTCUTS,
  ...DEFAULT_GENERAL_EDITING_KEYBOARD_SHORTCUTS,
  ...DEFAULT_GENERAL_LAYOUT_KEYBOARD_SHORTCUTS,
  ...DEFAULT_COMMENTS_TAB_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ARBITRARY_NAVIGATION_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ARBITRARY_NAVIGATION_CONFIG_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ARBITRARY_NO_LOOP_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_LOOPED_NAVIGATION_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_LOOP_DELAYED_NAVIGATION_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_NO_LOOPED_GENERAL_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_TOOL_SWITCHING_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_SKELETON_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_SKELETON_TOOL_LOOPED_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_VOLUME_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_VOLUME_TOOL_LOOP_DELAYED_CONFIG_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_BOUNDING_BOX_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_PROOFREADING_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS,
} as const;

export function getAllDefaultKeyboardShortcuts(): Mutable<typeof ALL_KEYBOARD_SHORTCUT_DEFAULTS> {
  return cloneDeep(ALL_KEYBOARD_SHORTCUT_DEFAULTS);
}
