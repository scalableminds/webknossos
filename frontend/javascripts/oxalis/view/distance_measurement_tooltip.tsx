import { connect, useDispatch } from "react-redux";
import _ from "lodash";
import React, { useEffect, useState } from "react";
import type { OxalisState, MeasurementTooltipInformation, Flycam } from "oxalis/store";
import { MEASUREMENT_UNITS, Vector3 } from "oxalis/constants";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import { hideMeasurementTooltipAction } from "oxalis/model/actions/ui_actions";
import getSceneController from "oxalis/controller/scene_controller_provider";
import { CopyOutlined } from "@ant-design/icons";
import { copyToClipboad } from "admin/voxelytics/utils";
import { formatNumberToLength, formatLengthAsVx } from "libs/format_utils";

const TOOLTIP_HEIGHT = 26;
const ADDITIONAL_OFFSET = 6;

type Props = MeasurementTooltipInformation & { flycam: Flycam; datasetScale: Vector3 };

function DistanceMeasurementTooltip(props: Props) {
  const { position, measurementUnit, flycam, datasetScale } = props;
  const { lineMeasurementGeometry } = getSceneController();
  const dispatch = useDispatch();
  const distance =
    measurementUnit === MEASUREMENT_UNITS.NM
      ? formatNumberToLength(lineMeasurementGeometry.getDistance(datasetScale))
      : formatLengthAsVx(lineMeasurementGeometry.getDistance([1, 1, 1]));
  const currentPosition = getPosition(flycam);
  const [lastFlycamPosition, setLastFlycamPosition] = useState<Vector3>(currentPosition);
  useEffect(() => {
    if (!_.isEqual(lastFlycamPosition, getPosition(flycam))) {
      setLastFlycamPosition(currentPosition);
      dispatch(hideMeasurementTooltipAction());
      getSceneController().lineMeasurementGeometry.hide();
    }
  }, [currentPosition]);
  if (position == null) {
    return null;
  }
  return (
    <div
      className="node-context-menu"
      style={{
        position: "absolute",
        left: position[0],
        top: position[1] - TOOLTIP_HEIGHT - ADDITIONAL_OFFSET,
        width: "fit-content",
        pointerEvents: "all",
        borderRadius: 6,
        padding: "2px 4px",
        fontSize: 14,
      }}
    >
      {distance}{" "}
      <CopyOutlined
        onClick={() => {
          copyToClipboad(distance);
        }}
      />
    </div>
  );
}

function mapStateToProps(state: OxalisState): Props {
  return {
    position: state.uiInformation.measurementTooltipInformation.position,
    flycam: state.flycam,
    measurementUnit: state.uiInformation.measurementTooltipInformation.measurementUnit,
    datasetScale: state.dataset.dataSource.scale,
  };
}

const connector = connect(mapStateToProps);
export default connector(DistanceMeasurementTooltip);
