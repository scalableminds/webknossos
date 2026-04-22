import {
  KeyboardShortcutCollisionEntityName,
  KeyboardShortcutDomain,
  type KeyboardShortcutHandlerMetaInfoMap,
  type KeyboardShortcutMetaInfo,
  type KeyboardShortcutsMap,
} from "../keyboard_shortcut_types";

export enum PlaneSkeletonToolNoLoopedKeyboardShortcuts {
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

export const DEFAULT_PLANE_SKELETON_TOOL_NO_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneSkeletonToolNoLoopedKeyboardShortcuts> =
  {
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]: [[["1"]]],
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]: [[["2"]]],
    // Delete active node
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: [
      [["Delete"]],
      [["Backspace"]],
    ],
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.CREATE_TREE_PLANE]: [[["c"]]],
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION]: [[["e"]]],
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]: [[["r"]]],
    // Branches
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: [[["b"]]],
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: [[["j"]]],
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]: [[["s"]]],
    // navigate nodes
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.NEXT_NODE_BACKWARD_PLANE]: [[["Control", ","]]],
    [PlaneSkeletonToolNoLoopedKeyboardShortcuts.NEXT_NODE_FORWARD_PLANE]: [[["Control", "."]]],
  };

export const PlaneSkeletonToolNoLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneSkeletonToolNoLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneSkeletonToolNoLoopedKeyboardShortcuts, string> = {
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.TOGGLE_ALL_TREES_PLANE]:
        "Toggle visibility of all trees",
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.TOGGLE_INACTIVE_TREES_PLANE]:
        "Toggle visibility of non-active trees (exclude active tree / group)",
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.DELETE_ACTIVE_NODE_PLANE]: "Delete Active Node",
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.CREATE_TREE_PLANE]: "Create new Tree",
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION]:
        "Move along annotation direction",
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.MOVE_ALONG_DIRECTION_REVERSED]:
        "Move backward annotation direction",
      // Branches
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.CREATE_BRANCH_POINT_PLANE]: "Create branch point",
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.DELETE_BRANCH_POINT_PLANE]: "Delete branch point",
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.RECENTER_ACTIVE_NODE_PLANE]:
        "Recenter active node",
      // navigate nodes
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.NEXT_NODE_BACKWARD_PLANE]:
        "Activate Previous Node",
      [PlaneSkeletonToolNoLoopedKeyboardShortcuts.NEXT_NODE_FORWARD_PLANE]: "Activate Next Node",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.PLANE_SKELETON_TOOL,
              collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_SKELETON_TOOL,
            },
          ] as [PlaneSkeletonToolNoLoopedKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneSkeletonToolNoLoopedKeyboardShortcuts>;
  })();

export enum PlaneSkeletonToolLoopedKeyboardShortcuts {
  MOVE_NODE_LEFT = "MOVE_NODE_LEFT",
  MOVE_NODE_RIGHT = "MOVE_NODE_RIGHT",
  MOVE_NODE_UP = "MOVE_NODE_UP",
  MOVE_NODE_DOWN = "MOVE_NODE_DOWN",
}

export const DEFAULT_PLANE_SKELETON_TOOL_LOOPED_KEYBOARD_SHORTCUTS: KeyboardShortcutsMap<PlaneSkeletonToolLoopedKeyboardShortcuts> =
  {
    [PlaneSkeletonToolLoopedKeyboardShortcuts.MOVE_NODE_LEFT]: [[["Control", "ArrowLeft"]]],
    [PlaneSkeletonToolLoopedKeyboardShortcuts.MOVE_NODE_RIGHT]: [[["Control", "ArrowRight"]]],
    [PlaneSkeletonToolLoopedKeyboardShortcuts.MOVE_NODE_UP]: [[["Control", "ArrowUp"]]],
    [PlaneSkeletonToolLoopedKeyboardShortcuts.MOVE_NODE_DOWN]: [[["Control", "ArrowDown"]]],
  };

export const PlaneSkeletonToolLoopedKeyboardShortcutMetaInfo: KeyboardShortcutHandlerMetaInfoMap<PlaneSkeletonToolLoopedKeyboardShortcuts> =
  (() => {
    const withDescription: Record<PlaneSkeletonToolLoopedKeyboardShortcuts, string> = {
      [PlaneSkeletonToolLoopedKeyboardShortcuts.MOVE_NODE_LEFT]: "Move active node left",
      [PlaneSkeletonToolLoopedKeyboardShortcuts.MOVE_NODE_RIGHT]: "Move active node right",
      [PlaneSkeletonToolLoopedKeyboardShortcuts.MOVE_NODE_UP]: "Move active node up",
      [PlaneSkeletonToolLoopedKeyboardShortcuts.MOVE_NODE_DOWN]: "Move active node down",
    };
    return Object.fromEntries(
      Object.entries(withDescription).map(
        ([handlerId, description]) =>
          [
            handlerId,
            {
              description,
              domain: KeyboardShortcutDomain.PLANE_SKELETON_TOOL,
              collisionEntityName: KeyboardShortcutCollisionEntityName.PLANE_SKELETON_TOOL,
            },
          ] as [PlaneSkeletonToolNoLoopedKeyboardShortcuts, KeyboardShortcutMetaInfo],
      ),
    ) as KeyboardShortcutHandlerMetaInfoMap<PlaneSkeletonToolLoopedKeyboardShortcuts>;
  })();
