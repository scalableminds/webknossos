// @flow

import * as React from "react";
import { connect } from "react-redux";
import { OUTER_BORDER_ORTHO } from "oxalis/constants";
import type { OxalisState, FlycamType } from "oxalis/store";
import { calculateZoomLevel, formatZoomLevel } from "oxalis/view/right-menu/dataset_info_tab_view";
import type { APIDatasetType } from "admin/api_flow_types";

type Props = {|
  dataset: APIDatasetType,
  flycam: FlycamType,
|};

const scalebarWidthPercentage = 0.25;

function Scalebar({ flycam, dataset }: Props) {
  return (
    <div
      style={{
        position: "absolute",
        bottom: 4,
        right: 4,
        width: `calc(${100 * scalebarWidthPercentage}% - ${2 * OUTER_BORDER_ORTHO}px)`,
        height: 25,
        background: "rgba(0, 0, 0, .3)",
        color: "white",
        textAlign: "center",
        fontSize: 12,
        lineHeight: "14px",
        boxSizing: "content-box",
        padding: 4,
      }}
    >
      <div>{formatZoomLevel(calculateZoomLevel(flycam, dataset) * scalebarWidthPercentage)}</div>
      <div style={{ width: "100%", height: 10, padding: 4, background: "white" }} />
    </div>
  );
}

const mapStateToProps = (state: OxalisState): Props => ({
  flycam: state.flycam,
  dataset: state.dataset,
});

export default connect(mapStateToProps)(Scalebar);
