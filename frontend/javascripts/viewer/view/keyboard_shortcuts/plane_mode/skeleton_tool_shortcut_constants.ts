import {
  type KeyboardShortcutsMap,
  type KeyboardShortcutHandlerMetaInfoMap,
  KeyboardShortcutDomain,
  KeyboardShortcutCollisionDomain,
} from "../keyboard_shortcut_types";

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

export const PlaneSkeletonNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneSkeletonNoLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneSkeletonNoLoopedKeyboardShortcuts, string> = {
      [PlaneSkeletonNoLoopedKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]:
        "Toggle visibility of all trees",
      [PlaneSkeletonNoLoopedKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]:
        "Toggle visibility of hidden trees", // TODOM check if this is correct.
      [PlaneSkeletonNoLoopedKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: "Delete Active Node",
      [PlaneSkeletonNoLoopedKeyboardShortcuts.CREATE_TREE_PLANE]: "Create new Tree",
      [PlaneSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION]:
        "Move along annotation direction",
      [PlaneSkeletonNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]:
        "Move backward annotation direction",
      // Branches
      [PlaneSkeletonNoLoopedKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: "Create branch point",
      [PlaneSkeletonNoLoopedKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: "Delete branch point",
      [PlaneSkeletonNoLoopedKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]: "Recenter active node",
      // navigate nodes
      [PlaneSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_BACKWARD_PLANE]: "Activate Previous Node",
      [PlaneSkeletonNoLoopedKeyboardShortcuts.NEXT_NODE_FORWARD_PLANE]: "Activate Next Node",
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
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneSkeletonNoLoopedKeyboardShortcuts>;
  })();

export enum PlaneSkeletonLoopedKeyboardShortcuts {
  MOVE_NODE_LEFT = "MOVE_NODE_LEFT",
  MOVE_NODE_RIGHT = "MOVE_NODE_RIGHT",
  MOVE_NODE_UP = "MOVE_NODE_UP",
  MOVE_NODE_DOWN = "MOVE_NODE_DOWN",
}

export const DEFAULT_PLANE_LOOPED_SKELETON_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneSkeletonLoopedKeyboardShortcuts> =
  {
    [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_LEFT]: [[["ctrl" + "left"]]],
    [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_RIGHT]: [[["ctrl" + "right"]]],
    [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_UP]: [[["ctrl" + "up"]]],
    [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_DOWN]: [[["ctrl" + "down"]]],
  };

export const PlaneSkeletonLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneSkeletonLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneSkeletonLoopedKeyboardShortcuts, string> = {
      [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_LEFT]: "Move active node left",
      [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_RIGHT]: "Move active node right",
      [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_UP]: "Move active node up",
      [PlaneSkeletonLoopedKeyboardShortcuts.MOVE_NODE_DOWN]: "Move active node down",
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
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneSkeletonLoopedKeyboardShortcuts>;
  })();
