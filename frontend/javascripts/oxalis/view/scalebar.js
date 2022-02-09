// @flow

import { connect } from "react-redux";
import * as React from "react";

import { Tooltip } from "antd";
import type { APIDataset } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { convertPixelsToNm } from "oxalis/view/right-border-tabs/dataset_info_tab_view";
import { formatNumberToLength } from "libs/format_utils";
import { getViewportExtents, getTDViewZoom } from "oxalis/model/accessors/view_mode_accessor";
import { getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import constants, { Unicode, OUTER_CSS_BORDER, type OrthoView, OrthoViews } from "oxalis/constants";

const { ThinSpace, MultiplicationSymbol } = Unicode;

type OwnProps = {|
  // eslint-disable-next-line react/no-unused-prop-types
  viewportID: OrthoView,
|};

type StateProps = {|
  dataset: APIDataset,
  zoomValue: number,
  viewportWidthInPixels: number,
  viewportHeightInPixels: number,
|};

type Props = {|
  ...OwnProps,
  ...StateProps,
|};

const getBestScalebarAnchorInNm = (lengthInNm: number): number => {
  const closestExponent = Math.floor(Math.log10(lengthInNm));
  const closestPowerOfTen = 10 ** closestExponent;
  const mantissa = lengthInNm / closestPowerOfTen;

  let bestAnchor = 1;
  for (const anchor of [2, 5, 10]) {
    if (Math.abs(anchor - mantissa) < Math.abs(bestAnchor - mantissa)) {
      bestAnchor = anchor;
    } else {
      break;
    }
  }
  return bestAnchor * closestPowerOfTen;
};

const scalebarWidthFactor = 0.3;
const minWidthToFillScalebar = 130;

function Scalebar({ zoomValue, dataset, viewportWidthInPixels, viewportHeightInPixels }: Props) {
  const viewportWidthInNm = convertPixelsToNm(viewportWidthInPixels, zoomValue, dataset);
  const viewportHeightInNm = convertPixelsToNm(viewportHeightInPixels, zoomValue, dataset);
  const scaledWidthInNm = viewportWidthInNm * scalebarWidthFactor;
  const scalebarWidthInNm = getBestScalebarAnchorInNm(scaledWidthInNm);
  const scaleBarWidthPercentage = (scalebarWidthInNm / viewportWidthInNm) * 100;

  const tooltip = [
    formatNumberToLength(viewportWidthInNm),
    ThinSpace,
    MultiplicationSymbol,
    ThinSpace,
    formatNumberToLength(viewportHeightInNm),
    " ",
  ].join("");
  const collapseScalebar = viewportWidthInPixels < minWidthToFillScalebar;

  return (
    <Tooltip
      title={
        <div>
          <div>Viewport Size:</div>
          <div>{tooltip}</div>
        </div>
      }
    >
      <div
        style={{
          position: "absolute",
          bottom: "1%",
          right: "1%",
          width: collapseScalebar
            ? 16
            : `calc(${scaleBarWidthPercentage}% - ${Math.round(
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
          {collapseScalebar ? "i" : formatNumberToLength(scalebarWidthInNm)}
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
    viewportWidthInPixels: width,
    viewportHeightInPixels: height,
  };
};

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(Scalebar);
