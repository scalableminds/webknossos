import { CopyOutlined } from "@ant-design/icons";
import { copyToClipboad } from "admin/voxelytics/utils";
import { Tooltip } from "antd";
import {
  formatAreaAsVx,
  formatLengthAsVx,
  formatNumberToArea,
  formatNumberToLength,
} from "libs/format_utils";
import { clamp } from "libs/utils";
import { LongUnitToShortUnitMap, type Vector3 } from "oxalis/constants";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { AnnotationTool, MeasurementTools } from "oxalis/model/accessors/tool_accessor";
import {
  calculateMaybePlaneScreenPos,
  getInputCatcherRect,
} from "oxalis/model/accessors/view_mode_accessor";
import { hideMeasurementTooltipAction } from "oxalis/model/actions/ui_actions";
import dimensions from "oxalis/model/dimensions";
import { type WebknossosState, useWkSelector } from "oxalis/store";
import { useEffect, useRef } from "react";
import { useDispatch, useSelector } from "react-redux";

const TOOLTIP_HEIGHT = 48;
const ADDITIONAL_OFFSET = 12;

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
  const position = useSelector(
    (state: WebknossosState) => state.uiInformation.measurementToolInfo.lastMeasuredPosition,
  );
  const isMeasuring = useSelector(
    (state: WebknossosState) => state.uiInformation.measurementToolInfo.isMeasuring,
  );
  const flycam = useWkSelector((state) => state.flycam);
  const state = useWkSelector((state) => state);
  const activeTool = useWkSelector((state) => state.uiInformation.activeTool);
  const voxelSize = useWkSelector((state) => state.dataset.dataSource.scale);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();
  const currentPosition = getPosition(flycam);
  const { areaMeasurementGeometry, lineMeasurementGeometry } = getSceneController();
  const activeGeometry =
    activeTool === AnnotationTool.LINE_MEASUREMENT
      ? lineMeasurementGeometry
      : areaMeasurementGeometry;
  const orthoView = activeGeometry.viewport;
  // When the flycam is moved into the third dimension, the tooltip should be hidden.
  const thirdDim = dimensions.thirdDimensionForPlane(orthoView);

  // biome-ignore lint/correctness/useExhaustiveDependencies(thirdDim): thirdDim is more or less a constant
  // biome-ignore lint/correctness/useExhaustiveDependencies(position[thirdDim]):
  // biome-ignore lint/correctness/useExhaustiveDependencies(hideMeasurementTooltipAction): constant
  // biome-ignore lint/correctness/useExhaustiveDependencies(dispatch): constant
  // biome-ignore lint/correctness/useExhaustiveDependencies(position):
  // biome-ignore lint/correctness/useExhaustiveDependencies(activeGeometry.resetAndHide):
  useEffect(() => {
    if (
      position != null &&
      Math.floor(currentPosition[thirdDim]) !== Math.floor(position[thirdDim])
    ) {
      dispatch(hideMeasurementTooltipAction());
      activeGeometry.resetAndHide();
    }
  }, [currentPosition[thirdDim]]);

  if (position == null || !MeasurementTools.includes(activeTool)) {
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

  const {
    left: viewportLeft,
    top: viewportTop,
    width: viewportWidth,
    height: viewportHeight,
  } = getInputCatcherRect(state, orthoView);
  const tooltipPosition = calculateMaybePlaneScreenPos(state, position, orthoView);

  if (tooltipPosition == null) {
    return null;
  }

  const tooltipWidth = tooltipRef.current?.offsetWidth ?? 0;
  const left = clamp(
    viewportLeft + ADDITIONAL_OFFSET - tooltipWidth,
    tooltipPosition.x + ADDITIONAL_OFFSET,
    viewportLeft + viewportWidth - ADDITIONAL_OFFSET,
  );
  const top = clamp(
    viewportTop + ADDITIONAL_OFFSET,
    tooltipPosition.y - TOOLTIP_HEIGHT - ADDITIONAL_OFFSET,
    viewportTop + viewportHeight + TOOLTIP_HEIGHT - ADDITIONAL_OFFSET,
  );

  return (
    <div
      ref={tooltipRef}
      className="node-context-menu measurement-tooltip"
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
