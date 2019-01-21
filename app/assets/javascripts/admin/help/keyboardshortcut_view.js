// @flow
import { Table } from "antd";
import React from "react";

const KeyboardShortcutView = () => {
  const columns = [
    {
      title: "Key Binding",
      dataIndex: "keybinding",
      key: "keybinding",
    },
    {
      title: "Action",
      dataIndex: "action",
      key: "action",
    },
  ];

  const orthogonalShortcuts = [
    {
      keybinding: "Left Mouse Drag or Arrow Keys",
      action: "Move",
    },
    {
      keybinding: "I, O, or Alt + Mousewheel",
      action: "Zoom In/out",
    },
    {
      keybinding: "F, D or Mousewheel",
      action: "Move Along Z-axis",
    },
    {
      keybinding: "E or R",
      action:
        "Move along the current direction (determined by the vector between the last two created nodes). Use R to move in the opposite direction.",
    },
    {
      keybinding: "Right Click",
      action: "Set Node",
    },
    {
      keybinding: "Shift + Alt + Left Click",
      action: "Merge Two Trees",
    },
    {
      keybinding: "Shift + Ctrl + Left Click",
      action: "Delete Edge/split Trees",
    },
    {
      keybinding: "K, L",
      action: "Increase/Decrease Size of Layout",
    },
    {
      keybinding: "B, J",
      action: "Set/jump To Last Branchpoint",
    },
    {
      keybinding: "S",
      action: "Center Active Node",
    },
    {
      keybinding: "Scroll Mousewheel (3D View)",
      action: "Zoom In And Out",
    },
    {
      keybinding: "Right Click Drag (3D View)",
      action: "Rotate 3D View",
    },
    {
      keybinding: "Ctrl + Left Click",
      action: "Select/Unselect a tree in the trees tab",
    },
  ];

  const generalShortcuts = [
    {
      keybinding: "Ctrl/cmd + Z",
      action: "Undo",
    },
    {
      keybinding: "Ctrl/cmd + Y",
      action: "Redo",
    },
    {
      keybinding: "P, N",
      action: "Previous/next Comment",
    },
    {
      keybinding: "Del",
      action: "Delete Node/split Trees",
    },
    {
      keybinding: "C",
      action: "Create New Tree",
    },
    {
      keybinding: "Shift + Alt + Left Click",
      action: "Merge Two Trees",
    },
    {
      keybinding: "M",
      action: "Toggle Mode (orthogonal, Flight, Oblique)",
    },
    {
      keybinding: "1",
      action: "Toggle Skeleton Visibility",
    },
    {
      keybinding: "2",
      action: "Toggle Inactive Tree Visibility",
    },
    {
      keybinding: "3",
      action: "Toggle Segmentation Opacity",
    },
    {
      keybinding: "Shift + Mousewheel",
      action: "Change Node Radius",
    },
    {
      keybinding: "H, G",
      action: "Increase/Decrease the Move Value",
    },
    {
      keybinding: "Ctrl + Shift + F",
      action: "Open Tree Search (if Tree List is visible)",
    },
  ];

  const flightModeShortcuts = [
    {
      keybinding: "Shift + Left Click",
      action: "Select Active Node",
    },
    {
      keybinding: "Mouse Drag or Arrow Keys",
      action: "Rotation",
    },
    {
      keybinding: "Space",
      action: "Forward",
    },
    {
      keybinding: "Ctrl + Space",
      action: "Backward",
    },
    {
      keybinding: "I, O",
      action: "Zoom In And Out",
    },
    {
      keybinding: "Shift + Arrow",
      action: "Rotation Around Axis",
    },
    {
      keybinding: "B, J",
      action: "Set/jump To Last Branchpoint",
    },
    {
      keybinding: "R",
      action: "Reset Rotation",
    },
    {
      keybinding: "S",
      action: "Center Active Node",
    },
    {
      keybinding: "D",
      action: "Forward Without Recording Waypoints",
    },
    {
      keybinding: "F",
      action: "Backward Without Recording Waypoints",
    },
    {
      keybinding: "Shift + Space",
      action: "Delete Active Node, Recenter Previous Node",
    },
  ];

  const volumeModeShortcuts = [
    {
      keybinding: "Shift + Left Click",
      action: "Select Active Cell",
    },
    {
      keybinding: "Left Mouse Drag",
      action: "Move (Move Mode) / Add To Current Cell (Trace / Brush Mode)",
    },
    {
      keybinding: "Ctrl + Left Mouse Drag",
      action: "Add Empty Voxels To Current Cell (in Trace / Brush Mode)",
    },
    {
      keybinding: "Arrow Keys",
      action: "Move",
    },
    {
      keybinding: "Right Mouse Drag",
      action: "Remove Voxels From Current Cell",
    },
    {
      keybinding: "Ctrl + Right Mouse Drag",
      action: "Remove Voxels From Any Cell",
    },
    {
      keybinding: "C",
      action: "Create New Cell",
    },
    {
      keybinding: "W, 1",
      action: "Toggle Move / Trace / Brush Mode",
    },
    {
      keybinding: "Shift + Mousewheel or Shift + I,O",
      action: "Change Brush Size (Brush Mode)",
    },
    {
      keybinding: "V",
      action: "Copy Segmentation of Current Cell From Previous Slice",
    },
    {
      keybinding: "Shift + V",
      action: "Copy Segmentation of Current Cell From Next Slice",
    },
  ];

  return (
    <div className="container help">
      <h3>Keyboard Shortcuts</h3>
      <p>Find all available keyboard shortcuts for webKnossos listed below.</p>

      <h3>General Navigation</h3>
      <Table
        dataSource={generalShortcuts}
        columns={columns}
        pagination={false}
        rowKey={(_, index) => index}
      />

      <h3>Orthogonal Mode</h3>
      <Table
        dataSource={orthogonalShortcuts}
        columns={columns}
        pagination={false}
        rowKey={(_, index) => index}
      />

      <h3>Oblique / Flight Mode</h3>
      <Table
        dataSource={flightModeShortcuts}
        columns={columns}
        pagination={false}
        rowKey={(_, index) => index}
      />

      <h3>Volume Mode</h3>
      <Table
        dataSource={volumeModeShortcuts}
        columns={columns}
        pagination={false}
        rowKey={(_, index) => index}
      />
    </div>
  );
};

export default KeyboardShortcutView;
