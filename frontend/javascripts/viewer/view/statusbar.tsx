import { DownloadOutlined, MoreOutlined, WarningOutlined } from "@ant-design/icons";
import FastTooltip from "components/fast_tooltip";
import { formatCountToDataAmountUnit } from "libs/format_utils";
import { V3 } from "libs/mjs";
import { useInterval } from "libs/react_helpers";
import { useKeyPress } from "libs/react_hooks";
import { useWkSelector } from "libs/react_hooks";
import message from "messages";
import messages from "messages";
import React, { useCallback, useState } from "react";
import { useDispatch } from "react-redux";
import type { AdditionalCoordinate } from "types/api_types";
import type { Vector3 } from "viewer/constants";
import { AltOrOptionKey, MappingStatusEnum, OrthoViews } from "viewer/constants";
import {
  type ActionDescriptor,
  getToolControllerForAnnotationTool,
} from "viewer/controller/combinations/tool_controls";
import {
  getMappingInfoOrNull,
  getVisibleSegmentationLayer,
  hasVisibleUint64Segmentation,
} from "viewer/model/accessors/dataset_accessor";
import { getActiveMagInfo } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool, adaptActiveToolToShortcuts } from "viewer/model/accessors/tool_accessor";
import {
  calculateGlobalPos,
  isPlaneMode as getIsPlaneMode,
} from "viewer/model/accessors/view_mode_accessor";
import {
  getActiveSegmentationTracing,
  getReadableNameForLayerName,
  getSegmentationLayerForTracing,
} from "viewer/model/accessors/volumetracing_accessor";
import {
  setActiveNodeAction,
  setActiveTreeAction,
} from "viewer/model/actions/skeletontracing_actions";
import { setActiveCellAction } from "viewer/model/actions/volumetracing_actions";
import { getSupportedValueRangeForElementClass } from "viewer/model/bucket_data_handling/data_rendering_logic";
import { getGlobalDataConnectionInfo } from "viewer/model/data_connection_info";
import { Store } from "viewer/singletons";
import { NumberInputPopoverSetting } from "viewer/view/components/setting_input_views";
import { CommandPalette } from "./components/command_palette";

const lineColor = "rgba(255, 255, 255, 0.67)";
const moreIconStyle = {
  height: 14,
  color: lineColor,
};
const moreLinkStyle = {
  marginLeft: 25,
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

const getMoreShortcutsInfo = () => {
  return (
    <>
      <CommandPalette label={<div style={{ marginLeft: 25 }}>[Ctrl+P] Commands</div>} />
      {moreShortcutsLink}
    </>
  );
};

const moreShortcutsLink = (
  <a
    target="_blank"
    href="https://docs.webknossos.org/webknossos/ui/keyboard_shortcuts.html"
    rel="noopener noreferrer"
    style={moreLinkStyle}
  >
    <FastTooltip title="More Shortcuts">
      <MoreOutlined rotate={90} style={moreIconStyle} />
    </FastTooltip>
  </a>
);

function ShortcutsInfo() {
  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const userConfiguration = useWkSelector((state) => state.userConfiguration);
  const isPlaneMode = useWkSelector((state) => getIsPlaneMode(state));
  const isShiftPressed = useKeyPress("Shift");
  const isControlOrMetaPressed = useKeyPress("ControlOrMeta");
  const isAltPressed = useKeyPress("Alt");
  const hasSkeleton = useWkSelector((state) => state.annotation.skeleton != null);
  const isTDViewportActive = useWkSelector(
    (state) => state.viewModeData.plane.activeViewport === OrthoViews.TDView,
  );

  if (!isPlaneMode) {
    let actionDescriptor = null;
    if (hasSkeleton && isShiftPressed) {
      actionDescriptor = getToolControllerForAnnotationTool(
        AnnotationTool.SKELETON,
      ).getActionDescriptors(
        AnnotationTool.SKELETON,
        userConfiguration,
        isShiftPressed,
        isControlOrMetaPressed,
        isAltPressed,
        isTDViewportActive,
      );
    }

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
        {getMoreShortcutsInfo()}
      </React.Fragment>
    );
  }

  const adaptedTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
  );
  const toolController = getToolControllerForAnnotationTool(adaptedTool);
  const actionDescriptor = toolController.getActionDescriptors(
    adaptedTool,
    userConfiguration,
    isShiftPressed,
    isControlOrMetaPressed,
    isAltPressed,
    isTDViewportActive,
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
      {getMoreShortcutsInfo()}
    </React.Fragment>
  );
}

function SegmentInfo() {
  const visibleSegmentationLayer = useWkSelector((state) => getVisibleSegmentationLayer(state));
  const hasVisibleSegmentation = visibleSegmentationLayer != null;
  const activeMappingInfo = useWkSelector((state) =>
    getMappingInfoOrNull(
      state.temporaryConfiguration.activeMappingByLayer,
      visibleSegmentationLayer?.name,
    ),
  );
  const hoveredSegmentId = useWkSelector((state) => state.temporaryConfiguration.hoveredSegmentId);

  if (hasVisibleSegmentation == null) {
    return null;
  }

  const idString =
    hoveredSegmentId == null
      ? "-"
      : activeMappingInfo?.mappingStatus === MappingStatusEnum.ENABLED
        ? `${hoveredSegmentId} (mapped)`
        : `${hoveredSegmentId}`;

  return <span className="info-element">Segment {idString}</span>;
}

function maybeLabelWithSegmentationWarning(isUint64SegmentationVisible: boolean, label: string) {
  return isUint64SegmentationVisible ? (
    <React.Fragment>
      {label}{" "}
      <FastTooltip title={message["tracing.uint64_segmentation_warning"]}>
        <WarningOutlined
          style={{
            color: "var(--ant-color-warning)",
          }}
        />
      </FastTooltip>
    </React.Fragment>
  ) : (
    label
  );
}

function Infos() {
  const isSkeletonAnnotation = useWkSelector((state) => state.annotation.skeleton != null);
  const activeVolumeTracing = useWkSelector((state) => getActiveSegmentationTracing(state));

  const activeCellId = activeVolumeTracing?.activeCellId;
  const activeNodeId = useWkSelector((state) =>
    state.annotation.skeleton ? state.annotation.skeleton.activeNodeId : null,
  );
  const activeTreeId = useWkSelector((state) =>
    state.annotation.skeleton ? state.annotation.skeleton.activeTreeId : null,
  );
  const dispatch = useDispatch();

  const onChangeActiveCellId = useCallback(
    (id: number) => dispatch(setActiveCellAction(id)),
    [dispatch],
  );
  const onChangeActiveNodeId = useCallback(
    (id: number) => {
      dispatch(setActiveNodeAction(id));
    },
    [dispatch],
  );
  const onChangeActiveTreeId = useCallback(
    (id: number) => dispatch(setActiveTreeAction(id)),
    [dispatch],
  );

  const validSegmentIdRange = useWkSelector((state) => {
    if (!activeVolumeTracing) {
      return null;
    }
    const segmentationLayer = getSegmentationLayerForTracing(state, activeVolumeTracing);
    const elementClass = segmentationLayer.elementClass;
    return getSupportedValueRangeForElementClass(elementClass);
  });

  const isUint64SegmentationVisible = useWkSelector(hasVisibleUint64Segmentation);

  return (
    <React.Fragment>
      <SegmentAndMousePosition />
      <span className="info-element">
        <DownloadSpeedometer />
      </span>
      {activeVolumeTracing != null && validSegmentIdRange != null ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeCellId}
            label={maybeLabelWithSegmentationWarning(isUint64SegmentationVisible, "Active Segment")}
            min={validSegmentIdRange[0]}
            max={validSegmentIdRange[1]}
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
      <MagnificationInfo />
    </React.Fragment>
  );
}

function DownloadSpeedometer() {
  const [currentBucketDownloadSpeed, setCurrentBucketDownloadSpeed] = useState<number>(0);
  const [totalDownloadedByteCount, setTotalDownloadedByteCount] = useState<number>(0);
  useInterval(() => {
    const { avgDownloadSpeedInBytesPerS, accumulatedDownloadedBytes } =
      getGlobalDataConnectionInfo().getStatistics();
    setCurrentBucketDownloadSpeed(avgDownloadSpeedInBytesPerS);
    setTotalDownloadedByteCount(accumulatedDownloadedBytes);
  }, 1500);

  return (
    <FastTooltip
      title={`Downloaded ${formatCountToDataAmountUnit(
        totalDownloadedByteCount,
      )} of Image Data (after decompression)`}
    >
      <DownloadOutlined className="icon-margin-right" />
      {formatCountToDataAmountUnit(currentBucketDownloadSpeed)}/s
    </FastTooltip>
  );
}

function MagnificationInfo() {
  const { representativeMag, isActiveMagGlobal } = useWkSelector(getActiveMagInfo);

  const renderMagTooltipContent = useCallback(() => {
    const state = Store.getState();
    const { activeMagOfEnabledLayers } = getActiveMagInfo(state);
    const dataset = state.dataset;
    const annotation = state.annotation;

    return (
      <div style={{ width: 200 }}>
        Rendered magnification per layer:
        <ul>
          {Object.entries(activeMagOfEnabledLayers).map(([layerName, mag]) => {
            const readableName = getReadableNameForLayerName(dataset, annotation, layerName);

            return (
              <li key={layerName}>
                {readableName}: {mag ? mag.join("-") : "none"}
              </li>
            );
          })}
        </ul>
        {messages["dataset.mag_explanation"]}
      </div>
    );
  }, []);

  if (representativeMag == null) {
    return null;
  }

  return (
    <span className="info-element">
      <img
        src="/assets/images/icon-statusbar-downsampling.svg"
        className="mag-status-bar-icon"
        alt="Magnification"
      />{" "}
      <FastTooltip dynamicRenderer={renderMagTooltipContent} placement="top">
        {representativeMag.join("-")}
        {isActiveMagGlobal ? "" : "*"}{" "}
      </FastTooltip>
    </span>
  );
}

function SegmentAndMousePosition() {
  // This component depends on the mouse position which is a fast-changing property.
  // For the sake of performance, it is isolated as a single component.
  const mousePosition = useWkSelector((state) => state.temporaryConfiguration.mousePosition);
  const additionalCoordinates = useWkSelector((state) => state.flycam.additionalCoordinates);
  const isPlaneMode = useWkSelector((state) => getIsPlaneMode(state));
  const globalMousePositionRounded = useWkSelector((state) => {
    const { activeViewport } = state.viewModeData.plane;

    if (mousePosition && activeViewport !== OrthoViews.TDView) {
      const [x, y] = mousePosition;
      return calculateGlobalPos(state, {
        x,
        y,
      }).rounded;
    }

    return undefined;
  });

  return (
    <>
      {isPlaneMode ? <SegmentInfo /> : null}
      {isPlaneMode ? (
        <span className="info-element">
          Pos [
          {globalMousePositionRounded
            ? getPosString(globalMousePositionRounded, additionalCoordinates)
            : "-,-,-"}
          ]
        </span>
      ) : null}
    </>
  );
}

function Statusbar() {
  return (
    <span className="statusbar">
      <ShortcutsInfo />
      <Infos />
    </span>
  );
}

export default Statusbar;
