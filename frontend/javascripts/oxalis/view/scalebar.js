// @flow

import { connect } from "react-redux";
import * as React from "react";

import { Tooltip } from "antd";
import type { APIDataset } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { convertPixelsToNm } from "oxalis/view/right-menu/dataset_info_tab_view";
import { formatNumberToLength } from "libs/format_utils";
import { getViewportExtents, getTDViewZoom } from "oxalis/model/accessors/view_mode_accessor";
import { getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import constants, { Unicode, OUTER_CSS_BORDER, type OrthoView, OrthoViews } from "oxalis/constants";

const { ThinSpace, MultiplicationSymbol } = Unicode;

type OwnProps = {|
  viewportID: OrthoView,
|};

type StateProps = {|
  dataset: APIDataset,
  zoomValue: number,
  widthInPixels: number,
  heightInPixels: number,
|};

type Props = {|
  ...OwnProps,
  ...StateProps,
|};

const scalebarWidthPercentage = 0.25;

function Scalebar({ zoomValue, dataset, widthInPixels, heightInPixels }: Props) {
  const widthInNm = convertPixelsToNm(widthInPixels, zoomValue, dataset);
  const heightInNm = convertPixelsToNm(heightInPixels, zoomValue, dataset);
  const formattedScalebarWidth = formatNumberToLength(widthInNm * scalebarWidthPercentage);

  return (
    <Tooltip
      title={
        <div>
          <div>Viewport Size:</div>
          <div>
            {formatNumberToLength(widthInNm)}
            {ThinSpace}
            {MultiplicationSymbol}
            {ThinSpace}
            {formatNumberToLength(heightInNm)}{" "}
          </div>
        </div>
      }
    >
      <div
        style={{
          position: "absolute",
          bottom: "1%",
          right: "1%",
          // The scalebar should have a width of 25% from the actual viewport (without the borders)
          width: `calc(25% - ${Math.round(
            ((2 * OUTER_CSS_BORDER) / constants.VIEWPORT_WIDTH) * 100,
          )}%)`,
          height: 14,
          background: "rgba(0, 0, 0, .3)",
          color: "white",
          textAlign: "center",
          fontSize: 12,
          lineHeight: "14px",
          boxSizing: "content-box",
          padding: 4,
        }}
      >
        <div
          style={{
            borderBottom: "1px solid",
            borderLeft: "1px solid",
            borderRight: "1px solid",
          }}
        >
          {formattedScalebarWidth}
        </div>
      </div>
    </Tooltip>
  );
}

const mapStateToProps = (state: OxalisState, ownProps: OwnProps): StateProps => {
  const [width, height] = getViewportExtents(state)[ownProps.viewportID];
  const zoomValue =
    ownProps.viewportID === OrthoViews.TDView ? getTDViewZoom(state) : getZoomValue(state.flycam);
  return {
    zoomValue,
    dataset: state.dataset,
    widthInPixels: width,
    heightInPixels: height,
  };
};

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(Scalebar);
