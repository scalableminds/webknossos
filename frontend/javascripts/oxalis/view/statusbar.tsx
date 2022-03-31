import { Tooltip } from "antd";
import { useDispatch, useSelector } from "react-redux";
import React from "react";
import { WarningOutlined, MoreOutlined } from "@ant-design/icons";
import type { Vector3 } from "oxalis/constants";
import { OrthoViews } from "oxalis/constants";
import { getVisibleSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import { NumberInputPopoverSetting } from "oxalis/view/components/setting_input_views";
import { useKeyPress } from "libs/react_hooks";
import { getCurrentResolution } from "oxalis/model/accessors/flycam_accessor";
import { setActiveCellAction } from "oxalis/model/actions/volumetracing_actions";
import {
  setActiveNodeAction,
  setActiveTreeAction,
} from "oxalis/model/actions/skeletontracing_actions";
import message from "messages";
import { getToolClassForAnnotationTool } from "oxalis/controller/combinations/tool_controls";
import {
  calculateGlobalPos,
  isPlaneMode as getIsPlaneMode,
} from "oxalis/model/accessors/view_mode_accessor";
import { adaptActiveToolToShortcuts } from "oxalis/model/accessors/tool_accessor";
import { V3 } from "libs/mjs";
import Model from "oxalis/model";
const lineColor = "rgba(255, 255, 255, 0.67)";
const moreIconStyle = {
  height: 14,
  color: lineColor,
};
const moreLinkStyle = {
  marginLeft: 10,
  marginRight: "auto",
};

function getPosString(pos: Vector3) {
  return V3.floor(pos).join(",");
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
          Alt
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

// @ts-expect-error ts-migrate(7031) FIXME: Binding element 'actionInfos' implicitly has an 'a... Remove this comment to see the full error message
function LeftClickShortcut({ actionInfos }) {
  const leftClick =
    actionInfos.leftClick != null ? (
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-left.svg"
          alt="Mouse Left Click"
        />
        {actionInfos.leftClick}
      </span>
    ) : null;
  const leftDrag =
    actionInfos.leftDrag != null ? (
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-left-drag.svg"
          alt="Mouse Left Drag"
        />
        {actionInfos.leftDrag}
      </span>
    ) : null;
  return (
    <span>
      {leftClick}
      {leftDrag}
    </span>
  );
}

// @ts-expect-error ts-migrate(7031) FIXME: Binding element 'actionInfos' implicitly has an 'a... Remove this comment to see the full error message
function RightClickShortcut({ actionInfos }) {
  const rightClick =
    actionInfos.rightClick != null ? (
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-right.svg"
          alt="Mouse Right Click"
        />
        {actionInfos.rightClick}
      </span>
    ) : null;
  const rightDrag =
    actionInfos.rightDrag != null ? (
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-right-drag.svg"
          alt="Mouse Right Drag"
        />
        {actionInfos.rightDrag}
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
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'uiInformation' does not exist on type 'D... Remove this comment to see the full error message
  const activeTool = useSelector((state) => state.uiInformation.activeTool);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'userConfiguration' does not exist on typ... Remove this comment to see the full error message
  const useLegacyBindings = useSelector((state) => state.userConfiguration.useLegacyBindings);
  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'DefaultRootState' is not assigna... Remove this comment to see the full error message
  const isPlaneMode = useSelector((state) => getIsPlaneMode(state));
  const isShiftPressed = useKeyPress("Shift");
  const isControlPressed = useKeyPress("Control");
  const isAltPressed = useKeyPress("Alt");
  const adaptedTool = adaptActiveToolToShortcuts(
    activeTool,
    isShiftPressed,
    isControlPressed,
    isAltPressed,
  );
  const actionInfos = getToolClassForAnnotationTool(adaptedTool).getActionDescriptors(
    adaptedTool,
    useLegacyBindings,
    isShiftPressed,
    isControlPressed,
    isAltPressed,
  );
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
    return (
      <React.Fragment>
        <span
          style={{
            marginRight: "auto",
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
              Space
            </span>
          </span>{" "}
          Trace forward
        </span>
        {moreShortcutsLink}
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <LeftClickShortcut actionInfos={actionInfos} />
      <RightClickShortcut actionInfos={actionInfos} />
      <span className="shortcut-info-element">
        <img
          className="keyboard-mouse-icon"
          src="/assets/images/icon-statusbar-mouse-wheel.svg"
          alt="Mouse Wheel"
        />
        {isAltPressed || isControlPressed ? "Zoom in/out" : "Move along 3rd axis"}
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
  const getSegmentIdString = () => {
    const hoveredCellInfo = Model.getHoveredCellId(globalMousePosition);

    if (!hoveredCellInfo) {
      return "-";
    }

    return hoveredCellInfo.isMapped ? `${hoveredCellInfo.id} (mapped)` : hoveredCellInfo.id;
  };

  return <span className="info-element">Segment {getSegmentIdString()}</span>;
}

function maybeLabelWithSegmentationWarning(hasUint64Segmentation: boolean, label: string) {
  return hasUint64Segmentation ? (
    <React.Fragment>
      {label}{" "}
      <Tooltip title={message["tracing.uint64_segmentation_warning"]}>
        <WarningOutlined
          style={{
            color: "var(--ant-warning)",
          }}
        />
      </Tooltip>
    </React.Fragment>
  ) : (
    label
  );
}

function Infos() {
  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'DefaultRootState' is not assigna... Remove this comment to see the full error message
  const activeResolution = useSelector((state) => getCurrentResolution(state));
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'temporaryConfiguration' does not exist o... Remove this comment to see the full error message
  const mousePosition = useSelector((state) => state.temporaryConfiguration.mousePosition);
  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'DefaultRootState' is not assigna... Remove this comment to see the full error message
  const isPlaneMode = useSelector((state) => getIsPlaneMode(state));
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'tracing' does not exist on type 'Default... Remove this comment to see the full error message
  const isSkeletonAnnotation = useSelector((state) => state.tracing.skeleton != null);
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'tracing' does not exist on type 'Default... Remove this comment to see the full error message
  const isVolumeAnnotation = useSelector((state) => state.tracing.volume != null);
  const activeCellId = useSelector((state) =>
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'tracing' does not exist on type 'Default... Remove this comment to see the full error message
    state.tracing.volume ? state.tracing.volume.activeCellId : null,
  );
  const activeNodeId = useSelector((state) =>
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'tracing' does not exist on type 'Default... Remove this comment to see the full error message
    state.tracing.skeleton ? state.tracing.skeleton.activeNodeId : null,
  );
  const activeTreeId = useSelector((state) =>
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'tracing' does not exist on type 'Default... Remove this comment to see the full error message
    state.tracing.skeleton ? state.tracing.skeleton.activeTreeId : null,
  );
  const dispatch = useDispatch();

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'id' implicitly has an 'any' type.
  const onChangeActiveCellId = (id) => dispatch(setActiveCellAction(id));

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'id' implicitly has an 'any' type.
  const onChangeActiveNodeId = (id) => dispatch(setActiveNodeAction(id));

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'id' implicitly has an 'any' type.
  const onChangeActiveTreeId = (id) => dispatch(setActiveTreeAction(id));

  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'DefaultRootState' is not assigna... Remove this comment to see the full error message
  const hasVisibleSegmentation = useSelector((state) => getVisibleSegmentationLayer(state) != null);
  const hasUint64Segmentation = useSelector((state) => {
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'DefaultRootState' is not assigna... Remove this comment to see the full error message
    const segmentationLayer = getVisibleSegmentationLayer(state);
    return segmentationLayer ? segmentationLayer.originalElementClass === "uint64" : false;
  });
  const globalMousePosition = useSelector((state) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'viewModeData' does not exist on type 'De... Remove this comment to see the full error message
    const { activeViewport } = state.viewModeData.plane;

    if (mousePosition && activeViewport !== OrthoViews.TDView) {
      const [x, y] = mousePosition;
      // @ts-expect-error ts-migrate(2554) FIXME: Expected 3 arguments, but got 2.
      return calculateGlobalPos(state, {
        x,
        y,
      });
    }

    return undefined;
  });
  return (
    <React.Fragment>
      <span className="info-element">
        <img
          src="/assets/images/icon-statusbar-downsampling.svg"
          className="resolution-status-bar-icon"
          alt="Resolution"
        />{" "}
        {activeResolution.join("-")}{" "}
      </span>
      {isPlaneMode ? (
        <span className="info-element">
          Pos [{globalMousePosition ? getPosString(globalMousePosition) : "-,-,-"}]
        </span>
      ) : null}
      {isPlaneMode && hasVisibleSegmentation ? getCellInfo(globalMousePosition) : null}

      {isVolumeAnnotation ? (
        <span className="info-element">
          <NumberInputPopoverSetting
            value={activeCellId}
            label={maybeLabelWithSegmentationWarning(hasUint64Segmentation, "Active Segment")}
            detailedLabel={maybeLabelWithSegmentationWarning(
              hasUint64Segmentation,
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
    </React.Fragment>
  );
}

class Statusbar extends React.PureComponent<{}, {}> {
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
