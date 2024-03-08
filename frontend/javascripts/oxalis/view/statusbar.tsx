import { Tooltip } from "antd";
import { useDispatch, useSelector } from "react-redux";
import React, { useCallback, useState } from "react";
import { WarningOutlined, MoreOutlined, DownloadOutlined } from "@ant-design/icons";
import type { Vector3 } from "oxalis/constants";
import { AltOrOptionKey, OrthoViews } from "oxalis/constants";
import {
  getVisibleSegmentationLayer,
  hasVisibleUint64Segmentation,
} from "oxalis/model/accessors/dataset_accessor";
import { NumberInputPopoverSetting } from "oxalis/view/components/setting_input_views";
import { useKeyPress } from "libs/react_hooks";
import { getActiveResolutionInfo } from "oxalis/model/accessors/flycam_accessor";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import {
  setActiveNodeAction,
  setActiveTreeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import message from "messages";
import {
  ActionDescriptor,
  getToolClassForAnnotationTool,
} from "oxalis/controller/combinations/tool_controls";
import {
  calculateGlobalPos,
  isPlaneMode as getIsPlaneMode,
} from "oxalis/model/accessors/view_mode_accessor";
import { adaptActiveToolToShortcuts } from "oxalis/model/accessors/tool_accessor";
import { V3 } from "libs/mjs";
import { Model } from "oxalis/singletons";
import { OxalisState } from "oxalis/store";
import {
  getActiveSegmentationTracing,
  getReadableNameForLayerName,
} from "oxalis/model/accessors/volumetracing_accessor";
import { getGlobalDataConnectionInfo } from "oxalis/model/data_connection_info";
import { useInterval } from "libs/react_helpers";
import _ from "lodash";
import { AdditionalCoordinate } from "types/api_flow_types";
import { EmptyObject } from "types/globals";

const lineColor = "rgba(255, 255, 255, 0.67)";
const moreIconStyle = {
  height: 14,
  color: lineColor,
};
const moreLinkStyle = {
  marginLeft: 10,
  marginRight: "auto",
};

function getPosString(
  pos: Vector3,
  optAdditionalCoordinates: AdditionalCoordinate[] | null | undefined,
) {
  const additionalCoordinates = (optAdditionalCoordinates || []).map((coord) => coord.value);
  return V3.floor(pos).concat(additionalCoordinates).join(",");
}

function ZoomShortcut() {
  return (
    <span key="zoom" className="shortcut-info-element">
      <span
        key="zoom-i"
        className="keyboard-key-icon-small"
        style={{
          borderColor: lineColor,
          marginTop: -1,
        }}
      >
        {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
        <span
          style={{
            position: "relative",
            top: -2,
          }}
        >
          {AltOrOptionKey}
        </span>
      </span>{" "}
      +
      <img
        className="keyboard-mouse-icon"
        src="/assets/images/icon-statusbar-mouse-wheel.svg"
        alt="Mouse Wheel"
      />
      Zoom in/out
    </span>
  );
}

function LeftClickShortcut({ actionDescriptor }: { actionDescriptor: ActionDescriptor }) {
  const leftClick =
    actionDescriptor.leftClick != null ? (
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-left.svg"
          alt="Mouse Left Click"
        />
        {actionDescriptor.leftClick}
      </span>
    ) : null;
  const leftDrag =
    actionDescriptor.leftDrag != null ? (
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-left-drag.svg"
          alt="Mouse Left Drag"
        />
        {actionDescriptor.leftDrag}
      </span>
    ) : null;
  return (
    <span>
      {leftClick}
      {leftDrag}
    </span>
  );
}

function RightClickShortcut({ actionDescriptor }: { actionDescriptor: ActionDescriptor }) {
  const rightClick =
    actionDescriptor.rightClick != null ? (
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-right.svg"
          alt="Mouse Right Click"
        />
        {actionDescriptor.rightClick}
      </span>
    ) : null;
  const rightDrag =
    actionDescriptor.rightDrag != null ? (
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-right-drag.svg"
          alt="Mouse Right Drag"
        />
        {actionDescriptor.rightDrag}
      </span>
    ) : null;
  return (
    <React.Fragment>
      {rightClick}
      {rightDrag}
    </React.Fragment>
  );
}

function ShortcutsInfo() {
  const activeTool = useSelector((state: OxalisState) => state.uiInformation.activeTool);
  const useLegacyBindings = useSelector(
    (state: OxalisState) => state.userConfiguration.useLegacyBindings,
  );
  const isPlaneMode = useSelector((state: OxalisState) => getIsPlaneMode(state));
  const isShiftPressed = useKeyPress("Shift");
  const isControlOrMetaPressed = useKeyPress("ControlOrMeta");
  const isAltPressed = useKeyPress("Alt");
  const hasSkeleton = useSelector((state: OxalisState) => state.tracing.skeleton != null);

  const moreShortcutsLink = (
    <a
      target="_blank"
      href="https://docs.webknossos.org/webknossos/keyboard_shortcuts.html"
      rel="noopener noreferrer"
      style={moreLinkStyle}
    >
      <Tooltip title="More Shortcuts">
        <MoreOutlined rotate={90} style={moreIconStyle} />
      </Tooltip>
    </a>
  );

  if (!isPlaneMode) {
    let actionDescriptor = null;
    if (hasSkeleton && isShiftPressed) {
      actionDescriptor = getToolClassForAnnotationTool("SKELETON").getActionDescriptors(
        "SKELETON",
        useLegacyBindings,
        isShiftPressed,
        isControlOrMetaPressed,
        isAltPressed,
      );
    }
    console.log("actionDescriptor", actionDescriptor);

    return (
      <React.Fragment>
        {actionDescriptor != null ? (
          <LeftClickShortcut actionDescriptor={actionDescriptor} />
        ) : (
          <span
            className="shortcut-info-element"
            style={{
              textTransform: "capitalize",
            }}
          >
            <img
              className="keyboard-mouse-icon"
              src="/assets/images/icon-statusbar-mouse-left-drag.svg"
              alt="Mouse Left Drag"
            />
            Move
          </span>
        )}

        <span className="shortcut-info-element">
          <span
            key="space-forward-i"
            className="keyboard-key-icon-small"
            style={{
              borderColor: lineColor,
              marginTop: -1,
            }}
          >
            {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
            <span
              style={{
                position: "relative",
                top: -2,
              }}
            >
              Space
            </span>
          </span>{" "}
          Trace forward
        </span>
        <span className="shortcut-info-element">
          <span
            key="ctrl-back-i"
            className="keyboard-key-icon-small"
            style={{
              borderColor: lineColor,
              marginTop: -1,
            }}
          >
            {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
            <span
              style={{
                position: "relative",
                top: -2,
              }}
            >
              CTRL
            </span>
          </span>{" "}
          <span
            key="space-back-i"
            className="keyboard-key-icon-small"
            style={{
              borderColor: lineColor,
              marginTop: -1,
            }}
          >
            {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
            <span
              style={{
                position: "relative",
                top: -2,
              }}
            >
              Space
            </span>
          </span>{" "}
          Trace backward
        </span>
        <span className="shortcut-info-element">
          <span
            key="arrow-left-i"
            className="keyboard-key-icon-small"
            style={{
              borderColor: lineColor,
              marginTop: -1,
            }}
          >
            {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
            <span
              style={{
                position: "relative",
                top: -2,
              }}
            >
              ◀
            </span>
          </span>{" "}
          <span
            key="arrow-right-i"
            className="keyboard-key-icon-small"
            style={{
              borderColor: lineColor,
              marginTop: -1,
            }}
          >
            {/* Move text up to vertically center it in the border from keyboard-key-icon-small */}
            <span
              style={{
                position: "relative",
                top: -2,
              }}
            >
              ▶
            </span>
          </span>{" "}
          Rotation
        </span>
        {moreShortcutsLink}
      </React.Fragment>
    );
  }

  const adaptedTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
  );
  const actionDescriptor = getToolClassForAnnotationTool(adaptedTool).getActionDescriptors(
    adaptedTool,
    useLegacyBindings,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
  );

  return (
    <React.Fragment>
      <LeftClickShortcut actionDescriptor={actionDescriptor} />
      <RightClickShortcut actionDescriptor={actionDescriptor} />
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-wheel.svg"
          alt="Mouse Wheel"
        />
        {isAltPressed || isControlOrMetaPressed ? "Zoom in/out" : "Move along 3rd axis"}
      </span>
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-right-drag.svg"
          alt="Mouse Right"
        />
        Rotate 3D View
      </span>
      <ZoomShortcut />
      {moreShortcutsLink}
    </React.Fragment>
  );
}

function getCellInfo(globalMousePosition: Vector3 | null | undefined) {
  const getSegmentIdString = (): string => {
    const hoveredCellInfo = Model.getHoveredCellId(globalMousePosition);

    if (!hoveredCellInfo) {
      return "-";
    }

    return hoveredCellInfo.isMapped ? `${hoveredCellInfo.id} (mapped)` : `${hoveredCellInfo.id}`;
  };

  return <span className="info-element">Segment {getSegmentIdString()}</span>;
}

function maybeLabelWithSegmentationWarning(isUint64SegmentationVisible: boolean, label: string) {
  return isUint64SegmentationVisible ? (
    <React.Fragment>
      {label}{" "}
      <Tooltip title={message["tracing.uint64_segmentation_warning"]}>
        <WarningOutlined
          style={{
            color: "var(--ant-color-warning)",
          }}
        />
      </Tooltip>
    </React.Fragment>
  ) : (
    label
  );
}

function Infos() {
  const dataset = useSelector((state: OxalisState) => state.dataset);
  const tracing = useSelector((state: OxalisState) => state.tracing);
  const { representativeResolution, activeMagOfEnabledLayers, isActiveResolutionGlobal } =
    useSelector((state: OxalisState) => getActiveResolutionInfo(state));

  const isSkeletonAnnotation = useSelector((state: OxalisState) => state.tracing.skeleton != null);
  const activeVolumeTracing = useSelector((state: OxalisState) =>
    getActiveSegmentationTracing(state),
  );
  const [currentBucketDownloadSpeed, setCurrentBucketDownloadSpeed] = useState<number>(0);
  const [totalDownloadedByteCount, setTotalDownloadedByteCount] = useState<number>(0);
  useInterval(() => {
    const { avgDownloadSpeedInBytesPerS, accumulatedDownloadedBytes } =
      getGlobalDataConnectionInfo().getStatistics();
    setCurrentBucketDownloadSpeed(avgDownloadSpeedInBytesPerS);
    setTotalDownloadedByteCount(accumulatedDownloadedBytes);
  }, 1500);
  const activeCellId = activeVolumeTracing?.activeCellId;
  const activeNodeId = useSelector((state: OxalisState) =>
    state.tracing.skeleton ? state.tracing.skeleton.activeNodeId : null,
  );
  const activeTreeId = useSelector((state: OxalisState) =>
    state.tracing.skeleton ? state.tracing.skeleton.activeTreeId : null,
  );
  const dispatch = useDispatch();

  const onChangeActiveCellId = useCallback(
    (id: number) => dispatch(setActiveCellAction(id)),
    [dispatch],
  );
  const onChangeActiveNodeId = useCallback(
    (id: number) => dispatch(setActiveNodeAction(id)),
    [dispatch],
  );
  const onChangeActiveTreeId = useCallback(
    (id: number) => dispatch(setActiveTreeAction(id)),
    [dispatch],
  );

  const isUint64SegmentationVisible = useSelector(hasVisibleUint64Segmentation);

  return (
    <React.Fragment>
      <SegmentAndMousePosition />
      <span className="info-element">
        <Tooltip
          title={`Downloaded ${formatCountToDataAmountUnit(
            totalDownloadedByteCount,
          )} of Image Data (after decompression)`}
        >
          <DownloadOutlined className="icon-margin-right" />
          {formatCountToDataAmountUnit(currentBucketDownloadSpeed)}/s
        </Tooltip>
      </span>
      {activeVolumeTracing != null ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeCellId}
            label={maybeLabelWithSegmentationWarning(isUint64SegmentationVisible, "Active Segment")}
            min={0}
            detailedLabel={maybeLabelWithSegmentationWarning(
              isUint64SegmentationVisible,
              "Change Active Segment ID",
            )}
            onChange={onChangeActiveCellId}
          />
        </span>
      ) : null}
      {isSkeletonAnnotation ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeNodeId}
            label="Active Node"
            detailedLabel="Change Active Node ID"
            onChange={onChangeActiveNodeId}
          />
        </span>
      ) : null}
      {isSkeletonAnnotation ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeTreeId}
            label="Active Tree"
            detailedLabel="Change Active Tree ID"
            onChange={onChangeActiveTreeId}
          />
        </span>
      ) : null}
      {representativeResolution && (
        <span className="info-element">
          <img
            src="/assets/images/icon-statusbar-downsampling.svg"
            className="resolution-status-bar-icon"
            alt="Resolution"
          />{" "}
          <Tooltip
            title={
              <>
                Rendered magnification per layer:
                <ul>
                  {Object.entries(activeMagOfEnabledLayers).map(([layerName, mag]) => {
                    const readableName = getReadableNameForLayerName(dataset, tracing, layerName);

                    return (
                      <li key={layerName}>
                        {readableName}: {mag ? mag.join("-") : "none"}
                      </li>
                    );
                  })}
                </ul>
              </>
            }
          >
            {representativeResolution.join("-")}
            {isActiveResolutionGlobal ? "" : "*"}{" "}
          </Tooltip>
        </span>
      )}
    </React.Fragment>
  );
}

function SegmentAndMousePosition() {
  // This component depends on the mouse position which is a fast-changing property.
  // For the sake of performance, it is isolated as a single component.
  const hasVisibleSegmentation = useSelector(
    (state: OxalisState) => getVisibleSegmentationLayer(state) != null,
  );
  const mousePosition = useSelector(
    (state: OxalisState) => state.temporaryConfiguration.mousePosition,
  );
  const additionalCoordinates = useSelector(
    (state: OxalisState) => state.flycam.additionalCoordinates,
  );
  const isPlaneMode = useSelector((state: OxalisState) => getIsPlaneMode(state));
  const globalMousePosition = useSelector((state: OxalisState) => {
    const { activeViewport } = state.viewModeData.plane;

    if (mousePosition && activeViewport !== OrthoViews.TDView) {
      const [x, y] = mousePosition;
      return calculateGlobalPos(state, {
        x,
        y,
      });
    }

    return undefined;
  });
  return (
    <>
      {isPlaneMode && hasVisibleSegmentation ? getCellInfo(globalMousePosition) : null}
      {isPlaneMode ? (
        <span className="info-element">
          Pos [
          {globalMousePosition ? getPosString(globalMousePosition, additionalCoordinates) : "-,-,-"}
          ]
        </span>
      ) : null}
    </>
  );
}

class Statusbar extends React.PureComponent<EmptyObject, EmptyObject> {
  render() {
    return (
      <span className="statusbar">
        <ShortcutsInfo />
        <Infos />
      </span>
    );
  }
}

export default Statusbar;
