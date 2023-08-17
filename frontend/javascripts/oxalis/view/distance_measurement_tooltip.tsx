import { connect } from "react-redux";
import React from "react";
import type { OxalisState, MeasurementTooltipInformation } from "oxalis/store";
import { notification } from "antd";

const TOOLTIP_HEIGHT = 26;
const ADDITIONAL_OFFSET = 6;

export function showMeasurementResults(distanceInScale: string, distanceInVx: string) {
  notification.info({
    message: `The measured length is ${distanceInScale} (${distanceInVx})`,
    key: "line-measurement-result",
    icon: <i className="fas fa-ruler" />,
  });
}

function DistanceMeasurementTooltip(props: MeasurementTooltipInformation) {
  const { position, value } = props;
  if (position == null) {
    return null;
  }
  return (
    <div
      id="distance-measurement-tooltip"
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
      {value}
    </div>
  );
}

function mapStateToProps(state: OxalisState): MeasurementTooltipInformation {
  return {
    position: state.uiInformation.measurementTooltipInformation.position,
    value: state.uiInformation.measurementTooltipInformation.value,
  };
}

const connector = connect(mapStateToProps);
export default connector(DistanceMeasurementTooltip);
