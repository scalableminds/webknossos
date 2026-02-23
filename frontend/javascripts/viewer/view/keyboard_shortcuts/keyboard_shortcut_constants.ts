import {
  type KeyboardShortcutsMap,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutMetaInfo,
  KeyboardShortcutCollisionDomain,
} from "./keyboard_shortcut_types";
import { cloneDeep } from "lodash-es";
import type { Mutable } from "types/globals";
import {
  ArbitraryControllerNavigationKeyboardShortcuts,
  ArbitraryControllerNavigationConfigKeyboardShortcuts,
  ArbitraryControllerNoLoopKeyboardShortcuts,
  ArbitraryNavigationKeyboardShortcutMetaInfo,
  ArbitraryNavigationConfigKeyboardShortcutMetaInfo,
  ArbitraryNoLoopKeyboardShortcutMetaInfo,
  DEFAULT_ARBITRARY_NAVIGATION_CONFIG_KEYBOARD_SHORTCUTS,
  DEFAULT_ARBITRARY_NO_LOOP_KEYBOARD_SHORTCUTS,
  DEFAULT_ARBITRARY_NAVIGATION_KEYBOARD_SHORTCUTS,
} from "./arbitrary_mode_keyboard_shortcut_constants";
import {
  PlaneBoundingBoxNoLoopedKeyboardShortcuts,
  PlaneBoundingBoxNoLoopedKeyboardShortcutMetaInfo,
  DEFAULT_PLANE_NO_LOOPED_BOUNDING_BOX_KEYBOARD_SHORTCUTS,
} from "./plane_mode/bounding_box_tool_shortcut_constants";
import {
  PlaneControllerLoopedNavigationKeyboardShortcuts,
  PlaneControllerLoopDelayedNavigationKeyboardShortcuts,
  PlaneNavigationKeyboardShortcutMetaInfo,
  PlaneLoopDelayedNavigationKeyboardShortcutMetaInfo,
  DEFAULT_PLANE_LOOPED_NAVIGATION_KEYBOARD_SHORTCUTS,
  DEFAULT_PLANE_LOOP_DELAYED_NAVIGATION_KEYBOARD_SHORTCUTS,
  PlaneControllerNoLoopGeneralKeyboardShortcuts,
  DEFAULT_PLANE_NO_LOOPED_GENERAL_KEYBOARD_SHORTCUTS,
  PlaneGeneralKeyboardShortcutMetaInfo,
} from "./plane_mode/general_keyboard_shortcuts_constants";
import {
  PlaneProofreadingNoLoopedKeyboardShortcuts,
  PlaneProofreadingNoLoopedKeyboardShortcutMetaInfo,
  DEFAULT_PLANE_NO_LOOPED_PROOFREADING_KEYBOARD_SHORTCUTS,
} from "./plane_mode/proofreading_tool_shortcut_constants";
import {
  PlaneSkeletonLoopedKeyboardShortcuts,
  PlaneSkeletonNoLoopedKeyboardShortcuts,
  PlaneSkeletonNoLoopedKeyboardShortcutMetaInfo,
  PlaneSkeletonLoopedKeyboardShortcutMetaInfo,
  DEFAULT_PLANE_NO_LOOPED_SKELETON_KEYBOARD_SHORTCUTS,
  DEFAULT_PLANE_LOOPED_SKELETON_KEYBOARD_SHORTCUTS,
} from "./plane_mode/skeleton_tool_shortcut_constants";
import {
  PlaneControllerLoopDelayedConfigKeyboardShortcuts,
  PlaneVolumeNoLoopedKeyboardShortcuts,
  PlaneLoopDelayedConfigKeyboardShortcutMetaInfo,
  PlaneVolumeNoLoopedKeyboardShortcutMetaInfo,
  DEFAULT_PLANE_LOOP_DELAYED_CONFIG_KEYBOARD_SHORTCUTS,
  DEFAULT_PLANE_NO_LOOPED_VOLUME_KEYBOARD_SHORTCUTS,
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
  ...Object.values(PlaneControllerNoLoopGeneralKeyboardShortcuts),
  ...Object.values(PlaneSkeletonLoopedKeyboardShortcuts),
  ...Object.values(PlaneSkeletonNoLoopedKeyboardShortcuts),
  ...Object.values(PlaneVolumeNoLoopedKeyboardShortcuts),
  ...Object.values(PlaneBoundingBoxNoLoopedKeyboardShortcuts),
  ...Object.values(PlaneProofreadingNoLoopedKeyboardShortcuts),
] as const;

export const ALL_KEYBOARD_SHORTCUT_META_INFOS = {
  ...GeneralKeyboardShortcutMetaInfo,
  ...GeneralEditingKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationKeyboardShortcutMetaInfo,
  ...ArbitraryNavigationConfigKeyboardShortcutMetaInfo,
  ...ArbitraryNoLoopKeyboardShortcutMetaInfo,
  ...PlaneNavigationKeyboardShortcutMetaInfo,
  ...PlaneLoopDelayedNavigationKeyboardShortcutMetaInfo,
  ...PlaneSkeletonNoLoopedKeyboardShortcutMetaInfo,
  ...PlaneGeneralKeyboardShortcutMetaInfo,
  ...PlaneLoopDelayedConfigKeyboardShortcutMetaInfo,
  ...PlaneSkeletonLoopedKeyboardShortcutMetaInfo,
  ...PlaneVolumeNoLoopedKeyboardShortcutMetaInfo,
  ...PlaneBoundingBoxNoLoopedKeyboardShortcutMetaInfo,
  ...PlaneProofreadingNoLoopedKeyboardShortcutMetaInfo,
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
  ...DEFAULT_PLANE_NO_LOOPED_GENERAL_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_NO_LOOPED_SKELETON_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_LOOPED_SKELETON_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_NO_LOOPED_VOLUME_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_NO_LOOPED_BOUNDING_BOX_KEYBOARD_SHORTCUTS,
  ...DEFAULT_PLANE_NO_LOOPED_PROOFREADING_KEYBOARD_SHORTCUTS,
} as const;

export function getAllDefaultKeyboardShortcuts(): Mutable<typeof ALL_KEYBOARD_SHORTCUT_DEFAULTS> {
  return cloneDeep(ALL_KEYBOARD_SHORTCUT_DEFAULTS);
}
