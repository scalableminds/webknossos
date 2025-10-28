import { CopyOutlined } from "@ant-design/icons";
import { copyToClipboad } from "admin/voxelytics/utils";
import { Tooltip } from "antd";
import {
  formatAreaAsVx,
  formatLengthAsVx,
  formatNumberToArea,
  formatNumberToLength,
} from "libs/format_utils";
import { useWkSelector } from "libs/react_hooks";
import { clamp } from "libs/utils";
import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { LongUnitToShortUnitMap, type OrthoView, type Vector3 } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getPosition, getRotationInRadian } from "viewer/model/accessors/flycam_accessor";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import {
  calculateInViewportPos,
  calculateMaybePlaneScreenPos,
  getInputCatcherRect,
} from "viewer/model/accessors/view_mode_accessor";
import { hideMeasurementTooltipAction } from "viewer/model/actions/ui_actions";
import Dimensions from "viewer/model/dimensions";
import { getBaseVoxelFactorsInUnit } from "viewer/model/scaleinfo";

function DistanceEntry({ distance }: { distance: string }) {
  return (
    <div>
      {distance}{" "}
      <Tooltip title="Copy to clipboard">
        <CopyOutlined
          onClick={() => {
            copyToClipboad(distance);
          }}
        />
      </Tooltip>
    </div>
  );
}

function isPositionStillInPlane(
  positionXYZ: Vector3,
  flycamRotation: Vector3,
  flycamPosition: Vector3,
  planeId: OrthoView,
  baseVoxelFactors: Vector3,
  zoomStep: number,
) {
  const posInViewport = calculateInViewportPos(
    positionXYZ,
    flycamPosition,
    flycamRotation,
    baseVoxelFactors,
    zoomStep,
  ).toArray();
  const thirdDim = Dimensions.thirdDimensionForPlane(planeId);
  return Math.abs(posInViewport[thirdDim]) < 1;
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
  const voxelSize = useWkSelector((state) => state.dataset.dataSource.scale);
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
  const {
    left: viewportLeft,
    top: viewportTop,
    width: viewportWidth,
    height: viewportHeight,
  } = useWkSelector((state) => getInputCatcherRect(state, orthoView));

  // biome-ignore lint/correctness/useExhaustiveDependencies(hideMeasurementTooltipAction): constant
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

  if (lastMeasuredGlobalPosition == null || tooltipPosition == null) {
    return null;
  }

  let valueInVx = "";
  let valueInMetricUnit = "";
  const notScalingFactor = [1, 1, 1] as Vector3;

  if (activeTool === AnnotationTool.LINE_MEASUREMENT) {
    const { lineMeasurementGeometry } = getSceneController();
    valueInVx = formatLengthAsVx(lineMeasurementGeometry.getDistance(notScalingFactor), 1);
    valueInMetricUnit = formatNumberToLength(
      lineMeasurementGeometry.getDistance(voxelSize.factor),
      LongUnitToShortUnitMap[voxelSize.unit],
    );
  } else if (activeTool === AnnotationTool.AREA_MEASUREMENT) {
    const { areaMeasurementGeometry } = getSceneController();
    valueInVx = formatAreaAsVx(areaMeasurementGeometry.getArea(notScalingFactor), 1);
    valueInMetricUnit = formatNumberToArea(
      areaMeasurementGeometry.getArea(voxelSize.factor),
      LongUnitToShortUnitMap[voxelSize.unit],
    );
  }

  // If the tooltip is pinned, there should be no offset
  const OFFSET = isMeasuring ? 8 : 0;

  const tooltipWidth = tooltipRef.current?.offsetWidth ?? 0;
  const left = clamp(
    viewportLeft - tooltipWidth + OFFSET, // min
    tooltipPosition[0] - tooltipWidth - OFFSET, // desired position (left of cursor, small offset)
    viewportLeft + viewportWidth - tooltipWidth - OFFSET, // max (stay in viewport)
  );
  const top = clamp(
    viewportTop, // min
    tooltipPosition[1] + OFFSET, // just below cursor
    viewportTop + viewportHeight - OFFSET, // max
  );

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
      <DistanceEntry distance={valueInMetricUnit} />
      <DistanceEntry distance={valueInVx} />
    </div>
  );
}
