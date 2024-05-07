import { useDispatch, useSelector } from "react-redux";
import _ from "lodash";
import React, { useEffect, useRef } from "react";
import type { OxalisState } from "oxalis/store";
import { AnnotationToolEnum, LengthUnit, MeasurementTools } from "oxalis/constants";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { hideMeasurementTooltipAction } from "oxalis/model/actions/ui_actions";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { CopyOutlined } from "@ant-design/icons";
import { copyToClipboad } from "admin/voxelytics/utils";
import {
  formatNumberInUnitToLength,
  formatLengthAsVx,
  formatAreaAsVx,
  formatNumberInDatasourceUnitToArea,
} from "libs/format_utils";
import { Tooltip } from "antd";
import {
  calculateMaybePlaneScreenPos,
  getInputCatcherRect,
} from "oxalis/model/accessors/view_mode_accessor";
import { clamp } from "libs/utils";
import dimensions from "oxalis/model/dimensions";
import { DatasetScale } from "types/api_flow_types";

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
    (state: OxalisState) => state.uiInformation.measurementToolInfo.lastMeasuredPosition,
  );
  const isMeasuring = useSelector(
    (state: OxalisState) => state.uiInformation.measurementToolInfo.isMeasuring,
  );
  const flycam = useSelector((state: OxalisState) => state.flycam);
  const state = useSelector((state: OxalisState) => state);
  const activeTool = useSelector((state: OxalisState) => state.uiInformation.activeTool);
  const datasetScale = useSelector((state: OxalisState) => state.dataset.dataSource.scale);
  const tooltipRef = useRef<HTMLDivElement>(null);
  const dispatch = useDispatch();
  const currentPosition = getPosition(flycam);
  const { areaMeasurementGeometry, lineMeasurementGeometry } = getSceneController();
  const activeGeometry =
    activeTool === AnnotationToolEnum.LINE_MEASUREMENT
      ? lineMeasurementGeometry
      : areaMeasurementGeometry;
  const orthoView = activeGeometry.viewport;
  // When the flycam is moved into the third dimension, the tooltip should be hidden.
  const thirdDim = dimensions.thirdDimensionForPlane(orthoView);
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
  // This DatasetScale is needed for the measurements in voxel unit and does not result
  // in any scaling as it is the same as the default scale.
  const in3DSpaceScale = { factor: [1, 1, 1], unit: LengthUnit.nm } as DatasetScale;
  if (activeTool === AnnotationToolEnum.LINE_MEASUREMENT) {
    const { lineMeasurementGeometry } = getSceneController();
    valueInVx = formatLengthAsVx(lineMeasurementGeometry.getDistance(in3DSpaceScale), 1);
    valueInMetricUnit = formatNumberInUnitToLength(
      lineMeasurementGeometry.getDistance(datasetScale),
      datasetScale.unit,
      1,
    );
  } else if (activeTool === AnnotationToolEnum.AREA_MEASUREMENT) {
    const { areaMeasurementGeometry } = getSceneController();
    valueInVx = formatAreaAsVx(areaMeasurementGeometry.getArea(in3DSpaceScale), 1);
    valueInMetricUnit = formatNumberInDatasourceUnitToArea(
      areaMeasurementGeometry.getArea(datasetScale),
      datasetScale.unit,
      1,
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
