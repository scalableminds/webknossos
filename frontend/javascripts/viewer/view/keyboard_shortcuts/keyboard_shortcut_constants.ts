import { cloneDeep } from "lodash-es";
import type { Mutable } from "types/globals";
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
  KeyboardShortcutCollisionDomain,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutMetaInfo,
  type KeyboardShortcutsMap,
} from "./keyboard_shortcut_types";
import {
  DEFAULT_ORTHO_BOUNDING_BOX_NO_LOOPED_KEYBOARD_SHORTCUTS,
  OrthoBoundingBoxNoLoopedKeyboardShortcutMetaInfo,
  OrthoBoundingBoxNoLoopedKeyboardShortcuts,
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
  DEFAULT_ORTHO_PROOFREADING_NO_LOOPED_KEYBOARD_SHORTCUTS,
  OrthoProofreadingNoLoopedKeyboardShortcutMetaInfo,
  OrthoProofreadingNoLoopedKeyboardShortcuts,
} from "./plane_mode/proofreading_tool_shortcut_constants";
import {
  DEFAULT_ORTHO_SKELETON_LOOPED_KEYBOARD_SHORTCUTS,
  DEFAULT_ORTHO_SKELETON_NO_LOOPED_KEYBOARD_SHORTCUTS,
  OrthoSkeletonLoopedKeyboardShortcutMetaInfo,
  OrthoSkeletonLoopedKeyboardShortcuts,
  OrthoSkeletonNoLoopedKeyboardShortcutMetaInfo,
  OrthoSkeletonNoLoopedKeyboardShortcuts,
} from "./plane_mode/skeleton_tool_shortcut_constants";
import {
  DEFAULT_ORTHO_VOLUME_LOOP_DELAYED_CONFIG_KEYBOARD_SHORTCUTS,
  DEFAULT_ORTHO_VOLUME_NO_LOOPED_KEYBOARD_SHORTCUTS,
  OrthoVolumeLoopDelayedConfigKeyboardShortcutMetaInfo,
  OrthoVolumeLoopDelayedConfigKeyboardShortcuts,
  OrthoVolumeNoLoopedKeyboardShortcutMetaInfo,
  OrthoVolumeNoLoopedKeyboardShortcuts,
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
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_PLANE]: [[["shift", "1"]]],
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY]: [[["shift", "2"]]],
  [GeneralKeyboardShortcuts.SWITCH_VIEWMODE_ARBITRARY_PLANE]: [[["shift", "3"]]],
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
          [handlerId, { description, domain: KeyboardShortcutDomain.GENERAL, looped: false }] as [
            GeneralKeyboardShortcuts,
            KeyboardShortcutMetaInfo,
          ],
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
    [GeneralEditingKeyboardShortcuts.SAVE]: [[["super", "s"]], [["ctrl", "s"]]],
    [GeneralEditingKeyboardShortcuts.UNDO]: [[["super", "z"]], [["ctrl", "z"]]],
    [GeneralEditingKeyboardShortcuts.REDO]: [[["super", "y"]], [["ctrl", "y"]]],
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
              collisionDomains: [KeyboardShortcutCollisionDomain.GENERAL],
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
              domain: KeyboardShortcutDomain.GENERAL_EDITING,
              looped: false,
              collisionDomains: [KeyboardShortcutCollisionDomain.GENERAL],
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
              domain: KeyboardShortcutDomain.GENERAL_EDITING,
              looped: false,
              collisionDomains: [KeyboardShortcutCollisionDomain.GENERAL],
            },
          ] as [CommentsTabKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<CommentsTabKeyboardShortcuts>;
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
  ...Object.values(OrthoVolumeLoopDelayedConfigKeyboardShortcuts),
  ...Object.values(PlaneControllerNoLoopGeneralKeyboardShortcuts),
  ...Object.values(OrthoSkeletonLoopedKeyboardShortcuts),
  ...Object.values(OrthoSkeletonNoLoopedKeyboardShortcuts),
  ...Object.values(OrthoVolumeNoLoopedKeyboardShortcuts),
  ...Object.values(OrthoBoundingBoxNoLoopedKeyboardShortcuts),
  ...Object.values(OrthoProofreadingNoLoopedKeyboardShortcuts),
] as const;

export const ALL_KEYBOARD_SHORTCUT_META_INFOS = {
  ...GeneralKeyboardShortcutMetaInfo,
  ...GeneralEditingKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationConfigKeyboardShortcutMetaInfo,
  ...ArbitraryNoLoopKeyboardShortcutMetaInfo,
  ...PlaneNavigationKeyboardShortcutMetaInfo,
  ...PlaneLoopDelayedNavigationKeyboardShortcutMetaInfo,
  ...OrthoSkeletonNoLoopedKeyboardShortcutMetaInfo,
  ...PlaneGeneralKeyboardShortcutMetaInfo,
  ...OrthoVolumeLoopDelayedConfigKeyboardShortcutMetaInfo,
  ...OrthoSkeletonLoopedKeyboardShortcutMetaInfo,
  ...OrthoVolumeNoLoopedKeyboardShortcutMetaInfo,
  ...OrthoBoundingBoxNoLoopedKeyboardShortcutMetaInfo,
  ...OrthoProofreadingNoLoopedKeyboardShortcutMetaInfo,
};

const ALL_KEYBOARD_SHORTCUT_DEFAULTS = {
  ...DEFAULT_GENERAL_KEYBOARD_SHORTCUTS,
  ...DEFAULT_GENERAL_EDITING_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ARBITRARY_NAVIGATION_CONFIG_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ARBITRARY_NO_LOOP_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ARBITRARY_NAVIGATION_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_LOOPED_NAVIGATION_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_LOOP_DELAYED_NAVIGATION_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ORTHO_VOLUME_LOOP_DELAYED_CONFIG_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_NO_LOOPED_GENERAL_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ORTHO_SKELETON_NO_LOOPED_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ORTHO_SKELETON_LOOPED_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ORTHO_VOLUME_NO_LOOPED_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ORTHO_BOUNDING_BOX_NO_LOOPED_KEYBOARD_SHORTCUTS,
  ...DEFAULT_ORTHO_PROOFREADING_NO_LOOPED_KEYBOARD_SHORTCUTS,
} as const;

export function getAllDefaultKeyboardShortcuts(): Mutable<typeof ALL_KEYBOARD_SHORTCUT_DEFAULTS> {
  return cloneDeep(ALL_KEYBOARD_SHORTCUT_DEFAULTS);
}
