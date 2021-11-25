// @flow

import { Select, Tooltip } from "antd";
import { connect } from "react-redux";
import React from "react";
import _ from "lodash";
import debounceRender from "react-debounce-render";

import type { APIDataset, APISegmentationLayer } from "types/api_flow_types";
import { type OrthoView, type Vector3, MappingStatusEnum } from "oxalis/constants";
import { type OxalisState, type Mapping, type MappingType } from "oxalis/store";
import { getMappingsForDatasetLayer, getAgglomeratesForDatasetLayer } from "admin/admin_rest_api";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getSegmentationLayerByName,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { getVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { setLayerMappingsAction } from "oxalis/model/actions/dataset_actions";
import {
  setMappingEnabledAction,
  setHideUnmappedIdsAction,
  setMappingAction,
  type OptionalMappingProperties,
} from "oxalis/model/actions/settings_actions";
import Model from "oxalis/model";
import { SwitchSetting } from "oxalis/view/components/setting_input_views";
import * as Utils from "libs/utils";
import { jsConvertCellIdToHSLA } from "oxalis/shaders/segmentation.glsl";
import { AsyncButton } from "components/async_clickables";
import { loadAgglomerateSkeletonAtPosition } from "oxalis/controller/combinations/segmentation_handlers";

const { Option, OptGroup } = Select;

type OwnProps = {|
  layerName: string,
|};
type StateProps = {|
  dataset: APIDataset,
  segmentationLayer: ?APISegmentationLayer,
  position: Vector3,
  isMappingEnabled: boolean,
  mapping: ?Mapping,
  mappingName: ?string,
  hideUnmappedIds: ?boolean,
  mappingType: MappingType,
  mappingColors: ?Array<number>,
  setMappingEnabled: (string, boolean) => void,
  setHideUnmappedIds: (string, boolean) => void,
  setAvailableMappingsForLayer: (string, Array<string>, Array<string>) => void,
  setMapping: (
    string,
    ?string,
    MappingType,
    optionalProperties?: OptionalMappingProperties,
  ) => void,
  activeViewport: OrthoView,
  activeCellId: number,
  isMergerModeEnabled: boolean,
  allowUpdate: boolean,
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

const convertHSLAToCSSString = ([h, s, l, a]) => `hsla(${360 * h}, ${100 * s}%, ${100 * l}%, ${a})`;
export const convertCellIdToCSS = (id: number, customColors: ?Array<number>, alpha?: number) =>
  id === 0 ? "transparent" : convertHSLAToCSSString(jsConvertCellIdToHSLA(id, customColors, alpha));

const hasSegmentation = () => Model.getVisibleSegmentationLayer() != null;

const needle = "##";
const packMappingNameAndCategory = (mappingName, category) => `${category}${needle}${mappingName}`;
const unpackMappingNameAndCategory = packedString => {
  const needlePos = packedString.indexOf(needle);
  const categoryName = packedString.slice(0, needlePos);
  const mappingName = packedString.slice(needlePos + needle.length);
  return [mappingName, categoryName];
};

class MappingSettingsView extends React.Component<Props, State> {
  state = {
    shouldMappingBeEnabled: false,
    isRefreshingMappingList: false,
    didRefreshMappingList: false,
  };

  componentDidMount() {
    if (this.props.isMappingEnabled) {
      this.refreshLayerMappings();
    }
  }

  componentDidUpdate(prevProps) {
    if (this.props.isMappingEnabled !== prevProps.isMappingEnabled) {
      this.refreshLayerMappings();
    }
  }

  handleChangeHideUnmappedSegments = (hideUnmappedIds: boolean) => {
    this.props.setHideUnmappedIds(this.props.layerName, hideUnmappedIds);
  };

  handleChangeMapping = (packedMappingNameWithCategory: string): void => {
    const [mappingName, mappingType] = unpackMappingNameAndCategory(packedMappingNameWithCategory);

    if (mappingType !== "JSON" && mappingType !== "HDF5") {
      throw new Error("Invalid mapping type");
    }

    this.props.setMapping(this.props.layerName, mappingName, mappingType, {
      showLoadingIndicator: true,
    });

    if (document.activeElement) document.activeElement.blur();
  };

  async refreshLayerMappings() {
    if (this.state.didRefreshMappingList || this.state.isRefreshingMappingList) {
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
      this.props.setMappingEnabled(this.props.layerName, shouldMappingBeEnabled);
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
            Import Skeleton for Centered Segment
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
      <React.Fragment>
        {/* Only display the mapping selection when merger mode is not active
            to avoid conflicts in the logic of the UI. */
        !this.props.isMergerModeEnabled ? (
          <React.Fragment>
            <div style={{ marginBottom: 6 }}>
              <SwitchSetting
                onChange={this.handleSetMappingEnabled}
                value={shouldMappingBeEnabled}
                label="ID Mapping"
                loading={this.state.isRefreshingMappingList}
              />
            </div>

            {/*
            Show mapping-select even when the mapping is disabled but the UI was used before
            (i.e., mappingName != null)
          */}
            {shouldMappingBeEnabled ? (
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
          <SwitchSetting
            onChange={this.handleChangeHideUnmappedSegments}
            value={this.props.hideUnmappedIds === true}
            label="Hide unmapped segments"
            loading={this.state.isRefreshingMappingList}
          />
        ) : null}
        {this.renderAgglomerateSkeletonButton()}
      </React.Fragment>
    );
  }
}

const mapDispatchToProps = {
  setMappingEnabled: setMappingEnabledAction,
  setAvailableMappingsForLayer: setLayerMappingsAction,
  setHideUnmappedIds: setHideUnmappedIdsAction,
  setMapping: setMappingAction,
};

function mapStateToProps(state: OxalisState, ownProps: OwnProps) {
  const activeMappingInfo = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    ownProps.layerName,
  );
  return {
    dataset: state.dataset,
    position: getPosition(state.flycam),
    hideUnmappedIds: activeMappingInfo.hideUnmappedIds,
    isMappingEnabled: activeMappingInfo.mappingStatus === MappingStatusEnum.ENABLED,
    mapping: activeMappingInfo.mapping,
    mappingName: activeMappingInfo.mappingName,
    mappingType: activeMappingInfo.mappingType,
    mappingColors: activeMappingInfo.mappingColors,
    activeViewport: state.viewModeData.plane.activeViewport,
    segmentationLayer: getSegmentationLayerByName(state.dataset, ownProps.layerName),
    activeCellId: getVolumeTracing(state.tracing)
      .map(tracing => tracing.activeCellId)
      .getOrElse(0),
    isMergerModeEnabled: state.temporaryConfiguration.isMergerModeEnabled,
    allowUpdate: state.tracing.restrictions.allowUpdate,
  };
}

const debounceTime = 100;
const maxWait = 500;
export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(debounceRender(MappingSettingsView, debounceTime, { maxWait }));
