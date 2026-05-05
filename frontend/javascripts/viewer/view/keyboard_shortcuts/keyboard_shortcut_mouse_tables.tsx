import Icon from "@ant-design/icons";
import IconStatusbarMouseLeft from "@images/icons/icon-statusbar-mouse-left.svg?react";
import IconStatusbarMouseLeftDrag from "@images/icons/icon-statusbar-mouse-left-drag.svg?react";
import IconStatusbarMouseMove from "@images/icons/icon-statusbar-mouse-move.svg?react";
import IconStatusbarMouseRight from "@images/icons/icon-statusbar-mouse-right.svg?react";
import IconStatusbarMouseRightDrag from "@images/icons/icon-statusbar-mouse-right-drag.svg?react";
import IconStatusbarMouseWheel from "@images/icons/icon-statusbar-mouse-wheel.svg?react";
import { Table, Typography } from "antd";
import { useWkSelector } from "libs/react_hooks";
import React from "react";
import { DOMAIN_DISPLAY_NAMES, type KeyboardShortcutDomain } from "./keyboard_shortcut_types";
import { keySequenceToUiElements } from "./keyboard_shortcut_utils";

const { Title } = Typography;

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
            {shortcut}
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
        {DOMAIN_DISPLAY_NAMES[domainName as KeyboardShortcutDomain] ?? domainName} Mouse Shortcuts
        {classicControlsSpecific ? " (with Classic Controls active)" : ""}
        {orthoViewportOnly ? " (Ortho Viewports only)" : ""}
        {tdViewportOnly ? " (3D Viewport only)" : ""}
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
      {keySequenceToUiElements([["Shift"]], false)} + {keySequenceToUiElements([["Alt"]], false)} +{" "}
      <Icon
        component={IconStatusbarMouseLeft}
        aria-label="Left Mouse Click"
        className="mouse-icon-large"
      />
    </React.Fragment>,
  ],
  action: "Merge with Active Node and Combine Trees",
};

const deleteEdgeEntry: MouseShortcutEntry = {
  shortcuts: [
    <React.Fragment key="1">
      {keySequenceToUiElements([["Shift"]], false)} + {keySequenceToUiElements([["Ctrl"]], false)}/
      {keySequenceToUiElements([["Meta"]], false)} +{" "}
      <Icon
        component={IconStatusbarMouseLeft}
        aria-label="Left Mouse Click"
        className="mouse-icon-large"
      />
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
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseLeft}
              aria-label="Left Mouse Click"
              className="mouse-icon-large"
            />,
          ],
          action: "Select And Move To Node",
        },
        {
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseLeftDrag}
              aria-label="Left Mouse Drag"
              className="mouse-icon-large"
            />,
          ],
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
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseRight}
              aria-label="Right Mouse Click"
              className="mouse-icon-large"
            />,
          ],
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
            <Icon
              key="1"
              component={IconStatusbarMouseLeftDrag}
              aria-label="Left Mouse Drag"
              className="mouse-icon-large"
            />,
            <React.Fragment key="2">
              {keySequenceToUiElements([["Alt"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseMove}
                aria-label="Mouse Move"
                className="mouse-icon-large"
              />
            </React.Fragment>,
          ],
          action: "Move In-Plane",
        },
        {
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseWheel}
              aria-label="Mouse Wheel"
              className="mouse-icon-large"
            />,
          ],
          action: "Move One Slice Forward or Backward",
        },
        {
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseLeftDrag}
              aria-label="Left Mouse Drag"
              className="mouse-icon-large"
            />,
          ],
          action: "Move 3D viewport",
        },
        {
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseRightDrag}
              aria-label="Right Mouse Drag"
              className="mouse-icon-large"
            />,
          ],
          action: "Rotate 3D viewport",
        },
      ]}
    />
  );
}

export function PlaneTdViewportMouseShortcutsTable() {
  return (
    <MouseShortcutDomainTable
      domainName="Mesh Click Related Shortcuts"
      tdViewportOnly
      data={[
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Shift"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseLeft}
                aria-label="Left Mouse Click"
                className="mouse-icon-large"
              />
            </React.Fragment>,
          ],
          action: "Move the camera to the clicked position",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Ctrl"]], false)}/
              {keySequenceToUiElements([["Meta"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseLeft}
                aria-label="Left Mouse Click"
                className="mouse-icon-large"
              />
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
              {keySequenceToUiElements([["Shift"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseWheel}
                aria-label="Mouse Wheel"
                className="mouse-icon-large"
              />
            </React.Fragment>,
          ],
          action: "Change Node Radius",
        },
        {
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseLeft}
              aria-label="Left Mouse Click"
              className="mouse-icon-large"
            />,
          ],
          action: "Create New Node / Select Hovered Node",
        },
        {
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseLeftDrag}
              aria-label="Left Mouse Drag"
              className="mouse-icon-large"
            />,
          ],
          action: "Move Node Under Cursor",
        },
        {
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseRight}
              aria-label="Right Mouse Click"
              className="mouse-icon-large"
            />,
          ],
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
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseRight}
              aria-label="Right Mouse Click"
              className="mouse-icon-large"
            />,
          ],
          action: "Create New Node",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Shift"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseLeft}
                aria-label="Left Mouse Click"
                className="mouse-icon-large"
              />
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
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseLeftDrag}
              aria-label="Left Mouse Drag"
              className="mouse-icon-large"
            />,
          ],
          action: "Add to Current Segment (Draw)",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Ctrl"]], false)}/
              {keySequenceToUiElements([["Meta"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseLeftDrag}
                aria-label="Left Mouse Drag"
                className="mouse-icon-large"
              />
            </React.Fragment>,
          ],
          action: "Add to Current Segment (Draw) with Inverted Overwrite Mode",
        },
        {
          shortcuts: [
            <React.Fragment key="1">{keySequenceToUiElements([["Shift"]], false)}</React.Fragment>,
          ],
          action: "Quick Switch to Segment Picker Tool",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Ctrl"]], false)}/
              {keySequenceToUiElements([["Meta"]], false)} +{" "}
              {keySequenceToUiElements([["Shift"]], false)}
            </React.Fragment>,
          ],
          action: "Quick Switch to Eraser Tool",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Shift"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseWheel}
                aria-label="Mouse Wheel"
                className="mouse-icon-large"
              />
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
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseRightDrag}
              aria-label="Right Mouse Drag"
              className="mouse-icon-large"
            />,
          ],
          action: "Remove Voxels (Erase)",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Ctrl"]], false)}/
              {keySequenceToUiElements([["Meta"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseRightDrag}
                aria-label="Right Mouse Drag"
                className="mouse-icon-large"
              />
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
              {keySequenceToUiElements([["Ctrl"]], false)}/
              {keySequenceToUiElements([["Meta"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseLeft}
                aria-label="Left Mouse Click"
                className="mouse-icon-large"
              />
            </React.Fragment>,
          ],
          action: "Add Segment to Partition One for Multi Cut",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Ctrl"]], false)}/
              {keySequenceToUiElements([["Meta"]], false)} +{" "}
              {keySequenceToUiElements([["Shift"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseLeft}
                aria-label="Left Mouse Click"
                className="mouse-icon-large"
              />
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
          shortcuts: [
            <Icon
              key="1"
              component={IconStatusbarMouseLeft}
              aria-label="Left Mouse Click"
              className="mouse-icon-large"
            />,
          ],
          action: "Activate Segment of Agglomerate for Proofreading Actions",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Shift"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseWheel}
                aria-label="Mouse Wheel Click"
                className="mouse-icon-large"
              />
            </React.Fragment>,
          ],
          action: "Import Agglomerate Tree of Hovered Agglomerate",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Shift"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseLeft}
                aria-label="Left Mouse Click"
                className="mouse-icon-large"
              />
            </React.Fragment>,
          ],
          action: "Merge with Active Segment",
        },
        {
          shortcuts: [
            <React.Fragment key="1">
              {keySequenceToUiElements([["Ctrl"]], false)}/
              {keySequenceToUiElements([["Meta"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseLeft}
                aria-label="Left Mouse Click"
                className="mouse-icon-large"
              />
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
              {keySequenceToUiElements([["Ctrl"]], false)}/
              {keySequenceToUiElements([["Meta"]], false)} +{" "}
              <Icon
                component={IconStatusbarMouseWheel}
                aria-label="Mouse Wheel Click"
                className="mouse-icon-large"
              />
            </React.Fragment>,
          ],
          action: "Activate Segment of Agglomerate",
        },
      ]}
    />
  );
}
