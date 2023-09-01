import { connect, useDispatch } from "react-redux";
import _ from "lodash";
import React, { useEffect, useState } from "react";
import type { OxalisState, Flycam } from "oxalis/store";
import { AnnotationTool, AnnotationToolEnum, MeasurementTools, Vector3 } from "oxalis/constants";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { hideMeasurementTooltipAction } from "oxalis/model/actions/ui_actions";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { CopyOutlined } from "@ant-design/icons";
import { copyToClipboad } from "admin/voxelytics/utils";
import {
  formatNumberToLength,
  formatLengthAsVx,
  formatAreaAsVx,
  formatNumberToArea,
} from "libs/format_utils";
import { Tooltip } from "antd";

const TOOLTIP_HEIGHT = 48;
const ADDITIONAL_OFFSET = 12;

type Props = {
  position: [number, number] | null;
  flycam: Flycam;
  datasetScale: Vector3;
  activeTool: AnnotationTool;
};

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

function DistanceMeasurementTooltip(props: Props) {
  const { position, flycam, datasetScale, activeTool } = props;
  const dispatch = useDispatch();
  let valueInVx = "";
  let valueInMetricUnit = "";
  if (activeTool === AnnotationToolEnum.LINE_MEASUREMENT) {
    const { lineMeasurementGeometry } = getSceneController();
    valueInVx = formatAreaAsVx(lineMeasurementGeometry.getDistance([1, 1, 1]));
    valueInMetricUnit = formatNumberToArea(lineMeasurementGeometry.getDistance(datasetScale));
  } else if (activeTool === AnnotationToolEnum.AREA_MEASUREMENT) {
    const { areaMeasurementGeometry } = getSceneController();
    valueInVx = formatLengthAsVx(areaMeasurementGeometry.getArea([1, 1, 1]));
    valueInMetricUnit = formatNumberToLength(areaMeasurementGeometry.getArea(datasetScale));
  }
  const currentPosition = getPosition(flycam);
  const [lastFlycamPosition, setLastFlycamPosition] = useState<Vector3>(currentPosition);
  useEffect(() => {
    if (!_.isEqual(lastFlycamPosition, currentPosition)) {
      // If the position of the flycam has changed, we hide the tooltip and terminate the measurement.
      setLastFlycamPosition(currentPosition);
      dispatch(hideMeasurementTooltipAction());
      const { areaMeasurementGeometry, lineMeasurementGeometry } = getSceneController();
      lineMeasurementGeometry.hide();
      areaMeasurementGeometry.hide();
      lineMeasurementGeometry.reset();
      areaMeasurementGeometry.reset();
    }
  }, [currentPosition]);
  if (position == null || !MeasurementTools.includes(activeTool)) {
    return null;
  }
  return (
    <div
      className="node-context-menu"
      style={{
        position: "absolute",
        left: position[0] + ADDITIONAL_OFFSET,
        top: position[1] - TOOLTIP_HEIGHT - ADDITIONAL_OFFSET,
        width: "fit-content",
        pointerEvents: "all",
        borderRadius: 6,
        padding: "2px 4px",
        fontSize: 14,
      }}
    >
      <DistanceEntry distance={valueInMetricUnit} />
      <DistanceEntry distance={valueInVx} />
    </div>
  );
}

function mapStateToProps(state: OxalisState): Props {
  return {
    position: state.uiInformation.measurementTooltipPosition,
    flycam: state.flycam,
    activeTool: state.uiInformation.activeTool,
    datasetScale: state.dataset.dataSource.scale,
  };
}

const connector = connect(mapStateToProps);
export default connector(DistanceMeasurementTooltip);
