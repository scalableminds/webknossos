/**
 * mapping_info_view.js
 * @flow
 */
import type { Dispatch } from "redux";
import { Icon, Select, Switch, Table, Tooltip } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import debounceRender from "react-debounce-render";

import createProgressCallback from "libs/progress_callback";
import type { APIDataset, APISegmentationLayer } from "admin/api_flow_types";
import { type OrthoView, OrthoViews, type Vector2, type Vector3 } from "oxalis/constants";
import type { OxalisState, Mapping, MappingType } from "oxalis/store";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getMappingsForDatasetLayer, getAgglomeratesForDatasetLayer } from "admin/admin_rest_api";
import { getPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getSegmentationLayer, getResolutions } from "oxalis/model/accessors/dataset_accessor";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setLayerMappingsAction } from "oxalis/model/actions/dataset_actions";
import {
  setMappingEnabledAction,
  setHideUnmappedIdsAction,
} from "oxalis/model/actions/settings_actions";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import Model from "oxalis/model";
import message from "messages";
import * as Utils from "libs/utils";

const { Option, OptGroup } = Select;

type OwnProps = {|
  portalKey: string,
|};
type StateProps = {|
  dataset: APIDataset,
  segmentationLayer: ?APISegmentationLayer,
  position: Vector3,
  zoomStep: number,
  mousePosition: ?Vector2,
  isMappingEnabled: boolean,
  mapping: ?Mapping,
  mappingName: ?string,
  hideUnmappedIds: ?boolean,
  mappingType: MappingType,
  mappingColors: ?Array<number>,
  setMappingEnabled: boolean => void,
  setHideUnmappedIds: boolean => void,
  setAvailableMappingsForLayer: (string, Array<string>, Array<string>) => void,
  activeViewport: OrthoView,
  activeCellId: number,
  isMergerModeEnabled: boolean,
  renderMissingDataBlack: boolean,
|};
type Props = {| ...OwnProps, ...StateProps |};

type State = {
  // shouldMappingBeEnabled is the UI state which is directly connected to the
  // toggle button. The actual mapping in the store is only activated when
  // the user selects a mapping from the dropdown (which is only possible after
  // using the toggle). This is why, there is this.state.shouldMappingBeEnabled and
  // this.props.isMappingEnabled
  shouldMappingBeEnabled: boolean,
  isRefreshingMappingList: boolean,
  didRefreshMappingList: boolean,
};

// See the shader-side implementation of getElementOfPermutation in segmentation.glsl.js
// for a detailed description.
function getElementOfPermutation(
  index: number,
  sequenceLength: number,
  primitiveRoot: number,
): number {
  const oneBasedIndex = (index % sequenceLength) + 1.0;
  const isFirstElement = oneBasedIndex === 1.0;

  // The GLSL implementation of pow is 2**(y * log2(x)) in which
  // intermediate results can suffer from precision loss. The following
  // code mimics this behavior to get a consistent coloring in GLSL and
  // JS.
  const imprecise = x => new Float32Array([x])[0];
  function glslPow(x, y) {
    return Math.floor(imprecise(2 ** (y * imprecise(Math.log2(x)))));
  }
  const sequenceValue = glslPow(primitiveRoot, oneBasedIndex) % sequenceLength;

  // Only use sequenceLength if the requested element is the first of the sequence
  // Otherwise, return the actual sequenceValue
  return isFirstElement ? sequenceLength : sequenceValue;
}

// Input in [0,1]
// Output in [0,1] for r, g and b
function colormapJet(x: number): [number, number, number] {
  const r = _.clamp(x < 0.89 ? (x - 0.35) / 0.31 : 1.0 - ((x - 0.89) / 0.11) * 0.5, 0, 1);
  const g = _.clamp(x < 0.64 ? (x - 0.125) * 4.0 : 1.0 - (x - 0.64) / 0.27, 0, 1);
  const b = _.clamp(x < 0.34 ? 0.5 + (x * 0.5) / 0.11 : 1.0 - (x - 0.34) / 0.31, 0, 1);

  return [r, g, b];
}

// From: https://stackoverflow.com/a/54070620/896760
// Input: r,g,b in [0,1], out: h in [0,360) and s,v in [0,1]
function rgb2hsv(rgb: [number, number, number]): [number, number, number] {
  const [r, g, b] = rgb;
  const v = Math.max(r, g, b);
  const n = v - Math.min(r, g, b);

  // eslint-disable-next-line no-nested-ternary
  const h = n !== 0 && (v === r ? (g - b) / n : v === g ? 2 + (b - r) / n : 4 + (r - g) / n);
  // $FlowIgnore
  return [60 * (h < 0 ? h + 6 : h), v && n / v, v];
}

// This function mirrors convertCellIdToRGB in the fragment shader of the rendering plane.
// Output is in [0,1] for H, S, L and A
export const convertCellIdToHSLA = (id: number, customColors: ?Array<number>): Array<number> => {
  if (id === 0) {
    // Return white
    return [1, 1, 1, 1];
  }

  let hue;

  if (customColors != null) {
    const last8Bits = id % 2 ** 8;
    hue = customColors[last8Bits] || 0;
  } else {
    const significantSegmentIndex = id % 2 ** 16;

    const colorCount = 19;
    const colorIndex = getElementOfPermutation(significantSegmentIndex, colorCount, 2);
    const colorValueDecimal = (1.0 / colorCount) * colorIndex;

    hue = (1 / 360) * rgb2hsv(colormapJet(colorValueDecimal))[0];
  }

  return [hue, 1, 0.5, 0.15];
};

const convertHSLAToCSSString = ([h, s, l, a]) => `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
const convertCellIdToCSS = (id, customColors) =>
  convertHSLAToCSSString(convertCellIdToHSLA(id, customColors));

const hasSegmentation = () => Model.getSegmentationLayer() != null;

const needle = "##";
const packMappingNameAndCategory = (mappingName, category) => `${category}${needle}${mappingName}`;
const unpackMappingNameAndCategory = packedString => {
  const needlePos = packedString.indexOf(needle);
  const categoryName = packedString.slice(0, needlePos);
  const mappingName = packedString.slice(needlePos + needle.length);
  return [mappingName, categoryName];
};

class MappingInfoView extends React.Component<Props, State> {
  isMounted: boolean = false;

  state = {
    shouldMappingBeEnabled: false,
    isRefreshingMappingList: false,
    didRefreshMappingList: false,
  };

  componentDidMount() {
    this.isMounted = true;
    if (!hasSegmentation()) {
      return;
    }
    const cube = this.getSegmentationCube();
    cube.on("bucketLoaded", this._forceUpdate);
    cube.on("volumeLabeled", this._forceUpdate);
  }

  componentWillUnmount() {
    this.isMounted = false;
    if (!hasSegmentation()) {
      return;
    }
    const cube = this.getSegmentationCube();
    cube.off("bucketLoaded", this._forceUpdate);
    cube.off("volumeLabeled", this._forceUpdate);
  }

  // eslint-disable-next-line react/sort-comp
  _forceUpdate = _.throttle(() => {
    if (!this.isMounted) {
      return;
    }
    this.forceUpdate();
  }, 100);

  getSegmentationCube(): Cube {
    const layer = Model.getSegmentationLayer();
    if (!layer) {
      throw new Error("No segmentation layer found");
    }
    return layer.cube;
  }

  renderIdTable() {
    const {
      mapping,
      isMappingEnabled,
      mappingColors,
      activeViewport,
      mousePosition,
      zoomStep,
      position,
      dataset,
      segmentationLayer,
      renderMissingDataBlack,
    } = this.props;
    const cube = this.getSegmentationCube();
    const hasMapping = mapping != null;
    const customColors = isMappingEnabled ? mappingColors : null;

    let globalMousePosition;
    if (mousePosition && activeViewport !== OrthoViews.TDView) {
      const [x, y] = mousePosition;
      globalMousePosition = calculateGlobalPos({ x, y });
    }

    const flycamPosition = position;
    const resolutions = getResolutions(dataset);
    // While render missing data black is not active and there is no segmentation for the current zoom step,
    // the segmentation of a higher zoom step is shown. Here we determine the the next zoom step of the
    // displayed segmentation data to get the correct segment ids for the camera and the mouse position.
    const getNextUsableZoomStepForPosition = pos => {
      let usableZoomStep = zoomStep;
      while (
        pos &&
        usableZoomStep < resolutions.length - 1 &&
        !cube.hasDataAtPositionAndZoomStep(pos, usableZoomStep)
      ) {
        usableZoomStep++;
      }
      return usableZoomStep;
    };

    const usableZoomStepForCameraPosition = renderMissingDataBlack
      ? zoomStep
      : getNextUsableZoomStepForPosition(flycamPosition);
    const usableZoomStepForMousePosition =
      renderMissingDataBlack || globalMousePosition == null
        ? zoomStep
        : getNextUsableZoomStepForPosition(globalMousePosition);

    const getResolutionOfZoomStepAsString = usedZoomStep => {
      const usedResolution = segmentationLayer ? segmentationLayer.resolutions[usedZoomStep] : null;
      return usedResolution
        ? `${usedResolution[0]}-${usedResolution[1]}-${usedResolution[2]}`
        : "Not available";
    };
    const getIdForPos = (pos, usableZoomStep) =>
      pos && cube.getDataValue(pos, null, usableZoomStep);

    const tableData = [
      {
        name: "Active ID",
        key: "active",
        unmapped: this.props.activeCellId,
        resolution: "",
      },
      {
        name: "ID at the center",
        key: "current",
        unmapped: getIdForPos(flycamPosition, usableZoomStepForCameraPosition),
        resolution: getResolutionOfZoomStepAsString(usableZoomStepForCameraPosition),
      },
      {
        name: (
          <span>
            ID at mouse position{" "}
            <Tooltip
              title={
                message[hasMapping ? "tracing.copy_maybe_mapped_cell_id" : "tracing.copy_cell_id"]
              }
              placement="bottomLeft"
            >
              <Icon type="info-circle" />
            </Tooltip>
          </span>
        ),
        key: "mouse",
        unmapped: getIdForPos(globalMousePosition, usableZoomStepForMousePosition),
        resolution: globalMousePosition
          ? getResolutionOfZoomStepAsString(usableZoomStepForMousePosition)
          : "Not available",
      },
    ]
      .map(idInfo => ({
        ...idInfo,
        mapped: idInfo.unmapped != null ? cube.mapId(idInfo.unmapped) : undefined,
      }))
      .map(idInfo => ({
        ...idInfo,
        unmapped: (
          <span
            style={{
              background: convertCellIdToCSS(idInfo.unmapped),
            }}
          >
            {idInfo.unmapped}
          </span>
        ),
        mapped: (
          <span
            style={{
              background: convertCellIdToCSS(idInfo.mapped, customColors),
            }}
          >
            {idInfo.mapped}
          </span>
        ),
      }));

    const columnHelper = (title, dataIndex) => ({
      title,
      dataIndex,
    });
    const showSegmentation64bitWarning =
      segmentationLayer && segmentationLayer.originalElementClass === "uint64";
    const maybeWithTooltipWarningTitle = title =>
      showSegmentation64bitWarning ? (
        <React.Fragment>
          {title}{" "}
          <Tooltip title={message["tracing.uint64_segmentation_warning"]}>
            <Icon type="warning" style={{ color: "rgb(255, 155, 85)" }} />
          </Tooltip>
        </React.Fragment>
      ) : (
        title
      );
    const idColumns =
      hasMapping && this.props.isMappingEnabled
        ? // Show an unmapped and mapped id column if there's a mapping
          [
            columnHelper(maybeWithTooltipWarningTitle("Unmapped"), "unmapped"),
            columnHelper(maybeWithTooltipWarningTitle("Mapped"), "mapped"),
          ]
        : // Otherwise, only show an ID column
          [columnHelper(maybeWithTooltipWarningTitle("ID"), "unmapped")];
    const columns = [
      columnHelper("", "name"),
      ...idColumns,
      columnHelper("Magnification", "resolution"),
    ];
    return (
      <Table
        size="small"
        dataSource={tableData}
        columns={columns}
        pagination={false}
        align="right"
      />
    );
  }

  handleChangeHideUnmappedSegments = (hideUnmappedIds: boolean) => {
    this.props.setHideUnmappedIds(hideUnmappedIds);
  };

  handleChangeMapping = (packedMappingNameWithCategory: string): void => {
    const [mappingName, mappingType] = unpackMappingNameAndCategory(packedMappingNameWithCategory);

    if (mappingType !== "JSON" && mappingType !== "HDF5") {
      throw new Error("Invalid mapping type");
    }

    const progressCallback = createProgressCallback({
      pauseDelay: 500,
      successMessageDelay: 2000,
    });
    Model.getSegmentationLayer().setActiveMapping(mappingName, mappingType, progressCallback);
  };

  async refreshLayerMappings() {
    if (this.state.didRefreshMappingList) {
      return;
    }
    const { segmentationLayer } = this.props;
    if (!segmentationLayer) {
      return;
    }
    this.setState({ isRefreshingMappingList: true });

    const params = [
      this.props.dataset.dataStore.url,
      this.props.dataset,
      // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
      segmentationLayer.fallbackLayer != null
        ? segmentationLayer.fallbackLayer
        : segmentationLayer.name,
    ];
    const [mappings, agglomerates] = await Promise.all([
      getMappingsForDatasetLayer(...params),
      getAgglomeratesForDatasetLayer(...params),
    ]);

    this.props.setAvailableMappingsForLayer(segmentationLayer.name, mappings, agglomerates);
    this.setState({ isRefreshingMappingList: false, didRefreshMappingList: true });
  }

  handleSetMappingEnabled = (shouldMappingBeEnabled: boolean): void => {
    if (shouldMappingBeEnabled) {
      this.refreshLayerMappings();
    }
    this.setState({ shouldMappingBeEnabled });
    if (this.props.mappingName != null) {
      this.props.setMappingEnabled(shouldMappingBeEnabled);
    }
  };

  render() {
    if (!hasSegmentation()) {
      return "No segmentation available";
    }
    const availableMappings =
      this.props.segmentationLayer != null && this.props.segmentationLayer.mappings != null
        ? this.props.segmentationLayer.mappings
        : [];
    const availableAgglomerates =
      this.props.segmentationLayer != null && this.props.segmentationLayer.agglomerates != null
        ? this.props.segmentationLayer.agglomerates
        : [];

    // Antd does not render the placeholder when a value is defined (even when it's null).
    // That's why, we only pass the value when it's actually defined.
    const selectValueProp =
      this.props.mappingName != null
        ? {
            value: this.props.mappingName,
          }
        : {};

    const renderCategoryOptions = (optionStrings, category) => {
      const useGroups = availableMappings.length > 0 && availableAgglomerates.length > 0;
      const elements = optionStrings
        .slice()
        .sort(Utils.localeCompareBy(([]: Array<string>), optionString => optionString))
        .map(optionString => (
          <Option
            key={packMappingNameAndCategory(optionString, category)}
            value={packMappingNameAndCategory(optionString, category)}
          >
            {optionString}
          </Option>
        ));

      return useGroups ? <OptGroup label={category}>{elements}</OptGroup> : elements;
    };

    // The mapping toggle should be active if either the user clicked on it (this.state.shouldMappingBeEnabled)
    // or a mapping was activated, e.g. from the API or by selecting one from the dropdown (this.props.isMappingEnabled).
    const shouldMappingBeEnabled = this.state.shouldMappingBeEnabled || this.props.isMappingEnabled;

    const renderHideUnmappedSegmentsSwitch =
      (shouldMappingBeEnabled || this.props.isMergerModeEnabled) &&
      this.props.mapping &&
      this.props.hideUnmappedIds != null;

    return (
      <div id="volume-mapping-info" className="padded-tab-content" style={{ maxWidth: 500 }}>
        {this.renderIdTable()}
        <div style={{ marginTop: 24, width: "55%", marginLeft: 16 }}>
          {/* Only display the mapping selection when merger mode is not active
            to avoid conflicts in the logic of the UI. */
          !this.props.isMergerModeEnabled ? (
            <React.Fragment>
              <div style={{ marginBottom: 6 }}>
                <label className="setting-label">
                  ID Mapping
                  <Switch
                    onChange={this.handleSetMappingEnabled}
                    checked={shouldMappingBeEnabled}
                    style={{ float: "right" }}
                    loading={this.state.isRefreshingMappingList}
                  />
                </label>
              </div>

              {/*
            Show mapping-select even when the mapping is disabled but the UI was used before
            (i.e., mappingName != null)
          */}
              {shouldMappingBeEnabled || this.props.mappingName != null ? (
                <Select
                  placeholder="Select mapping"
                  defaultActiveFirstOption={false}
                  style={{ width: "100%", marginBottom: 14 }}
                  {...selectValueProp}
                  onChange={this.handleChangeMapping}
                  notFoundContent="No mappings found."
                >
                  {renderCategoryOptions(availableMappings, "JSON")}
                  {renderCategoryOptions(availableAgglomerates, "HDF5")}
                </Select>
              ) : null}
            </React.Fragment>
          ) : null}
          {renderHideUnmappedSegmentsSwitch ? (
            <label className="setting-label">
              Hide unmapped segments
              <Switch
                onChange={this.handleChangeHideUnmappedSegments}
                checked={this.props.hideUnmappedIds}
                style={{ float: "right" }}
                loading={this.state.isRefreshingMappingList}
              />
            </label>
          ) : null}
        </div>
      </div>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
  setMappingEnabled(isEnabled) {
    dispatch(setMappingEnabledAction(isEnabled));
  },
  setAvailableMappingsForLayer(
    layerName: string,
    mappingNames: Array<string>,
    agglomerateNames: Array<string>,
  ): void {
    dispatch(setLayerMappingsAction(layerName, mappingNames, agglomerateNames));
  },
  setHideUnmappedIds(hideUnmappedIds: boolean): void {
    dispatch(setHideUnmappedIdsAction(hideUnmappedIds));
  },
});

function mapStateToProps(state: OxalisState) {
  return {
    dataset: state.dataset,
    position: getPosition(state.flycam),
    zoomStep: getRequestLogZoomStep(state),
    hideUnmappedIds: state.temporaryConfiguration.activeMapping.hideUnmappedIds,
    isMappingEnabled: state.temporaryConfiguration.activeMapping.isMappingEnabled,
    mapping: state.temporaryConfiguration.activeMapping.mapping,
    mappingName: state.temporaryConfiguration.activeMapping.mappingName,
    mappingType: state.temporaryConfiguration.activeMapping.mappingType,
    mappingColors: state.temporaryConfiguration.activeMapping.mappingColors,
    mousePosition: state.temporaryConfiguration.mousePosition,
    activeViewport: state.viewModeData.plane.activeViewport,
    segmentationLayer: getSegmentationLayer(state.dataset),
    activeCellId: getVolumeTracing(state.tracing)
      .map(tracing => tracing.activeCellId)
      .getOrElse(0),
    isMergerModeEnabled: state.temporaryConfiguration.isMergerModeEnabled,
    renderMissingDataBlack: state.datasetConfiguration.renderMissingDataBlack,
  };
}

const debounceTime = 100;
const maxWait = 500;
export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
  null,
  {
    pure: false,
  },
)(debounceRender(MappingInfoView, debounceTime, { maxWait }));
