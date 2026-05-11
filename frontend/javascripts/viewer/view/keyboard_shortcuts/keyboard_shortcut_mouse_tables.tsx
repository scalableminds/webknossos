import Icon, { InfoCircleOutlined } from "@ant-design/icons";
import IconStatusbarMouseLeft from "@images/icons/icon-statusbar-mouse-left.svg?react";
import IconStatusbarMouseLeftDrag from "@images/icons/icon-statusbar-mouse-left-drag.svg?react";
import IconStatusbarMouseMove from "@images/icons/icon-statusbar-mouse-move.svg?react";
import IconStatusbarMouseRight from "@images/icons/icon-statusbar-mouse-right.svg?react";
import IconStatusbarMouseRightDrag from "@images/icons/icon-statusbar-mouse-right-drag.svg?react";
import IconStatusbarMouseWheel from "@images/icons/icon-statusbar-mouse-wheel.svg?react";
import { Table, Typography } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import React from "react";
import { DOMAIN_DISPLAY_NAMES, type KeyboardShortcutDomain } from "./keyboard_shortcut_types";
import { keySequenceToUiElements } from "./keyboard_shortcut_utils";

const { Title } = Typography;

function MouseLeftClick() {
  return (
    <FastTooltip title="Press left mouse button" className="mouse-icon-tooltip-wrapper">
      <Icon
        component={IconStatusbarMouseLeft}
        aria-label="Left Mouse Click"
        className="mouse-icon-large"
      />
    </FastTooltip>
  );
}

function MouseLeftDrag() {
  return (
    <FastTooltip
      title="Keep left mouse button pressed & drag"
      className="mouse-icon-tooltip-wrapper"
    >
      <Icon
        component={IconStatusbarMouseLeftDrag}
        aria-label="Left Mouse Drag"
        className="mouse-icon-large"
      />
    </FastTooltip>
  );
}

function MouseMove() {
  return (
    <FastTooltip title="Move mouse (no button pressed)" className="mouse-icon-tooltip-wrapper">
      <Icon
        component={IconStatusbarMouseMove}
        aria-label="Mouse Move"
        className="mouse-icon-large"
      />
    </FastTooltip>
  );
}

function MouseRightClick() {
  return (
    <FastTooltip title="Press right mouse button" className="mouse-icon-tooltip-wrapper">
      <Icon
        component={IconStatusbarMouseRight}
        aria-label="Right Mouse Click"
        className="mouse-icon-large"
      />
    </FastTooltip>
  );
}

function MouseRightDrag() {
  return (
    <FastTooltip
      title="Keep right mouse button pressed & drag"
      className="mouse-icon-tooltip-wrapper"
    >
      <Icon
        component={IconStatusbarMouseRightDrag}
        aria-label="Right Mouse Drag"
        className="mouse-icon-large"
      />
    </FastTooltip>
  );
}

function MouseWheel() {
  return (
    <FastTooltip title="Scroll with the mouse wheel" className="mouse-icon-tooltip-wrapper">
      <Icon
        component={IconStatusbarMouseWheel}
        aria-label="Mouse Wheel"
        className="mouse-icon-large"
      />
    </FastTooltip>
  );
}

const EMPTY_MAP = new Map();

function modifierKeyToUiElement(modifier: string) {
  return keySequenceToUiElements([[modifier]], false, "", EMPTY_MAP);
}

type MouseShortcutEntry = {
  shortcuts: React.ReactNode[];
  action: string;
};

const mouseShortcutColumns = [
  {
    title: "Action",
    dataIndex: "action",
    key: "action",
  },
  {
    title: "Shortcuts",
    dataIndex: "shortcuts",
    key: "shortcuts",
    width: "50%",
    render: (shortcuts: React.ReactNode[]) => (
      <div className="keyboard-shortcuts-container">
        {shortcuts.map((shortcut, index) => (
          <div key={index} className="single-keyboard-shortcut-container">
            <span style={{ padding: "0px 4px" }}>{shortcut}</span>
          </div>
        ))}
      </div>
    ),
  },
];

function MouseShortcutDomainTable({
  domainName,
  data,
  classicControlsSpecific,
  orthoViewportOnly,
  tdViewportOnly,
}: {
  domainName: KeyboardShortcutDomain | string;
  data: MouseShortcutEntry[];
  classicControlsSpecific?: boolean;
  orthoViewportOnly?: boolean;
  tdViewportOnly?: boolean;
}) {
  return (
    <div>
      <Title level={5}>
        {DOMAIN_DISPLAY_NAMES[domainName as KeyboardShortcutDomain] ?? domainName}{" "}
        {"(mouse-specific)"}
        {classicControlsSpecific ? " (with Classic Controls active)" : ""}
        {orthoViewportOnly ? " (Ortho Viewports only)" : ""}
        {tdViewportOnly ? " (3D Viewport only)" : ""}{" "}
        <FastTooltip title="Mouse shortcuts are not editable.">
          <InfoCircleOutlined />
        </FastTooltip>
      </Title>
      <Table
        dataSource={data}
        rowKey="action"
        columns={mouseShortcutColumns}
        pagination={false}
        size="small"
        className="keyboard-shortcut-table-modal"
      />
    </div>
  );
}

// Shared entries used in both FlightNavigation and SkeletonTool tables
const mergeActiveNodeEntry: MouseShortcutEntry = {
  shortcuts: [
    <React.Fragment key="1">
      {modifierKeyToUiElement("Shift")} + {modifierKeyToUiElement("Alt")} + <MouseLeftClick />
    </React.Fragment>,
  ],
  action: "Merge with Active Node and Combine Trees",
};

const deleteEdgeEntry: MouseShortcutEntry = {
  shortcuts: [
    <React.Fragment key="1">
      {modifierKeyToUiElement("Shift")} + {modifierKeyToUiElement("Ctrl")}/
      {modifierKeyToUiElement("Meta")} + <MouseLeftClick />
    </React.Fragment>,
  ],
  action: "Delete Edge to this Node and Split Trees",
};

export function FlightNavigationMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="FLIGHT_NAVIGATION"
      data={[
        {
          shortcuts: [<MouseLeftClick key="1" />],
          action: "Select And Move To Node",
        },
        {
          shortcuts: [<MouseLeftDrag key="1" />],
          action: "Rotate around current position",
        },
        mergeActiveNodeEntry,
        deleteEdgeEntry,
      ]}
    />
  );
}

export function PlaneGeneralEditingMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="GENERAL_EDITING"
      data={[
        {
          shortcuts: [<MouseRightClick key="1" />],
          action: "Open Context Menu",
        },
      ]}
    />
  );
}

export function PlaneNavigationMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="PLANE_NAVIGATION"
      data={[
        {
          shortcuts: [
            <MouseLeftDrag key="1" />,
            <React.Fragment key="2">
              {modifierKeyToUiElement("Alt")} + <MouseMove />
            </React.Fragment>,
          ],
          action: "Move In-Plane",
        },
        {
          shortcuts: [<MouseWheel key="1" />],
          action: "Move One Slice Forward or Backward",
        },
        {
          shortcuts: [<MouseLeftDrag key="1" />],
          action: "Move 3D viewport",
        },
        {
          shortcuts: [<MouseRightDrag key="1" />],
          action: "Rotate 3D viewport",
        },
      ]}
    />
  );
}

export function PlaneTdViewportMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="Mesh Related"
      tdViewportOnly
      data={[
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Shift")} + <MouseLeftClick />
            </React.Fragment>,
          ],
          action: "Move the camera to the clicked position",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Ctrl")}/{modifierKeyToUiElement("Meta")} + <MouseLeftClick />
            </React.Fragment>,
          ],
          action: "Select the mesh and its segment ID",
        },
      ]}
    />
  );
}

export function SkeletonToolMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="PLANE_SKELETON_TOOL"
      data={[
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Shift")} + <MouseWheel />
            </React.Fragment>,
          ],
          action: "Change Node Radius",
        },
        {
          shortcuts: [<MouseLeftClick key="1" />],
          action: "Create New Node / Select Hovered Node",
        },
        {
          shortcuts: [<MouseLeftDrag key="1" />],
          action: "Move Node Under Cursor",
        },
        {
          shortcuts: [<MouseRightClick key="1" />],
          action: "Open Context Menu with Hovered Node Related Options",
        },
        mergeActiveNodeEntry,
        deleteEdgeEntry,
      ]}
    />
  );
}

export function SkeletonToolClassicControlsMouseShortcutsTable() {
  const areClassicControlsUsed = useWkSelector(
    (state) => state.userConfiguration.useLegacyBindings,
  );
  return areClassicControlsUsed ? (
    <MouseShortcutDomainTable
      domainName="PLANE_SKELETON_TOOL"
      classicControlsSpecific
      data={[
        {
          shortcuts: [<MouseRightClick key="1" />],
          action: "Create New Node",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Shift")} + <MouseLeftClick />
            </React.Fragment>,
          ],
          action: "Select Hovered Node",
        },
      ]}
    />
  ) : null;
}

export function VolumeToolMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="PLANE_VOLUME_TOOL"
      data={[
        {
          shortcuts: [<MouseLeftDrag key="1" />],
          action: "Add to Current Segment (Draw)",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Ctrl")}/{modifierKeyToUiElement("Meta")} + <MouseLeftDrag />
            </React.Fragment>,
          ],
          action: "Add to Current Segment (Draw) with Inverted Overwrite Mode",
        },
        {
          shortcuts: [<React.Fragment key="1">{modifierKeyToUiElement("Shift")}</React.Fragment>],
          action: "Quick Switch to Segment Picker Tool",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Ctrl")}/{modifierKeyToUiElement("Meta")} +{" "}
              {modifierKeyToUiElement("Shift")}
            </React.Fragment>,
          ],
          action: "Quick Switch to Eraser Tool",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Shift")} + <MouseWheel />
            </React.Fragment>,
          ],
          action: "Change Brush Size",
        },
      ]}
    />
  );
}

export function VolumeToolClassicControlsMouseShortcutsTable() {
  const areClassicControlsUsed = useWkSelector(
    (state) => state.userConfiguration.useLegacyBindings,
  );
  return areClassicControlsUsed ? (
    <MouseShortcutDomainTable
      domainName="PLANE_VOLUME_TOOL"
      classicControlsSpecific
      data={[
        {
          shortcuts: [<MouseRightDrag key="1" />],
          action: "Remove Voxels (Erase)",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Ctrl")}/{modifierKeyToUiElement("Meta")} + <MouseRightDrag />
            </React.Fragment>,
          ],
          action: "Remove Voxels (Erase) with Inverted Overwrite Mode",
        },
      ]}
    />
  ) : null;
}

export function ProofreadingToolMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="PLANE_PROOFREADING_TOOL"
      data={[
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Ctrl")}/{modifierKeyToUiElement("Meta")} + <MouseLeftClick />
            </React.Fragment>,
          ],
          action: "Add Segment to Partition One for Multi Cut",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Ctrl")}/{modifierKeyToUiElement("Meta")} +{" "}
              {modifierKeyToUiElement("Shift")} + <MouseLeftClick />
            </React.Fragment>,
          ],
          action: "Add Segment to Partition Two for Multi Cut",
        },
      ]}
    />
  );
}

export function ProofreadingToolOrthoMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="PLANE_PROOFREADING_TOOL"
      orthoViewportOnly
      data={[
        {
          shortcuts: [<MouseLeftClick key="1" />],
          action: "Activate Segment of Agglomerate for Proofreading Actions",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Shift")} + <MouseWheel />
            </React.Fragment>,
          ],
          action: "Import Agglomerate Tree of Hovered Agglomerate",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Shift")} + <MouseLeftClick />
            </React.Fragment>,
          ],
          action: "Merge with Active Segment",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Ctrl")}/{modifierKeyToUiElement("Meta")} + <MouseLeftClick />
            </React.Fragment>,
          ],
          action: "Split from Active Segment",
        },
      ]}
    />
  );
}

export function ProofreadingToolTDMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="PLANE_PROOFREADING_TOOL"
      tdViewportOnly
      data={[
        {
          shortcuts: [
            <React.Fragment key="1">
              {modifierKeyToUiElement("Ctrl")}/{modifierKeyToUiElement("Meta")} + <MouseWheel />
            </React.Fragment>,
          ],
          action: "Activate Segment of Agglomerate",
        },
      ]}
    />
  );
}
