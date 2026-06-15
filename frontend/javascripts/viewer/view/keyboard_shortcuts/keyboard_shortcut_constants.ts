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
  // Plane mode — navigation
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
  | "MOVE_ALONG_DIRECTION"
  | "MOVE_ALONG_DIRECTION_REVERSED"
  | "RECENTER_ACTIVE_NODE_PLANE"
  | "NEXT_NODE_FORWARD_PLANE"
  | "NEXT_NODE_BACKWARD_PLANE"
  // Plane mode — general
  | "DOWNLOAD_SCREENSHOT_PLANE"
  | "COPY_SEGMENT_ID"
  // Plane mode — tool switching
  | "CYCLE_TOOLS"
  | "CYCLE_TOOLS_BACKWARDS"
  | "SWITCH_TO_MOVE_TOOL"
  | "SWITCH_TO_SKELETON_TOOL"
  | "SWITCH_TO_BRUSH_TOOL"
  | "SWITCH_TO_BRUSH_ERASE_TOOL"
  | "SWITCH_TO_LASSO_TOOL"
  | "SWITCH_TO_LASSO_ERASE_TOOL"
  | "SWITCH_TO_FILL_TOOL"
  | "SWITCH_TO_SEGMENT_PICKER_TOOL"
  | "SWITCH_TO_QUICK_SELECT_TOOL"
  | "SWITCH_TO_BOUNDING_BOX_TOOL"
  | "SWITCH_TO_PROOFREADING_TOOL"
  | "SWITCH_TO_LINE_MEASUREMENT_TOOL"
  | "SWITCH_TO_AREA_MEASUREMENT_TOOL"
  // Plane mode — skeleton tool
  | "TOGGLE_ALL_TREES"
  | "TOGGLE_INACTIVE_TREES"
  | "DELETE_ACTIVE_NODE_PLANE"
  | "CREATE_TREE_PLANE"
  | "CREATE_BRANCH_POINT_PLANE"
  | "DELETE_BRANCH_POINT_PLANE"
  | "MOVE_NODE_LEFT"
  | "MOVE_NODE_RIGHT"
  | "MOVE_NODE_UP"
  | "MOVE_NODE_DOWN"
  // Plane mode — volume tool
  | "CREATE_NEW_CELL"
  | "INTERPOLATE_SEGMENTATION"
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
    "View in Plane Mode",
    [[["Shift", "1"]]],
    "GENERAL",
  ),
  SWITCH_VIEWMODE_FLIGHT: new KeyboardShortcutMetaInfo(
    "View in Flight Mode",
    [[["Shift", "2"]]],
    "GENERAL",
  ),
  CYCLE_VIEWMODE: new KeyboardShortcutMetaInfo("Cycle Through Viewing Modes", [[["m"]]], "GENERAL"),
  TOGGLE_ALL_TREES: new KeyboardShortcutMetaInfo(
    "Toggle Visibility of All Trees",
    [[["1"]]],
    "GENERAL",
  ),
  TOGGLE_INACTIVE_TREES: new KeyboardShortcutMetaInfo(
    "Toggle Visibility of Non-Active Trees (Exclude Active Tree / Group)",
    [[["2"]]],
    "GENERAL",
  ),
  TOGGLE_SEGMENTATION: new KeyboardShortcutMetaInfo(
    "Toggle Segmentation Layer",
    [[["3"]]],
    "GENERAL",
  ),
  SAVE: new KeyboardShortcutMetaInfo(
    "Save Annotation Changes",
    [[["Meta", "s"]], [["Control", "s"]]],
    "GENERAL_EDITING",
  ),
  UNDO: new KeyboardShortcutMetaInfo(
    "Undo Latest Annotation Change",
    [[["Meta", "z"]], [["Control", "z"]]],
    "GENERAL_EDITING",
  ),
  REDO: new KeyboardShortcutMetaInfo(
    "Redo Latest Annotation Change",
    [[["Meta", "y"]], [["Control", "y"]]],
    "GENERAL_EDITING",
  ),
  MAXIMIZE: new KeyboardShortcutMetaInfo(
    "Toggle Viewport Maximization",
    [[["."]]],
    "GENERAL_LAYOUT",
  ),
  TOGGLE_LEFT_BORDER: new KeyboardShortcutMetaInfo(
    "Toggle Left Sidebars",
    [[["k"]]],
    "GENERAL_LAYOUT",
  ),
  TOGGLE_RIGHT_BORDER: new KeyboardShortcutMetaInfo(
    "Toggle Right Sidebars",
    [[["l"]]],
    "GENERAL_LAYOUT",
  ),
  NEXT_COMMENT: new KeyboardShortcutMetaInfo(
    "Select Next Comment",
    [[["n"]]],
    "GENERAL_COMMENT_TAB",
  ),
  PREVIOUS_COMMENT: new KeyboardShortcutMetaInfo(
    "Select Previous Comment",
    [[["p"]]],
    "GENERAL_COMMENT_TAB",
  ),

  // ===================== GENERAL.FLIGHT =====================
  MOVE_FORWARD_WITH_RECORDING: new KeyboardShortcutMetaInfo(
    "Move Forward (While Creating Nodes)",
    [[["Space"]]],
    "FLIGHT_NAVIGATION",
  ),
  MOVE_BACKWARD_WITH_RECORDING: new KeyboardShortcutMetaInfo(
    "Move Backward (While Creating Nodes)",
    [[["Control", "Space"]]],
    "FLIGHT_NAVIGATION",
  ),
  MOVE_FORWARD_WITHOUT_RECORDING: new KeyboardShortcutMetaInfo(
    "Move Forward (Without Creating Nodes)",
    [[["f"]]],
    "FLIGHT_NAVIGATION",
  ),
  MOVE_BACKWARD_WITHOUT_RECORDING: new KeyboardShortcutMetaInfo(
    "Move Backward (Without Creating Nodes)",
    [[["d"]]],
    "FLIGHT_NAVIGATION",
  ),
  YAW_FLYCAM_POSITIVE_AT_CENTER: new KeyboardShortcutMetaInfo(
    "Rotate Left Around Center",
    [[["Shift", "ArrowLeft"]]],
    "FLIGHT_NAVIGATION",
  ),
  YAW_FLYCAM_INVERTED_AT_CENTER: new KeyboardShortcutMetaInfo(
    "Rotate Right Around Center",
    [[["Shift", "ArrowRight"]]],
    "FLIGHT_NAVIGATION",
  ),
  PITCH_FLYCAM_POSITIVE_AT_CENTER: new KeyboardShortcutMetaInfo(
    "Rotate Upwards Around Center",
    [[["Shift", "ArrowUp"]]],
    "FLIGHT_NAVIGATION",
  ),
  PITCH_FLYCAM_INVERTED_AT_CENTER: new KeyboardShortcutMetaInfo(
    "Rotate Downwards Around Center",
    [[["Shift", "ArrowDown"]]],
    "FLIGHT_NAVIGATION",
  ),
  YAW_FLYCAM_POSITIVE_IN_DISTANCE: new KeyboardShortcutMetaInfo(
    "Rotate Left in Distance",
    [[["ArrowLeft"]]],
    "FLIGHT_NAVIGATION",
  ),
  YAW_FLYCAM_INVERTED_IN_DISTANCE: new KeyboardShortcutMetaInfo(
    "Rotate Right in Distance",
    [[["ArrowRight"]]],
    "FLIGHT_NAVIGATION",
  ),
  PITCH_FLYCAM_POSITIVE_IN_DISTANCE: new KeyboardShortcutMetaInfo(
    "Rotate Up in Distance",
    [[["ArrowDown"]]],
    "FLIGHT_NAVIGATION",
  ),
  PITCH_FLYCAM_INVERTED_IN_DISTANCE: new KeyboardShortcutMetaInfo(
    "Rotate Down in Distance",
    [[["ArrowUp"]]],
    "FLIGHT_NAVIGATION",
  ),
  ZOOM_IN_FLIGHT: new KeyboardShortcutMetaInfo("Zoom In", [[["i"]]], "FLIGHT_NAVIGATION"),
  ZOOM_OUT_FLIGHT: new KeyboardShortcutMetaInfo("Zoom Out", [[["o"]]], "FLIGHT_NAVIGATION"),
  INCREASE_MOVE_VALUE_FLIGHT: new KeyboardShortcutMetaInfo(
    "Increase Move Value",
    [[["h"]]],
    "FLIGHT_NAVIGATION",
  ),
  DECREASE_MOVE_VALUE_FLIGHT: new KeyboardShortcutMetaInfo(
    "Decrease Move Value",
    [[["g"]]],
    "FLIGHT_NAVIGATION",
  ),
  DELETE_ACTIVE_NODE: new KeyboardShortcutMetaInfo(
    "Delete Active Node",
    [[["Delete"]], [["Backspace"]], [["Shift", "Space"]]],
    "FLIGHT_EDITING",
  ),
  CREATE_TREE_FLIGHT: new KeyboardShortcutMetaInfo("Create New Tree", [[["c"]]], "FLIGHT_EDITING"),
  CREATE_BRANCH_POINT_FLIGHT: new KeyboardShortcutMetaInfo(
    "Create Branch Point",
    [[["b"]]],
    "FLIGHT_EDITING",
  ),
  DELETE_BRANCH_POINT_FLIGHT: new KeyboardShortcutMetaInfo(
    "Jump to Last Branch Point and Remove Branch Point Status",
    [[["j"]]],
    "FLIGHT_EDITING",
  ),
  RECENTER_ACTIVE_NODE_FLIGHT: new KeyboardShortcutMetaInfo(
    "Recenter Active Node",
    [[["s"]]],
    "FLIGHT_EDITING",
  ),
  NEXT_NODE_FORWARD_FLIGHT: new KeyboardShortcutMetaInfo(
    "Jump to Next Node",
    [[["Control", "."]]],
    "FLIGHT_EDITING",
  ),
  NEXT_NODE_BACKWARD_FLIGHT: new KeyboardShortcutMetaInfo(
    "Jump to Previous Node",
    [[["Control", ","]]],
    "FLIGHT_EDITING",
  ),
  ROTATE_VIEW_180: new KeyboardShortcutMetaInfo(
    "Rotate View 180 Degrees",
    [[["r"]]],
    "FLIGHT_EDITING",
  ),
  DOWNLOAD_SCREENSHOT_FLIGHT: new KeyboardShortcutMetaInfo(
    "Download Screenshot",
    [[["q"]]],
    "FLIGHT_EDITING",
  ),

  // ===================== GENERAL.PLANE =====================
  MOVE_LEFT: new KeyboardShortcutMetaInfo("Move Left", [[["ArrowLeft"]]], "PLANE_NAVIGATION"),
  MOVE_RIGHT: new KeyboardShortcutMetaInfo("Move Right", [[["ArrowRight"]]], "PLANE_NAVIGATION"),
  MOVE_UP: new KeyboardShortcutMetaInfo("Move Up", [[["ArrowUp"]]], "PLANE_NAVIGATION"),
  MOVE_DOWN: new KeyboardShortcutMetaInfo("Move Down", [[["ArrowDown"]]], "PLANE_NAVIGATION"),
  YAW_LEFT: new KeyboardShortcutMetaInfo(
    "Rotate Left",
    [[["Shift", "ArrowLeft"]]],
    "PLANE_NAVIGATION",
  ),
  YAW_RIGHT: new KeyboardShortcutMetaInfo(
    "Rotate Right",
    [[["Shift", "ArrowRight"]]],
    "PLANE_NAVIGATION",
  ),
  PITCH_UP: new KeyboardShortcutMetaInfo("Rotate Up", [[["Shift", "ArrowUp"]]], "PLANE_NAVIGATION"),
  PITCH_DOWN: new KeyboardShortcutMetaInfo(
    "Rotate Down",
    [[["Shift", "ArrowDown"]]],
    "PLANE_NAVIGATION",
  ),
  ALT_ROLL_LEFT: new KeyboardShortcutMetaInfo(
    "Roll Left",
    [[["Alt", "ArrowLeft"]]],
    "PLANE_NAVIGATION",
  ),
  ALT_ROLL_RIGHT: new KeyboardShortcutMetaInfo(
    "Roll Right",
    [[["Alt", "ArrowRight"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_MULTIPLE_FORWARD: new KeyboardShortcutMetaInfo(
    "Fast Move Forward",
    [[["Shift", "f"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_MULTIPLE_BACKWARD: new KeyboardShortcutMetaInfo(
    "Fast Move Backward",
    [[["Shift", "d"]]],
    "PLANE_NAVIGATION",
  ),
  SHIFT_SPACE: new KeyboardShortcutMetaInfo(
    "Move Backward",
    [[["Shift", "Space"]], [["Control", "Space"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_ONE_FORWARD: new KeyboardShortcutMetaInfo("Move Forward", [[["Space"]]], "PLANE_NAVIGATION"),
  MOVE_ONE_FORWARD_DIRECTION_AWARE: new KeyboardShortcutMetaInfo(
    "Move Forward (Direction Aware)",
    [[["f"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_ONE_BACKWARD_DIRECTION_AWARE: new KeyboardShortcutMetaInfo(
    "Move Backward (Direction Aware)",
    [[["d"]]],
    "PLANE_NAVIGATION",
  ),
  ZOOM_IN_PLANE: new KeyboardShortcutMetaInfo("Zoom In", [[["i"]]], "PLANE_NAVIGATION"),
  ZOOM_OUT_PLANE: new KeyboardShortcutMetaInfo("Zoom Out", [[["o"]]], "PLANE_NAVIGATION"),
  INCREASE_MOVE_VALUE_PLANE: new KeyboardShortcutMetaInfo(
    "Increase Move Value",
    [[["h"]]],
    "PLANE_NAVIGATION",
  ),
  DECREASE_MOVE_VALUE_PLANE: new KeyboardShortcutMetaInfo(
    "Decrease Move Value",
    [[["g"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_ALONG_DIRECTION: new KeyboardShortcutMetaInfo(
    "Move Along Annotation Direction",
    [[["e"]]],
    "PLANE_NAVIGATION",
  ),
  MOVE_ALONG_DIRECTION_REVERSED: new KeyboardShortcutMetaInfo(
    "Move Backward Along Annotation Direction",
    [[["r"]]],
    "PLANE_NAVIGATION",
  ),
  RECENTER_ACTIVE_NODE_PLANE: new KeyboardShortcutMetaInfo(
    "Recenter Active Node",
    [[["s"]]],
    "PLANE_NAVIGATION",
  ),
  NEXT_NODE_BACKWARD_PLANE: new KeyboardShortcutMetaInfo(
    "Activate Previous Node",
    [[["Control", ","]]],
    "PLANE_NAVIGATION",
  ),
  NEXT_NODE_FORWARD_PLANE: new KeyboardShortcutMetaInfo(
    "Activate Next Node",
    [[["Control", "."]]],
    "PLANE_NAVIGATION",
  ),
  DOWNLOAD_SCREENSHOT_PLANE: new KeyboardShortcutMetaInfo(
    "Download Screenshot(s) of Viewport(s)",
    [[["q"]]],
    "PLANE_GENERAL",
  ),
  COPY_SEGMENT_ID: new KeyboardShortcutMetaInfo(
    "Copy Segment ID Under Cursor",
    [[["Control", "i"]]],
    "PLANE_GENERAL",
  ),
  CYCLE_TOOLS: new KeyboardShortcutMetaInfo(
    "Cycle Through Tools (Move / Skeleton / Brush/ ...)",
    [[["w"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  CYCLE_TOOLS_BACKWARDS: new KeyboardShortcutMetaInfo(
    "Cycle Backwards Through Tools (Move / Proofread / Bounding Box / ...)",
    [[["Shift", "w"]]],
    "PLANE_TOOL_SWITCHING",
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
  SWITCH_TO_FILL_TOOL: new KeyboardShortcutMetaInfo(
    "Fill Tool",
    [[["Control", "k"], ["f"]]],
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
  SWITCH_TO_LINE_MEASUREMENT_TOOL: new KeyboardShortcutMetaInfo(
    "Line Measurement Tool",
    [[["Control", "k"], ["i"]]],
    "PLANE_TOOL_SWITCHING",
  ),
  SWITCH_TO_AREA_MEASUREMENT_TOOL: new KeyboardShortcutMetaInfo(
    "Area Measurement Tool",
    [[["Control", "k"], ["a"]]],
    "PLANE_TOOL_SWITCHING",
  ),

  // ===================== GENERAL.PLANE.SKELETON =====================
  DELETE_ACTIVE_NODE_PLANE: new KeyboardShortcutMetaInfo(
    "Delete Active Node",
    [[["Delete"]], [["Backspace"]]],
    "PLANE_SKELETON_TOOL",
  ),
  CREATE_TREE_PLANE: new KeyboardShortcutMetaInfo(
    "Create New Tree",
    [[["c"]]],
    "PLANE_SKELETON_TOOL",
  ),
  CREATE_BRANCH_POINT_PLANE: new KeyboardShortcutMetaInfo(
    "Create Branch Point",
    [[["b"]]],
    "PLANE_SKELETON_TOOL",
  ),
  DELETE_BRANCH_POINT_PLANE: new KeyboardShortcutMetaInfo(
    "Jump to Last Branch Point and Remove Branch Point Status",
    [[["j"]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_NODE_LEFT: new KeyboardShortcutMetaInfo(
    "Move Active Node Left",
    [[["Control", "ArrowLeft"]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_NODE_RIGHT: new KeyboardShortcutMetaInfo(
    "Move Active Node Right",
    [[["Control", "ArrowRight"]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_NODE_UP: new KeyboardShortcutMetaInfo(
    "Move Active Node Up",
    [[["Control", "ArrowUp"]]],
    "PLANE_SKELETON_TOOL",
  ),
  MOVE_NODE_DOWN: new KeyboardShortcutMetaInfo(
    "Move Active Node Down",
    [[["Control", "ArrowDown"]]],
    "PLANE_SKELETON_TOOL",
  ),

  // ===================== GENERAL.PLANE.VOLUME =====================
  CREATE_NEW_CELL: new KeyboardShortcutMetaInfo("Create New Cell", [[["c"]]], "PLANE_VOLUME_TOOL"),
  INTERPOLATE_SEGMENTATION: new KeyboardShortcutMetaInfo(
    "Interpolate Annotation Between Latest Drawn Sections",
    [[["v"]]],
    "PLANE_VOLUME_TOOL",
  ),
  BRUSH_PRESET_SMALL: new KeyboardShortcutMetaInfo(
    "Switch to Small Brush",
    [[["Control", "k"], ["1"]]],
    "PLANE_VOLUME_TOOL",
  ),
  BRUSH_PRESET_MEDIUM: new KeyboardShortcutMetaInfo(
    "Switch to Medium Sized Brush",
    [[["Control", "k"], ["2"]]],
    "PLANE_VOLUME_TOOL",
  ),
  BRUSH_PRESET_LARGE: new KeyboardShortcutMetaInfo(
    "Switch to Large Brush",
    [[["Control", "k"], ["3"]]],
    "PLANE_VOLUME_TOOL",
  ),
  DECREASE_BRUSH_SIZE: new KeyboardShortcutMetaInfo(
    "Decrease Brush Size",
    [[["Shift", "i"]]],
    "PLANE_VOLUME_TOOL",
  ),
  INCREASE_BRUSH_SIZE: new KeyboardShortcutMetaInfo(
    "Increase Brush Size",
    [[["Shift", "o"]]],
    "PLANE_VOLUME_TOOL",
  ),

  // ===================== GENERAL.PLANE.BOUNDING_BOX =====================
  CREATE_BOUNDING_BOX: new KeyboardShortcutMetaInfo(
    "Create New Bounding Box",
    [[["c"]]],
    "PLANE_BOUNDING_BOX_TOOL",
  ),
  TOGGLE_CURSOR_STATE_FOR_MOVING: new KeyboardShortcutMetaInfo(
    "Enable Moving the Hovered Bounding Box",
    [[["Control"]], [["Meta"]]],
    "PLANE_BOUNDING_BOX_TOOL",
  ),

  // ===================== GENERAL.PLANE.PROOFREADING =====================
  TOGGLE_MULTICUT_MODE: new KeyboardShortcutMetaInfo(
    "Toggle Multi Cut Mode",
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
