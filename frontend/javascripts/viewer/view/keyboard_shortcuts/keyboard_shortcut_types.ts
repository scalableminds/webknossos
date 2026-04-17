import type { KeyboardLoopHandler, KeyboardNoLoopHandler } from "libs/input";

export enum KeyboardShortcutDomain {
  GENERAL = "General",
  GENERAL_EDITING = "General Editing",
  GENERAL_LAYOUT = "Layout",
  GENERAL_COMMENT_TAB = "Comment Tab",
  ARBITRARY_NAVIGATION = "Navigation in Arbitrary Mode",
  ARBITRARY_EDITING = "Editing in Arbitrary Mode",
  PLANE_NAVIGATION = "Navigation",
  PLANE_CONFIGURATIONS = "Change Configurations",
  PLANE_TOOL_SWITCHING = "Tool Switching",
  PLANE_SKELETON_TOOL = "Skeleton Tool",
  PLANE_VOLUME_TOOL = "Volume Tools",
  PLANE_BOUNDING_BOX_TOOL = "Bounding Box Tool",
  PLANE_PROOFREADING_TOOL = "Proofreading Tool",
}

// Default is general -> colliding with all other shortcuts.
export enum KeyboardShortcutCollisionEntityName {
  GENERAL = "general",
  ARBITRARY_MODE = "arbitrary_mode",
  PLANE_MODE = "plane_mode",
  PLANE_SKELETON_TOOL = "skeleton_tool_plane",
  PLANE_VOLUME_TOOL = "volume_tool_plane",
  PLANE_BOUNDING_BOX_TOOL = "bounding_box_tool_plane",
  PLANE_PROOFREADING_TOOL = "proofreading_tool_plane",
}

export type ComparableKeyboardCombo = string[];
export type KeyboardComboChain = ComparableKeyboardCombo[];
export type KeyboardShortcutsMap<KeyboardShortcutHandlerId extends string> = Record<
  KeyboardShortcutHandlerId,
  KeyboardComboChain[]
>;

export type KeyboardShortcutMetaInfo = {
  description: string;
  // looped is per default false.
  looped?: boolean;
  domain: KeyboardShortcutDomain;
  // No collision domain means colliding with all shortcuts.
  collisionEntityName: KeyboardShortcutCollisionEntityName;
};

export type KeyboardShortcutHandlerMetaInfoMap<KeyboardShortcutHandlerId extends string> = Record<
  KeyboardShortcutHandlerId,
  KeyboardShortcutMetaInfo
>;

export type KeyboardShortcutNoLoopedHandlerMap<KeyboardShortcutHandlerId extends string> = Record<
  KeyboardShortcutHandlerId,
  // looped is per default false.
  KeyboardNoLoopHandler
>;
export type KeyboardShortcutLoopedHandlerMap<KeyboardShortcutHandlerId extends string> = Record<
  KeyboardShortcutHandlerId,
  // looped is per default false.
  KeyboardLoopHandler
>;
