import { CopyOutlined } from "@ant-design/icons";
import { Tooltip } from "antd";
import { copyToClipboard } from "libs/clipboard";
import {
  formatAreaAsVx,
  formatLengthAsVx,
  formatNumberToArea,
  formatNumberToLength,
} from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { useEffect, useRef } from "react";
import { shallowEqual, useDispatch } from "react-redux";
import type { VoxelSize } from "types/api_types";
import { LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getPosition, getRotationInRadian } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  calculateMaybePlaneScreenPos,
  getInputCatcherRect,
} from "viewer/model/accessors/view_mode_accessor";
import { hideMeasurementTooltipAction } from "viewer/model/actions/ui_actions";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";
import { getTooltipPosition, isPositionStillInPlane } from "./viewport_tooltip_helpers";

function DistanceEntry({ distance }: { distance: string }) {
  return (
    <div>
      {distance}{" "}
      <Tooltip title="Copy to clipboard">
        <CopyOutlined
          onClick={() => {
            copyToClipboard(distance);
          }}
        />
      </Tooltip>
    </div>
  );
}

const NOT_SCALING_FACTOR: Vector3 = [1, 1, 1];

function getFormattedMeasurement(activeTool: AnnotationTool, voxelSize: VoxelSize) {
  const { lineMeasurementGeometry, areaMeasurementGeometry } = getSceneController();
  const unit = LongUnitToShortUnitMap[voxelSize.unit];
  if (activeTool === AnnotationTool.LINE_MEASUREMENT) {
    return {
      valueInVx: formatLengthAsVx(lineMeasurementGeometry.getDistance(NOT_SCALING_FACTOR), 1),
      valueInMetricUnit: formatNumberToLength(
        lineMeasurementGeometry.getDistance(voxelSize.factor),
        unit,
      ),
    };
  }
  if (activeTool === AnnotationTool.AREA_MEASUREMENT) {
    return {
      valueInVx: formatAreaAsVx(areaMeasurementGeometry.getArea(NOT_SCALING_FACTOR), 1),
      valueInMetricUnit: formatNumberToArea(
        areaMeasurementGeometry.getArea(voxelSize.factor),
        unit,
      ),
    };
  }
  return { valueInVx: "", valueInMetricUnit: "" };
}

export default function DistanceMeasurementTooltip() {
  const lastMeasuredGlobalPosition = useWkSelector(
    (state) => state.uiInformation.measurementToolInfo.lastMeasuredPosition,
  );
  const isMeasuring = useWkSelector((state) => state.uiInformation.measurementToolInfo.isMeasuring);
  const flycamPosition = useWkSelector((state) => getPosition(state.flycam));
  const flycamRotation = useWkSelector((state) => getRotationInRadian(state.flycam));
  const zoomStep = useWkSelector((state) => state.flycam.zoomStep);
  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const planeRatio = useWkSelector((state) =>
    getBaseVoxelFactorsInUnit(state.dataset.dataSource.scale),
  );
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();
  const { areaMeasurementGeometry, lineMeasurementGeometry } = getSceneController();
  const activeGeometry =
    activeTool === AnnotationTool.LINE_MEASUREMENT
      ? lineMeasurementGeometry
      : areaMeasurementGeometry;
  const orthoView = activeGeometry.viewport;
  const tooltipPosition = useWkSelector((state) =>
    lastMeasuredGlobalPosition
      ? calculateMaybePlaneScreenPos(state, lastMeasuredGlobalPosition, orthoView)
      : null,
  );
  // When the flycam is moved into the third dimension, the tooltip should be hidden.
  const viewportRect = useWkSelector((state) => getInputCatcherRect(state, orthoView));

  // biome-ignore lint/correctness/useExhaustiveDependencies(dispatch): constant
  useEffect(() => {
    if (
      lastMeasuredGlobalPosition &&
      !isPositionStillInPlane(
        lastMeasuredGlobalPosition,
        flycamRotation,
        flycamPosition,
        orthoView,
        planeRatio,
        zoomStep,
      )
    ) {
      dispatch(hideMeasurementTooltipAction());
      activeGeometry.resetAndHide();
    }
  }, [
    lastMeasuredGlobalPosition,
    flycamRotation,
    flycamPosition,
    orthoView,
    planeRatio,
    zoomStep,
    activeGeometry.resetAndHide,
  ]);

  // The measurement geometries are not part of the store, but every change to them
  // is followed by a dispatch of setLastMeasuredPositionAction. Reading them in a
  // selector re-renders this component whenever the formatted values change.
  const { valueInVx, valueInMetricUnit } = useWkSelector(
    (state) => getFormattedMeasurement(activeTool, state.dataset.dataSource.scale),
    shallowEqual,
  );

  if (lastMeasuredGlobalPosition == null || tooltipPosition == null) {
    return null;
  }

  const { left, top } = getTooltipPosition(isMeasuring, tooltipRef, viewportRect, tooltipPosition);

  return (
    <div
      ref={tooltipRef}
      className="node-context-menu cursor-tooltip"
      style={{
        left,
        top,
        pointerEvents: isMeasuring ? "none" : "auto",
      }}
    >
      <DistanceEntry distance={valueInVx} />
      <DistanceEntry distance={valueInMetricUnit} />
    </div>
  );
}
