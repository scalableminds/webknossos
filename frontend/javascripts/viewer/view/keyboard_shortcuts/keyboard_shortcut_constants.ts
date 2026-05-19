import { cloneDeep } from "lodash-es";
import { KeyboardShortcutMetaInfo, type KeyboardShortcutsMap } from "./keyboard_shortcut_types";

// All keyboard shortcut handler IDs across the entire application.
export type KeyboardShortcutId =
  // General
  | "SWITCH_VIEWMODE_PLANE"
  | "SWITCH_VIEWMODE_FLIGHT"
  | "CYCLE_VIEWMODE"
  | "TOGGLE_SEGMENTATION"
  | "SAVE"
  | "UNDO"
  | "REDO"
  | "MAXIMIZE"
  | "TOGGLE_LEFT_BORDER"
  | "TOGGLE_RIGHT_BORDER"
  | "NEXT_COMMENT"
  | "PREVIOUS_COMMENT"
  // Flight mode
  | "MOVE_FORWARD_WITH_RECORDING"
  | "MOVE_BACKWARD_WITH_RECORDING"
  | "MOVE_FORWARD_WITHOUT_RECORDING"
  | "MOVE_BACKWARD_WITHOUT_RECORDING"
  | "YAW_FLYCAM_POSITIVE_AT_CENTER"
  | "YAW_FLYCAM_INVERTED_AT_CENTER"
  | "PITCH_FLYCAM_POSITIVE_AT_CENTER"
  | "PITCH_FLYCAM_INVERTED_AT_CENTER"
  | "YAW_FLYCAM_POSITIVE_IN_DISTANCE"
  | "YAW_FLYCAM_INVERTED_IN_DISTANCE"
  | "PITCH_FLYCAM_POSITIVE_IN_DISTANCE"
  | "PITCH_FLYCAM_INVERTED_IN_DISTANCE"
  | "ZOOM_IN_FLIGHT"
  | "ZOOM_OUT_FLIGHT"
  | "INCREASE_MOVE_VALUE_FLIGHT"
  | "DECREASE_MOVE_VALUE_FLIGHT"
  | "DELETE_ACTIVE_NODE"
  | "CREATE_TREE_FLIGHT"
  | "CREATE_BRANCH_POINT_FLIGHT"
  | "DELETE_BRANCH_POINT_FLIGHT"
  | "RECENTER_ACTIVE_NODE_FLIGHT"
  | "NEXT_NODE_FORWARD_FLIGHT"
  | "NEXT_NODE_BACKWARD_FLIGHT"
  | "ROTATE_VIEW_180"
  | "DOWNLOAD_SCREENSHOT_FLIGHT"
  // Plane mode — navigation & general
  | "MOVE_LEFT"
  | "MOVE_RIGHT"
  | "MOVE_UP"
  | "MOVE_DOWN"
  | "YAW_LEFT"
  | "YAW_RIGHT"
  | "PITCH_UP"
  | "PITCH_DOWN"
  | "ALT_ROLL_LEFT"
  | "ALT_ROLL_RIGHT"
  | "MOVE_MULTIPLE_FORWARD"
  | "MOVE_MULTIPLE_BACKWARD"
  | "SHIFT_SPACE"
  | "MOVE_ONE_FORWARD"
  | "MOVE_ONE_FORWARD_DIRECTION_AWARE"
  | "MOVE_ONE_BACKWARD_DIRECTION_AWARE"
  | "ZOOM_IN_PLANE"
  | "ZOOM_OUT_PLANE"
  | "INCREASE_MOVE_VALUE_PLANE"
  | "DECREASE_MOVE_VALUE_PLANE"
  | "DOWNLOAD_SCREENSHOT_PLANE"
  | "CYCLE_TOOLS"
  | "CYCLE_TOOLS_BACKWARDS"
  // Plane mode — tool switching
  | "SWITCH_TO_MOVE_TOOL"
  | "SWITCH_TO_SKELETON_TOOL"
  | "SWITCH_TO_BRUSH_TOOL"
  | "SWITCH_TO_BRUSH_ERASE_TOOL"
  | "SWITCH_TO_LASSO_TOOL"
  | "SWITCH_TO_LASSO_ERASE_TOOL"
  | "SWITCH_TO_SEGMENT_PICKER_TOOL"
  | "SWITCH_TO_QUICK_SELECT_TOOL"
  | "SWITCH_TO_BOUNDING_BOX_TOOL"
  | "SWITCH_TO_PROOFREADING_TOOL"
  // Plane mode — skeleton tool
  | "TOGGLE_ALL_TREES"
  | "TOGGLE_INACTIVE_TREES"
  | "DELETE_ACTIVE_NODE_PLANE"
  | "CREATE_TREE_PLANE"
  | "MOVE_ALONG_DIRECTION"
  | "MOVE_ALONG_DIRECTION_REVERSED"
  | "CREATE_BRANCH_POINT_PLANE"
  | "DELETE_BRANCH_POINT_PLANE"
  | "RECENTER_ACTIVE_NODE_PLANE"
  | "NEXT_NODE_FORWARD_PLANE"
  | "NEXT_NODE_BACKWARD_PLANE"
  | "MOVE_NODE_LEFT"
  | "MOVE_NODE_RIGHT"
  | "MOVE_NODE_UP"
  | "MOVE_NODE_DOWN"
  // Plane mode — volume tool
  | "CREATE_NEW_CELL"
  | "INTERPOLATE_SEGMENTATION"
  | "COPY_SEGMENT_ID"
  | "BRUSH_PRESET_SMALL"
  | "BRUSH_PRESET_MEDIUM"
  | "BRUSH_PRESET_LARGE"
  | "DECREASE_BRUSH_SIZE"
  | "INCREASE_BRUSH_SIZE"
  // Plane mode — bounding box tool
  | "CREATE_BOUNDING_BOX"
  | "TOGGLE_CURSOR_STATE_FOR_MOVING"
  // Plane mode — proofreading tool
  | "TOGGLE_MULTICUT_MODE";

export const ALL_KEYBOARD_SHORTCUT_META_INFOS: Record<
  KeyboardShortcutId,
  KeyboardShortcutMetaInfo
> = {
  // ===================== GENERAL =====================
  SWITCH_VIEWMODE_PLANE: new KeyboardShortcutMetaInfo(
    "View in plane mode",
    [[["Shift", "1"]]],
    "GENERAL",
  ),
  SWITCH_VIEWMODE_FLIGHT: new KeyboardShortcutMetaInfo(
    "View in flight mode",
    [[["Shift", "2"]]],
    "GENERAL",
  ),
  CYCLE_VIEWMODE: new KeyboardShortcutMetaInfo("Cycle through viewing modes", [[["m"]]], "GENERAL"),
  TOGGLE_ALL_TREES: new KeyboardShortcutMetaInfo(
    "Toggle visibility of all trees",
    [[["1"]]],
    "GENERAL",
  ),
  TOGGLE_INACTIVE_TREES: new KeyboardShortcutMetaInfo(
    "Toggle visibility of non-active trees (exclude active tree / group)",
    [[["2"]]],
    "GENERAL",
  ),
  TOGGLE_SEGMENTATION: new KeyboardShortcutMetaInfo(
    "Toggle segmentation layer",
    [[["3"]]],
    "GENERAL",
  ),
  SAVE: new KeyboardShortcutMetaInfo(
    "Save annotation changes",
    [[["Meta", "s"]], [["Control", "s"]]],
    "GENERAL_EDITING",
  ),
  UNDO: new KeyboardShortcutMetaInfo(
    "Undo latest annotation change",
    [[["Meta", "z"]], [["Control", "z"]]],
    "GENERAL_EDITING",
  ),
  REDO: new KeyboardShortcutMetaInfo(
    "Redo latest annotation change",
    [[["Meta", "y"]], [["Control", "y"]]],
    "GENERAL_EDITING",
  ),
  MAXIMIZE: new KeyboardShortcutMetaInfo(
    "Toggle Viewport Maximization",
    [[["."]]],
    "GENERAL_LAYOUT",
  ),
  TOGGLE_LEFT_BORDER: new KeyboardShortcutMetaInfo(
    "Toggle left Sidebars",
    [[["k"]]],
    "GENERAL_LAYOUT",
  ),
  TOGGLE_RIGHT_BORDER: new KeyboardShortcutMetaInfo(
    "Toggle right Sidebars",
    [[["l"]]],
    "GENERAL_LAYOUT",
  ),
  NEXT_COMMENT: new KeyboardShortcutMetaInfo(
    "Select next comment",
    [[["n"]]],
    "GENERAL_COMMENT_TAB",
  ),
  PREVIOUS_COMMENT: new KeyboardShortcutMetaInfo(
    "Select previous comment",
    [[["p"]]],
    "GENERAL_COMMENT_TAB",
  ),

  // ===================== GENERAL.FLIGHT =====================
  MOVE_FORWARD_WITH_RECORDING: new KeyboardShortcutMetaInfo(
    "Move forward (while creating nodes)",
    [[["Space"]]],
    "FLIGHT_NAVIGATION",
  ),
  MOVE_BACKWARD_WITH_RECORDING: new KeyboardShortcutMetaInfo(
    "Move backward (while creating nodes)",
    [[["Control", "Space"]]],
    "FLIGHT_NAVIGATION",
  ),
  MOVE_FORWARD_WITHOUT_RECORDING: new KeyboardShortcutMetaInfo(
    "Move forward (without creating nodes)",
    [[["f"]]],
    "FLIGHT_NAVIGATION",
  ),
  MOVE_BACKWARD_WITHOUT_RECORDING: new KeyboardShortcutMetaInfo(
    "Move backward (without creating nodes)",
    [[["d"]]],
    "FLIGHT_NAVIGATION",
  ),
  YAW_FLYCAM_POSITIVE_AT_CENTER: new KeyboardShortcutMetaInfo(
    "Rotate left around center",
    [[["Shift", "ArrowLeft"]]],
    "FLIGHT_NAVIGATION",
  ),
  YAW_FLYCAM_INVERTED_AT_CENTER: new KeyboardShortcutMetaInfo(
    "Rotate right around center",
    [[["Shift", "ArrowRight"]]],
    "FLIGHT_NAVIGATION",
  ),
  PITCH_FLYCAM_POSITIVE_AT_CENTER: new KeyboardShortcutMetaInfo(
    "Rotate upwards around center",
    [[["Shift", "ArrowUp"]]],
    "FLIGHT_NAVIGATION",
  ),
  PITCH_FLYCAM_INVERTED_AT_CENTER: new KeyboardShortcutMetaInfo(
    "Rotate downwards around center",
    [[["Shift", "ArrowDown"]]],
    "FLIGHT_NAVIGATION",
  ),
  YAW_FLYCAM_POSITIVE_IN_DISTANCE: new KeyboardShortcutMetaInfo(
    "Rotate left in distance",
    [[["ArrowLeft"]]],
    "FLIGHT_NAVIGATION",
  ),
  YAW_FLYCAM_INVERTED_IN_DISTANCE: new KeyboardShortcutMetaInfo(
    "Rotate right in distance",
    [[["ArrowRight"]]],
    "FLIGHT_NAVIGATION",
  ),
  PITCH_FLYCAM_POSITIVE_IN_DISTANCE: new KeyboardShortcutMetaInfo(
    "Rotate up in distance",
    [[["ArrowDown"]]],
    "FLIGHT_NAVIGATION",
  ),
  PITCH_FLYCAM_INVERTED_IN_DISTANCE: new KeyboardShortcutMetaInfo(
    "Rotate down in distance",
    [[["ArrowUp"]]],
    "FLIGHT_NAVIGATION",
  ),
  ZOOM_IN_FLIGHT: new KeyboardShortcutMetaInfo("Zoom in", [[["i"]]], "FLIGHT_NAVIGATION"),
  ZOOM_OUT_FLIGHT: new KeyboardShortcutMetaInfo("Zoom out", [[["o"]]], "FLIGHT_NAVIGATION"),
  INCREASE_MOVE_VALUE_FLIGHT: new KeyboardShortcutMetaInfo(
    "Increase move value",
    [[["h"]]],
    "FLIGHT_NAVIGATION",
  ),
  DECREASE_MOVE_VALUE_FLIGHT: new KeyboardShortcutMetaInfo(
    "Decrease move value",
    [[["g"]]],
    "FLIGHT_NAVIGATION",
  ),
  DELETE_ACTIVE_NODE: new KeyboardShortcutMetaInfo(
    "Delete active node",
    [[["Delete"]], [["Backspace"]], [["Shift", "Space"]]],
    "FLIGHT_EDITING",
  ),
  CREATE_TREE_FLIGHT: new KeyboardShortcutMetaInfo("Create new tree", [[["c"]]], "FLIGHT_EDITING"),
  CREATE_BRANCH_POINT_FLIGHT: new KeyboardShortcutMetaInfo(
    "Create branch point",
    [[["b"]]],
    "FLIGHT_EDITING",
  ),
  DELETE_BRANCH_POINT_FLIGHT: new KeyboardShortcutMetaInfo(
    "Delete branch point",
    [[["j"]]],
    "FLIGHT_EDITING",
  ),
  RECENTER_ACTIVE_NODE_FLIGHT: new KeyboardShortcutMetaInfo(
    "Recenter active node",
    [[["s"]]],
    "FLIGHT_EDITING",
  ),
  NEXT_NODE_FORWARD_FLIGHT: new KeyboardShortcutMetaInfo(
    "Jump to next node",
    [[["Control", "."]]],
    "FLIGHT_EDITING",
  ),
  NEXT_NODE_BACKWARD_FLIGHT: new KeyboardShortcutMetaInfo(
    "Jump to previous node",
    [[["Control", ","]]],
    "FLIGHT_EDITING",
  ),
  ROTATE_VIEW_180: new KeyboardShortcutMetaInfo(
    "Rotate view 180 degrees",
    [[["r"]]],
    "FLIGHT_EDITING",
  ),
  DOWNLOAD_SCREENSHOT_FLIGHT: new KeyboardShortcutMetaInfo(
    "Download screenshot",
    [[["q"]]],
    "FLIGHT_EDITING",
  ),

  // ===================== GENERAL.PLANE =====================
  MOVE_LEFT: new KeyboardShortcutMetaInfo("Move left", [[["ArrowLeft"]]], "PLANE_NAVIGATION"),
  MOVE_RIGHT: new KeyboardShortcutMetaInfo("Move right", [[["ArrowRight"]]], "PLANE_NAVIGATION"),
  MOVE_UP: new KeyboardShortcutMetaInfo("Move up", [[["ArrowUp"]]], "PLANE_NAVIGATION"),
  MOVE_DOWN: new KeyboardShortcutMetaInfo("Move down", [[["ArrowDown"]]], "PLANE_NAVIGATION"),
  YAW_LEFT: new KeyboardShortcutMetaInfo(
    "Rotate left",
    [[["Shift", "ArrowLeft"]]],
    "PLANE_NAVIGATION",
  ),
  YAW_RIGHT: new KeyboardShortcutMetaInfo(
    "Rotate right",
    [[["Shift", "ArrowRight"]]],
    "PLANE_NAVIGATION",
  ),
  PITCH_UP: new KeyboardShortcutMetaInfo("Rotate up", [[["Shift", "ArrowUp"]]], "PLANE_NAVIGATION"),
  PITCH_DOWN: new KeyboardShortcutMetaInfo(
    "Rotate down",
    [[["Shift", "ArrowDown"]]],
    "PLANE_NAVIGATION",
  ),
  ALT_ROLL_LEFT: new KeyboardShortcutMetaInfo(
    "Roll left",
    [[["Alt", "ArrowLeft"]]],
    "PLANE_NAVIGATION",
  ),
  ALT_ROLL_RIGHT: new KeyboardShortcutMetaInfo(
    "Roll right",
    [[["Alt", "ArrowRight"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_MULTIPLE_FORWARD: new KeyboardShortcutMetaInfo(
    "Fast move forward",
    [[["Shift", "f"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_MULTIPLE_BACKWARD: new KeyboardShortcutMetaInfo(
    "Fast move backward",
    [[["Shift", "d"]]],
    "PLANE_NAVIGATION",
  ),
  SHIFT_SPACE: new KeyboardShortcutMetaInfo(
    "Move backward",
    [[["Shift", "Space"]], [["Control", "Space"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_ONE_FORWARD: new KeyboardShortcutMetaInfo("Move forward", [[["Space"]]], "PLANE_NAVIGATION"),
  MOVE_ONE_FORWARD_DIRECTION_AWARE: new KeyboardShortcutMetaInfo(
    "Move forward (direction aware)",
    [[["f"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_ONE_BACKWARD_DIRECTION_AWARE: new KeyboardShortcutMetaInfo(
    "Move backward (direction aware)",
    [[["d"]]],
    "PLANE_NAVIGATION",
  ),
  ZOOM_IN_PLANE: new KeyboardShortcutMetaInfo("Zoom in", [[["i"]]], "PLANE_NAVIGATION"),
  ZOOM_OUT_PLANE: new KeyboardShortcutMetaInfo("Zoom out", [[["o"]]], "PLANE_NAVIGATION"),
  INCREASE_MOVE_VALUE_PLANE: new KeyboardShortcutMetaInfo(
    "Increase move value",
    [[["h"]]],
    "PLANE_NAVIGATION",
  ),
  DECREASE_MOVE_VALUE_PLANE: new KeyboardShortcutMetaInfo(
    "Decrease move value",
    [[["g"]]],
    "PLANE_NAVIGATION",
  ),
  DOWNLOAD_SCREENSHOT_PLANE: new KeyboardShortcutMetaInfo(
    "Download Screenshot(s) of Viewport(s)",
    [[["q"]]],
    "PLANE_NAVIGATION",
  ),
  CYCLE_TOOLS: new KeyboardShortcutMetaInfo(
    "Cycle Through Tools (Move / Skeleton / Brush/ ...)",
    [[["w"]]],
    "PLANE_NAVIGATION",
  ),
  CYCLE_TOOLS_BACKWARDS: new KeyboardShortcutMetaInfo(
    "Cycle Backwards Through Tools (Move / Proofread / Bounding Box / ...)",
    [[["Shift", "w"]]],
    "PLANE_NAVIGATION",
  ),
  SWITCH_TO_MOVE_TOOL: new KeyboardShortcutMetaInfo(
    "Move Tool",
    [[["Control", "k"], ["m"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_SKELETON_TOOL: new KeyboardShortcutMetaInfo(
    "Skeleton Tool",
    [[["Control", "k"], ["s"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_BRUSH_TOOL: new KeyboardShortcutMetaInfo(
    "Brush Tool",
    [[["Control", "k"], ["b"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_BRUSH_ERASE_TOOL: new KeyboardShortcutMetaInfo(
    "Brush Erase Tool",
    [[["Control", "k"], ["e"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_LASSO_TOOL: new KeyboardShortcutMetaInfo(
    "Lasso Tool",
    [[["Control", "k"], ["l"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_LASSO_ERASE_TOOL: new KeyboardShortcutMetaInfo(
    "Lasso Erase Tool",
    [[["Control", "k"], ["r"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_SEGMENT_PICKER_TOOL: new KeyboardShortcutMetaInfo(
    "Segment Picker Tool",
    [[["Control", "k"], ["p"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_QUICK_SELECT_TOOL: new KeyboardShortcutMetaInfo(
    "Quick Select Tool",
    [[["Control", "k"], ["q"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_BOUNDING_BOX_TOOL: new KeyboardShortcutMetaInfo(
    "Bounding Box Tool",
    [[["Control", "k"], ["x"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_PROOFREADING_TOOL: new KeyboardShortcutMetaInfo(
    "Proofreading Tool",
    [[["Control", "k"], ["o"]]],
    "PLANE_TOOL_SWITCHING",
  ),

  // ===================== GENERAL.PLANE.SKELETON =====================
  DELETE_ACTIVE_NODE_PLANE: new KeyboardShortcutMetaInfo(
    "Delete Active Node",
    [[["Delete"]], [["Backspace"]]],
    "PLANE_SKELETON_TOOL",
  ),
  CREATE_TREE_PLANE: new KeyboardShortcutMetaInfo(
    "Create new Tree",
    [[["c"]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_ALONG_DIRECTION: new KeyboardShortcutMetaInfo(
    "Move along annotation direction",
    [[["e"]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_ALONG_DIRECTION_REVERSED: new KeyboardShortcutMetaInfo(
    "Move backward annotation direction",
    [[["r"]]],
    "PLANE_SKELETON_TOOL",
  ),
  CREATE_BRANCH_POINT_PLANE: new KeyboardShortcutMetaInfo(
    "Create branch point",
    [[["b"]]],
    "PLANE_SKELETON_TOOL",
  ),
  DELETE_BRANCH_POINT_PLANE: new KeyboardShortcutMetaInfo(
    "Delete branch point",
    [[["j"]]],
    "PLANE_SKELETON_TOOL",
  ),
  RECENTER_ACTIVE_NODE_PLANE: new KeyboardShortcutMetaInfo(
    "Recenter active node",
    [[["s"]]],
    "PLANE_SKELETON_TOOL",
  ),
  NEXT_NODE_BACKWARD_PLANE: new KeyboardShortcutMetaInfo(
    "Activate Previous Node",
    [[["Control", ","]]],
    "PLANE_SKELETON_TOOL",
  ),
  NEXT_NODE_FORWARD_PLANE: new KeyboardShortcutMetaInfo(
    "Activate Next Node",
    [[["Control", "."]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_NODE_LEFT: new KeyboardShortcutMetaInfo(
    "Move active node left",
    [[["Control", "ArrowLeft"]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_NODE_RIGHT: new KeyboardShortcutMetaInfo(
    "Move active node right",
    [[["Control", "ArrowRight"]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_NODE_UP: new KeyboardShortcutMetaInfo(
    "Move active node up",
    [[["Control", "ArrowUp"]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_NODE_DOWN: new KeyboardShortcutMetaInfo(
    "Move active node down",
    [[["Control", "ArrowDown"]]],
    "PLANE_SKELETON_TOOL",
  ),

  // ===================== GENERAL.PLANE.VOLUME =====================
  CREATE_NEW_CELL: new KeyboardShortcutMetaInfo("Create new cell", [[["c"]]], "PLANE_VOLUME_TOOL"),
  INTERPOLATE_SEGMENTATION: new KeyboardShortcutMetaInfo(
    "Interpolate annotation between latest drawn sections",
    [[["v"]]],
    "PLANE_VOLUME_TOOL",
  ),
  COPY_SEGMENT_ID: new KeyboardShortcutMetaInfo(
    "Copy segment id under cursor",
    [[["Control", "i"]]],
    "PLANE_VOLUME_TOOL",
  ),
  BRUSH_PRESET_SMALL: new KeyboardShortcutMetaInfo(
    "Switch to small brush",
    [[["Control", "k"], ["1"]]],
    "PLANE_VOLUME_TOOL",
  ),
  BRUSH_PRESET_MEDIUM: new KeyboardShortcutMetaInfo(
    "Switch to medium sized brush",
    [[["Control", "k"], ["2"]]],
    "PLANE_VOLUME_TOOL",
  ),
  BRUSH_PRESET_LARGE: new KeyboardShortcutMetaInfo(
    "Switch to large brush",
    [[["Control", "k"], ["3"]]],
    "PLANE_VOLUME_TOOL",
  ),
  DECREASE_BRUSH_SIZE: new KeyboardShortcutMetaInfo(
    "Decrease brush size",
    [[["Shift", "i"]]],
    "PLANE_VOLUME_TOOL",
  ),
  INCREASE_BRUSH_SIZE: new KeyboardShortcutMetaInfo(
    "Increase brush size",
    [[["Shift", "o"]]],
    "PLANE_VOLUME_TOOL",
  ),

  // ===================== GENERAL.PLANE.BOUNDING_BOX =====================
  CREATE_BOUNDING_BOX: new KeyboardShortcutMetaInfo(
    "Create new bounding box",
    [[["c"]]],
    "PLANE_BOUNDING_BOX_TOOL",
  ),
  TOGGLE_CURSOR_STATE_FOR_MOVING: new KeyboardShortcutMetaInfo(
    "Enable moving the hovered bounding box",
    [[["Control"]], [["Meta"]]],
    "PLANE_BOUNDING_BOX_TOOL",
  ),

  // ===================== GENERAL.PLANE.PROOFREADING =====================
  TOGGLE_MULTICUT_MODE: new KeyboardShortcutMetaInfo(
    "Toggle multi cut mode",
    [[["m"]]],
    "PLANE_PROOFREADING_TOOL",
  ),
};

export const ALL_KEYBOARD_SHORTCUT_IDS = Object.keys(
  ALL_KEYBOARD_SHORTCUT_META_INFOS,
) as KeyboardShortcutId[];

export function getAllDefaultKeyboardShortcuts(): KeyboardShortcutsMap {
  return cloneDeep(
    Object.fromEntries(
      Object.entries(ALL_KEYBOARD_SHORTCUT_META_INFOS).map(([id, info]) => [
        id,
        info.defaultBindings,
      ]),
    ) as KeyboardShortcutsMap,
  );
}
