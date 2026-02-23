import { KeyboardHandler, KeyboardLoopHandler } from "libs/input";

export enum KeyboardShortcutDomain {
  GENERAL = "General",
  GENERAL_EDITING = "General Editing",
  ARBITRARY_NAVIGATION = "Navigation in Arbitrary Mode",
  ARBITRARY_EDITING = "Editing in Arbitrary Mode",
  PLANE_NAVIGATION = "Navigation in Plane Mode",
  PLANE_CONFIGURATIONS = "Change Configurations in Plane Mode",
  PLANE_SKELETON_TOOL = "Skeleton Tool Shortcuts in Plane Mode",
  PLANE_VOLUME_TOOL = "Volume Tools Shortcuts in Plane Mode",
  PLANE_BOUNDING_BOX_TOOL = "Bounding Box Tool Shortcuts in Plane Mode",
  PLANE_PROOFREADING_TOOL = "Proofreading Tool Shortcuts in Plane Mode",
}

// Default is general -> colliding with all other shortcuts.
export enum KeyboardShortcutCollisionDomain {
  GENERAL = "general",
  MOVE_TOOL = "move_tool",
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
