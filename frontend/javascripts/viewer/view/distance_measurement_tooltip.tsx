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
import { useEffect, useRef } from "react";
import { useDispatch } from "react-redux";
import { LongUnitToShortUnitMap, type Vector3 } from "viewer/constants";
import getSceneController from "viewer/controller/scene_controller_provider";
import { getTransformedVoxelSize } from "viewer/model/accessors/dataset_layer_transformation_accessor";
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
            copyToClipboad(distance);
          }}
        />
      </Tooltip>
    </div>
  );
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
  const transformedVoxelSize = useWkSelector((state) => {
    return getTransformedVoxelSize(
      state.dataset,
      state.datasetConfiguration.nativelyRenderedLayerName,
    );
  });
  const untransformedVoxelSize = useWkSelector((state) => state.dataset.dataSource.scale);
  const planeRatio = getBaseVoxelFactorsInUnit(transformedVoxelSize);
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
      lineMeasurementGeometry.getDistance(untransformedVoxelSize.factor),
      LongUnitToShortUnitMap[untransformedVoxelSize.unit],
    );
  } else if (activeTool === AnnotationTool.AREA_MEASUREMENT) {
    const { areaMeasurementGeometry } = getSceneController();
    valueInVx = formatAreaAsVx(areaMeasurementGeometry.getArea(notScalingFactor), 1);
    valueInMetricUnit = formatNumberToArea(
      areaMeasurementGeometry.getArea(untransformedVoxelSize.factor),
      LongUnitToShortUnitMap[untransformedVoxelSize.unit],
    );
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
      <DistanceEntry distance={valueInMetricUnit} />
      <DistanceEntry distance={valueInVx} />
    </div>
  );
}
