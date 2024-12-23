import { connect } from "react-redux";
import type { APIDataset } from "types/api_flow_types";
import type { OxalisState } from "oxalis/store";
import { formatNumberToLength } from "libs/format_utils";
import { getViewportExtents, getTDViewZoom } from "oxalis/model/accessors/view_mode_accessor";
import { getZoomValue } from "oxalis/model/accessors/flycam_accessor";
import type { OrthoView } from "oxalis/constants";
import constants, { Unicode, OrthoViews, LongUnitToShortUnitMap } from "oxalis/constants";
import { getBaseVoxelInUnit } from "oxalis/model/scaleinfo";
import FastTooltip from "components/fast_tooltip";

const { ThinSpace, MultiplicationSymbol } = Unicode;

type OwnProps = {
  viewportID: OrthoView;
};
type StateProps = {
  dataset: APIDataset;
  zoomValue: number;
  viewportWidthInPixels: number;
  viewportHeightInPixels: number;
};
type Props = OwnProps & StateProps;

function convertPixelsToUnit(
  lengthInPixel: number,
  zoomValue: number,
  dataset: APIDataset,
): number {
  return lengthInPixel * zoomValue * getBaseVoxelInUnit(dataset.dataSource.scale.factor);
}

const getBestScalebarAnchorInNm = (lengthInNm: number): number => {
  const closestExponent = Math.floor(Math.log10(lengthInNm));
  const closestPowerOfTen = 10 ** closestExponent;
  const mantissa = lengthInNm / closestPowerOfTen;
  let bestAnchor = 1;

  for (const anchor of [2, 5, 10]) {
    if (Math.abs(anchor - mantissa) < Math.abs(bestAnchor - mantissa)) {
      bestAnchor = anchor;
    }
  }

  return bestAnchor * closestPowerOfTen;
};

// This factor describes how wide the scalebar would ideally be.
// However, this is only a rough guideline, as the actual width is changed
// so that round length values are represented.
const idealScalebarWidthFactor = 0.3;
const maxScaleBarWidthFactor = 0.45;
const minWidthToFillScalebar = 130;

function Scalebar({ zoomValue, dataset, viewportWidthInPixels, viewportHeightInPixels }: Props) {
  const voxelSizeUnit = dataset.dataSource.scale.unit;
  const viewportWidthInUnit = convertPixelsToUnit(viewportWidthInPixels, zoomValue, dataset);
  const viewportHeightInUnit = convertPixelsToUnit(viewportHeightInPixels, zoomValue, dataset);
  const idealWidthInUnit = viewportWidthInUnit * idealScalebarWidthFactor;
  const scalebarWidthInUnit = getBestScalebarAnchorInNm(idealWidthInUnit);
  const scaleBarWidthFactor = Math.min(
    scalebarWidthInUnit / viewportWidthInUnit,
    maxScaleBarWidthFactor,
  );
  const tooltip = [
    formatNumberToLength(viewportWidthInUnit, LongUnitToShortUnitMap[voxelSizeUnit], 1, true),
    ThinSpace,
    MultiplicationSymbol,
    ThinSpace,
    formatNumberToLength(viewportHeightInUnit, LongUnitToShortUnitMap[voxelSizeUnit], 1, true),
  ].join("");
  const collapseScalebar = viewportWidthInPixels < minWidthToFillScalebar;
  const limitScalebar = scaleBarWidthFactor === maxScaleBarWidthFactor;
  const padding = 4;
  return (
    <div
      style={{
        position: "absolute",
        bottom: constants.SCALEBAR_OFFSET,
        right: constants.SCALEBAR_OFFSET,
        width: collapseScalebar ? 16 : `${scaleBarWidthFactor * 100}%`,
        height: constants.SCALEBAR_HEIGHT - padding * 2,
        background: "rgba(0, 0, 0, .3)",
        color: "white",
        textAlign: "center",
        fontSize: 12,
        lineHeight: "14px",
        boxSizing: "content-box",
        padding,
      }}
      className="scalebar"
    >
      <FastTooltip
        html={`
            <div>
              <div>Viewport Size:</div>
              <div>${tooltip}</div>
            </div>
          `}
      >
        <div
          style={{
            borderBottom: "1px solid",
            borderLeft: limitScalebar ? "none" : "1px solid",
            borderRight: "1px solid",
          }}
        >
          {collapseScalebar
            ? "i"
            : formatNumberToLength(
                scalebarWidthInUnit,
                LongUnitToShortUnitMap[voxelSizeUnit],
                1,
                true,
              )}
        </div>
      </FastTooltip>
    </div>
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

const connector = connect(mapStateToProps);
export default connector(Scalebar);
