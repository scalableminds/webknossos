import {
  KeyboardShortcutCollisionDomain,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum OrthoSkeletonNoLoopedKeyboardShortcuts {
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

export const DEFAULT_ORTHO_SKELETON_NO_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<OrthoSkeletonNoLoopedKeyboardShortcuts> =
  {
    [OrthoSkeletonNoLoopedKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]: [[["1"]]],
    [OrthoSkeletonNoLoopedKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]: [[["2"]]],
    // Delete active node
    [OrthoSkeletonNoLoopedKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: [
      [["delete"]],
      [["backspace"]],
    ],
    [OrthoSkeletonNoLoopedKeyboardShortcuts.CREATE_TREE_PLANE]: [[["c"]]],
    [OrthoSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION]: [[["e"]]],
    [OrthoSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]: [[["r"]]],
    // Branches
    [OrthoSkeletonNoLoopedKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: [[["b"]]],
    [OrthoSkeletonNoLoopedKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: [[["j"]]],
    [OrthoSkeletonNoLoopedKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]: [[["s"]]],
    // navigate nodes
    [OrthoSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_BACKWARD_PLANE]: [[["ctrl", ","]]],
    [OrthoSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_FORWARD_PLANE]: [[["ctrl", "."]]],
  };

export const OrthoSkeletonNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<OrthoSkeletonNoLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<OrthoSkeletonNoLoopedKeyboardShortcuts, string> = {
      [OrthoSkeletonNoLoopedKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]:
        "Toggle visibility of all trees",
      [OrthoSkeletonNoLoopedKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]:
        "Toggle visibility of hidden trees", // TODOM check if this is correct.
      [OrthoSkeletonNoLoopedKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: "Delete Active Node",
      [OrthoSkeletonNoLoopedKeyboardShortcuts.CREATE_TREE_PLANE]: "Create new Tree",
      [OrthoSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION]:
        "Move along annotation direction",
      [OrthoSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]:
        "Move backward annotation direction",
      // Branches
      [OrthoSkeletonNoLoopedKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: "Create branch point",
      [OrthoSkeletonNoLoopedKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: "Delete branch point",
      [OrthoSkeletonNoLoopedKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]: "Recenter active node",
      // navigate nodes
      [OrthoSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_BACKWARD_PLANE]: "Activate Previous Node",
      [OrthoSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_FORWARD_PLANE]: "Activate Next Node",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(([handlerId, description]) => [
        handlerId,
        {
          description,
          domain: KeyboardShortcutDomain.PLANE_SKELETON_TOOL,
          looped: false,
          collisionDomains: [
            KeyboardShortcutCollisionDomain.PLANE_MODE,
            KeyboardShortcutCollisionDomain.PLANE_SKELETON_TOOL,
          ],
        },
      ]),
    ) as KeyboardShortcutHandlerMetaInfoMap<OrthoSkeletonNoLoopedKeyboardShortcuts>;
  })();

export enum OrthoSkeletonLoopedKeyboardShortcuts {
  MOVE_NODE_LEFT = "MOVE_NODE_LEFT",
  MOVE_NODE_RIGHT = "MOVE_NODE_RIGHT",
  MOVE_NODE_UP = "MOVE_NODE_UP",
  MOVE_NODE_DOWN = "MOVE_NODE_DOWN",
}

export const DEFAULT_ORTHO_SKELETON_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<OrthoSkeletonLoopedKeyboardShortcuts> =
  {
    [OrthoSkeletonLoopedKeyboardShortcuts.MOVE_NODE_LEFT]: [[["ctrl", "left"]]],
    [OrthoSkeletonLoopedKeyboardShortcuts.MOVE_NODE_RIGHT]: [[["ctrl", "right"]]],
    [OrthoSkeletonLoopedKeyboardShortcuts.MOVE_NODE_UP]: [[["ctrl", "up"]]],
    [OrthoSkeletonLoopedKeyboardShortcuts.MOVE_NODE_DOWN]: [[["ctrl", "down"]]],
  };

export const OrthoSkeletonLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<OrthoSkeletonLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<OrthoSkeletonLoopedKeyboardShortcuts, string> = {
      [OrthoSkeletonLoopedKeyboardShortcuts.MOVE_NODE_LEFT]: "Move active node left",
      [OrthoSkeletonLoopedKeyboardShortcuts.MOVE_NODE_RIGHT]: "Move active node right",
      [OrthoSkeletonLoopedKeyboardShortcuts.MOVE_NODE_UP]: "Move active node up",
      [OrthoSkeletonLoopedKeyboardShortcuts.MOVE_NODE_DOWN]: "Move active node down",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(([handlerId, description]) => [
        handlerId,
        {
          description,
          domain: KeyboardShortcutDomain.PLANE_SKELETON_TOOL,
          looped: true,
          collisionDomains: [
            KeyboardShortcutCollisionDomain.PLANE_MODE,
            KeyboardShortcutCollisionDomain.PLANE_SKELETON_TOOL,
          ],
        },
      ]),
    ) as KeyboardShortcutHandlerMetaInfoMap<OrthoSkeletonLoopedKeyboardShortcuts>;
  })();
