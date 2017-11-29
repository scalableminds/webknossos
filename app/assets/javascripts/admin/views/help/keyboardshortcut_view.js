// @flow
import React from "react";
import { Table } from "antd";

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
      key: "1",
      keybinding: "Left Mouse drag or Arrow keys",
      action: "Move",
    },
    {
      key: "2",
      keybinding: "I, O or Alt + Mousewheel",
      action: "Zoom in/out",
    },
    {
      key: "3",
      keybinding: "F, D or Mousewheel",
      action: "Move along Z-Axis",
    },
    {
      key: "4",
      keybinding: "Right click",
      action: "Set node",
    },
    {
      key: "5",
      keybinding: "Shift + Alt + Left click",
      action: "Merge two trees",
    },
    {
      key: "6",
      keybinding: "K, L",
      action: "Scale up/down viewport size",
    },
    {
      key: "7",
      keybinding: "B, J",
      action: "Set/Jump to last branchpoint",
    },
    {
      key: "8",
      keybinding: "S",
      action: "Center active node",
    },
  ];

  const ThreeDShortcuts = [
    {
      key: "1",
      keybinding: "Mousewheel",
      action: "Zoom in and out",
    },
    {
      key: "2",
      keybinding: "Right click drag",
      action: "Rotate 3D Viewt",
    },
  ];

  const generalShortcuts = [
    {
      key: "1",
      keybinding: "Ctrl/Cmd + Z",
      action: "Undo",
    },
    {
      key: "2",
      keybinding: "Ctrl/Cmd + Y",
      action: "Redo",
    },
    {
      key: "3",
      keybinding: "P, N",
      action: "Previous/Next comment",
    },
    {
      key: "4",
      keybinding: "Del",
      action: "Delete node/Split trees",
    },
    {
      key: "5",
      keybinding: "C",
      action: "Create new tree",
    },
    {
      key: "6",
      keybinding: "Shift + Alt + Left click",
      action: "Merge two trees",
    },
    {
      key: "7",
      keybinding: "M",
      action: "Toggle mode (Orthogonal, Flight, Oblique)",
    },
    {
      key: "8",
      keybinding: "1",
      action: "Toggle skeleton visibility",
    },
    {
      key: "9",
      keybinding: "2",
      action: "Toggle inactive tree visibility",
    },
    {
      key: "10",
      keybinding: "3",
      action: "Toggle segmentation opacity",
    },
    {
      key: "11",
      keybinding: "Shift + Mousewheel",
      action: "Change node radius",
    },
  ];

  const flightModeShortcuts = [
    {
      key: "1",
      keybinding: "Shift + Left click",
      action: "Select active node",
    },
    {
      key: "2",
      keybinding: "Mouse drag or Arrow keys",
      action: "Rotation",
    },
    {
      key: "3",
      keybinding: "Space",
      action: "Forward",
    },
    {
      key: "4",
      keybinding: "Ctrl + Space",
      action: "Backward",
    },
    {
      key: "5",
      keybinding: "I, O",
      action: "Zoom in and out",
    },
    {
      key: "6",
      keybinding: "Shift + Arrow",
      action: "Rotation around Axis",
    },
    {
      key: "7",
      keybinding: "B, J",
      action: "Set/Jump to last branchpoint",
    },
    {
      key: "8",
      keybinding: "R",
      action: "Reset rotation",
    },
    {
      key: "9",
      keybinding: "S",
      action: "Center active node",
    },
    {
      key: "10",
      keybinding: "D",
      action: "Forward without recording waypoints",
    },
    {
      key: "11",
      keybinding: "F",
      action: "Backward without recording waypoints",
    },
    {
      key: "12",
      keybinding: "Shift + Space",
      action: "Delete active node, Recenter previous node",
    },
  ];

  const volumeModeShortcuts = [
    {
      key: "1",
      keybinding: "Shift + Left click",
      action: "Select active cell",
    },
    {
      key: "2",
      keybinding: "Left Mouse drag",
      action: "Move (Move mode) / Add to current Cell (Trace/Brush mode)",
    },
    {
      key: "3",
      keybinding: "Arrow keys",
      action: "Move",
    },
    {
      key: "4",
      keybinding: "Right Mouse drag",
      action: "Remove voxels from cell",
    },
    {
      key: "5",
      keybinding: "C",
      action: "Create new cell",
    },
    {
      key: "6",
      keybinding: "W, 1",
      action: "Toggle Move / Trace / Brush mode",
    },
    {
      key: "7",
      keybinding: "Shift + Mousewheel",
      action: "Change brush size (Brush mode)",
    },
  ];

  return (
    <div className="container help">
      <h3>Keyboard Shortcuts</h3>
      <p>Find all available keyboard shortcuts for webKnossos listed below.</p>

      <h3>Orthogonal Mode</h3>
      <Table dataSource={orthogonalShortcuts} columns={columns} pagination={false} />

      <h3>3D View</h3>
      <Table dataSource={ThreeDShortcuts} columns={columns} pagination={false} />

      <h3>General Navigation</h3>
      <Table dataSource={generalShortcuts} columns={columns} pagination={false} />

      <h3>Oblique/Flight Mode</h3>
      <Table dataSource={flightModeShortcuts} columns={columns} pagination={false} />

      <h3>Volume Mode</h3>
      <Table dataSource={volumeModeShortcuts} columns={columns} pagination={false} />
    </div>
  );
};

export default KeyboardShortcutView;
