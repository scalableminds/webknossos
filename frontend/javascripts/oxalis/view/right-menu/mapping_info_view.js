// @flow

import { Select, Switch, Table, Tooltip } from "antd";
import { InfoCircleOutlined, WarningOutlined } from "@ant-design/icons";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import debounceRender from "react-debounce-render";

import createProgressCallback from "libs/progress_callback";
import type { APIDataset, APISegmentationLayer } from "types/api_flow_types";
import { type OrthoView, OrthoViews, type Vector2, type Vector3 } from "oxalis/constants";
import type { OxalisState, Mapping, MappingType } from "oxalis/store";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getMappingsForDatasetLayer, getAgglomeratesForDatasetLayer } from "admin/admin_rest_api";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getSegmentationLayer,
  getResolutionInfoOfSegmentationLayer,
} from "oxalis/model/accessors/dataset_accessor";
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
import { jsConvertCellIdToHSLA } from "oxalis/shaders/segmentation.glsl";
import DataLayer from "oxalis/model/data_layer";
import api from "oxalis/api/internal_api";
import { AsyncButton } from "components/async_clickables";
import { loadAgglomerateSkeletonAtPosition } from "oxalis/controller/combinations/segmentation_plane_controller";

const { Option, OptGroup } = Select;

type StateProps = {|
  dataset: APIDataset,
  segmentationLayer: ?APISegmentationLayer,
  position: Vector3,
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
  allowUpdate: boolean,
|};
type Props = {| ...StateProps |};

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

const convertHSLAToCSSString = ([h, s, l, a]) => `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
export const convertCellIdToCSS = (id: number, customColors: ?Array<number>, alpha?: number) =>
  id === 0 ? "transparent" : convertHSLAToCSSString(jsConvertCellIdToHSLA(id, customColors, alpha));

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

  getSegmentationLayer(): DataLayer {
    const layer = Model.getSegmentationLayer();
    if (!layer) {
      throw new Error("No segmentation layer found");
    }
    return layer;
  }

  getSegmentationCube(): Cube {
    const segmentationLayer = this.getSegmentationLayer();
    return segmentationLayer.cube;
  }

  renderIdTable() {
    const {
      mapping,
      isMappingEnabled,
      mappingColors,
      activeViewport,
      mousePosition,
      position,
      dataset,
      segmentationLayer,
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
    const segmentationLayerName = this.getSegmentationLayer().name;

    const renderedZoomStepForCameraPosition = api.data.getRenderedZoomStepAtPosition(
      segmentationLayerName,
      flycamPosition,
    );
    const renderedZoomStepForMousePosition = api.data.getRenderedZoomStepAtPosition(
      segmentationLayerName,
      globalMousePosition,
    );

    const getResolutionOfZoomStepAsString = usedZoomStep => {
      const usedResolution = getResolutionInfoOfSegmentationLayer(dataset).getResolutionByIndex(
        usedZoomStep,
      );
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
        unmapped: getIdForPos(flycamPosition, renderedZoomStepForCameraPosition),
        resolution: getResolutionOfZoomStepAsString(renderedZoomStepForCameraPosition),
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
              <InfoCircleOutlined />
            </Tooltip>
          </span>
        ),
        key: "mouse",
        unmapped: getIdForPos(globalMousePosition, renderedZoomStepForMousePosition),
        resolution: globalMousePosition
          ? getResolutionOfZoomStepAsString(renderedZoomStepForMousePosition)
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
              background: convertCellIdToCSS(idInfo.unmapped || 0, null, 0.15),
            }}
          >
            {idInfo.unmapped}
          </span>
        ),
        mapped: (
          <span
            style={{
              background: convertCellIdToCSS(idInfo.mapped || 0, customColors, 0.15),
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
            <WarningOutlined style={{ color: "rgb(255, 155, 85)" }} />
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

    if (document.activeElement) document.activeElement.blur();
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

  renderAgglomerateSkeletonButton = () => {
    const { mappingName, mappingType } = this.props;
    const isAgglomerateMapping = mappingType === "HDF5";

    // Only show the option to import a skeleton from an agglomerate file if an agglomerate file mapping is activated.
    const shouldRender = this.props.isMappingEnabled && mappingName != null && isAgglomerateMapping;
    const isDisabled = !this.props.allowUpdate;
    const disabledMessage = "Skeletons cannot be imported in view mode or read-only tracings.";

    return shouldRender ? (
      <Tooltip title={isDisabled ? disabledMessage : null}>
        {/* Workaround to fix antd bug, see https://github.com/react-component/tooltip/issues/18#issuecomment-650864750 */}
        <span style={{ cursor: isDisabled ? "not-allowed" : "pointer" }}>
          <AsyncButton
            onClick={() => loadAgglomerateSkeletonAtPosition(this.props.position)}
            disabled={isDisabled}
            style={isDisabled ? { pointerEvents: "none" } : {}}
          >
            Import Skeleton for Centered Cell
          </AsyncButton>
        </span>
      </Tooltip>
    ) : null;
  };

  render() {
    if (!hasSegmentation()) {
      return <div className="padded-tab-content">No segmentation available</div>;
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
            title={optionString}
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
          {this.renderAgglomerateSkeletonButton()}
        </div>
      </div>
    );
  }
}

const mapDispatchToProps = {
  setMappingEnabled: setMappingEnabledAction,
  setAvailableMappingsForLayer: setLayerMappingsAction,
  setHideUnmappedIds: setHideUnmappedIdsAction,
};

function mapStateToProps(state: OxalisState) {
  return {
    dataset: state.dataset,
    position: getPosition(state.flycam),
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
    allowUpdate: state.tracing.restrictions.allowUpdate,
  };
}

const debounceTime = 100;
const maxWait = 500;
export default connect<Props, {||}, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(debounceRender(MappingInfoView, debounceTime, { maxWait }));
