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
import type { OxalisState, Mapping } from "oxalis/store";
import { calculateGlobalPos } from "oxalis/controller/viewmodes/plane_controller";
import { getMappingsForDatasetLayer } from "admin/admin_rest_api";
import { getPosition, getRequestLogZoomStep } from "oxalis/model/accessors/flycam_accessor";
import { getSegmentationLayer } from "oxalis/model/accessors/dataset_accessor";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setLayerMappingsAction } from "oxalis/model/actions/dataset_actions";
import { setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import Cube from "oxalis/model/bucket_data_handling/data_cube";
import Model from "oxalis/model";
import message from "messages";
import * as Utils from "libs/utils";

const { Option } = Select;

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
  mappingColors: ?Array<number>,
  setMappingEnabled: boolean => void,
  setAvailableMappingsForLayer: (string, Array<string>) => void,
  activeViewport: OrthoView,
  activeCellId: number,
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

// This function mirrors convertCellIdToRGB in the fragment shader of the rendering plane
export const convertCellIdToHSLA = (id: number, customColors: ?Array<number>): Array<number> => {
  if (id === 0) {
    // Return white
    return [1, 1, 1, 1];
  }

  const goldenRatio = 0.618033988749895;
  const lastEightBits = id & (2 ** 8 - 1);
  const computedColor = (lastEightBits * goldenRatio) % 1.0;
  const value = customColors != null ? customColors[lastEightBits] || 0 : computedColor;

  return [value, 1, 0.5, 0.15];
};

const convertHSLAToCSSString = ([h, s, l, a]) => `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
const convertCellIdToCSS = (id, customColors) =>
  convertHSLAToCSSString(convertCellIdToHSLA(id, customColors));

const hasSegmentation = () => Model.getSegmentationLayer() != null;

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
    const cube = this.getSegmentationCube();
    const hasMapping = this.props.mapping != null;
    const customColors = this.props.isMappingEnabled ? this.props.mappingColors : null;

    let globalMousePosition;
    if (this.props.mousePosition && this.props.activeViewport !== OrthoViews.TDView) {
      const [x, y] = this.props.mousePosition;
      globalMousePosition = calculateGlobalPos({ x, y });
    }

    const getIdForPos = pos => pos && cube.getDataValue(pos, null, this.props.zoomStep);

    const tableData = [
      { name: "Active ID", key: "active", unmapped: this.props.activeCellId },
      {
        name: "ID at current position",
        key: "current",
        unmapped: getIdForPos(this.props.position),
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
        unmapped: getIdForPos(globalMousePosition),
      },
    ]
      .map(idInfo => ({
        ...idInfo,
        mapped: idInfo.unmapped != null ? cube.mapId(idInfo.unmapped) : undefined,
      }))
      .map(idInfo => ({
        ...idInfo,
        unmapped: (
          <span style={{ background: convertCellIdToCSS(idInfo.unmapped) }}>{idInfo.unmapped}</span>
        ),
        mapped: (
          <span style={{ background: convertCellIdToCSS(idInfo.mapped, customColors) }}>
            {idInfo.mapped}
          </span>
        ),
      }));

    const columnHelper = (title, dataIndex) => ({ title, dataIndex });
    const idColumns =
      hasMapping && this.props.isMappingEnabled
        ? // Show an unmapped and mapped id column if there's a mapping
          [columnHelper("Unmapped", "unmapped"), columnHelper("Mapped", "mapped")]
        : // Otherwise, only show an ID column
          [columnHelper("ID", "unmapped")];
    const columns = [columnHelper("", "name"), ...idColumns];
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

  handleChangeMapping = (mappingName: string): void => {
    const progressCallback = createProgressCallback({ pauseDelay: 500, successMessageDelay: 2000 });
    Model.getSegmentationLayer().setActiveMapping(mappingName, progressCallback);
    this.handleSetMappingEnabled(true);
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
    const mappings = await getMappingsForDatasetLayer(
      this.props.dataset.dataStore.url,
      this.props.dataset,
      segmentationLayer.name,
    );

    this.props.setAvailableMappingsForLayer(segmentationLayer.name, mappings);
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

    // Antd does not render the placeholder when a value is defined (even when it's null).
    // That's why, we only pass the value when it's actually defined.
    const selectValueProp =
      this.props.mappingName != null
        ? {
            value: this.props.mappingName,
          }
        : {};

    return (
      <div id="volume-mapping-info" className="padded-tab-content" style={{ maxWidth: 500 }}>
        {this.renderIdTable()}

        <div style={{ marginTop: 24, width: "50%", marginLeft: 16 }}>
          <div style={{ marginBottom: 6 }}>
            <label className="setting-label">
              ID Mapping
              <Switch
                onChange={this.handleSetMappingEnabled}
                checked={this.state.shouldMappingBeEnabled}
                style={{ float: "right" }}
                loading={this.state.isRefreshingMappingList}
              />
            </label>
          </div>

          {/*
            Show mapping-select even when the mapping is disabled but the UI was used before
            (i.e., mappingName != null)
          */}
          {this.state.shouldMappingBeEnabled || this.props.mappingName != null ? (
            <Select
              placeholder="Select mapping"
              defaultActiveFirstOption={false}
              style={{ width: "100%" }}
              {...selectValueProp}
              onChange={this.handleChangeMapping}
              notFoundContent="No mappings found."
            >
              {availableMappings
                .slice()
                .sort(Utils.localeCompareBy(([]: Array<string>), mapping => mapping))
                .map(mapping => (
                  <Option key={mapping} value={mapping}>
                    {mapping}
                  </Option>
                ))}
            </Select>
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
  setAvailableMappingsForLayer(layerName: string, mappingNames: Array<string>): void {
    dispatch(setLayerMappingsAction(layerName, mappingNames));
  },
});

function mapStateToProps(state: OxalisState) {
  return {
    dataset: state.dataset,
    position: getPosition(state.flycam),
    zoomStep: getRequestLogZoomStep(state),
    isMappingEnabled: state.temporaryConfiguration.activeMapping.isMappingEnabled,
    mapping: state.temporaryConfiguration.activeMapping.mapping,
    mappingName: state.temporaryConfiguration.activeMapping.mappingName,
    mappingColors: state.temporaryConfiguration.activeMapping.mappingColors,
    mousePosition: state.temporaryConfiguration.mousePosition,
    activeViewport: state.viewModeData.plane.activeViewport,
    segmentationLayer: getSegmentationLayer(state.dataset),
    activeCellId: getVolumeTracing(state.tracing)
      .map(tracing => tracing.activeCellId)
      .getOrElse(0),
  };
}

const debounceTime = 100;
export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
  null,
  {
    pure: false,
  },
)(debounceRender(MappingInfoView, debounceTime));
