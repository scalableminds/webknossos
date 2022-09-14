import { Select } from "antd";
import { connect } from "react-redux";
import React from "react";
import debounceRender from "react-debounce-render";
import type { APIDataset, APISegmentationLayer } from "types/api_flow_types";
import type { OrthoView, Vector3, Vector4 } from "oxalis/constants";
import { MappingStatusEnum } from "oxalis/constants";
import type { OxalisState, Mapping, MappingType } from "oxalis/store";
import { getMappingsForDatasetLayer, getAgglomeratesForDatasetLayer } from "admin/admin_rest_api";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getSegmentationLayerByName,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { setLayerMappingsAction } from "oxalis/model/actions/dataset_actions";
import type { OptionalMappingProperties } from "oxalis/model/actions/settings_actions";
import {
  setMappingEnabledAction,
  setHideUnmappedIdsAction,
  setMappingAction,
} from "oxalis/model/actions/settings_actions";
import { SwitchSetting } from "oxalis/view/components/setting_input_views";
import * as Utils from "libs/utils";
import { hasEditableMapping } from "oxalis/model/accessors/volumetracing_accessor";
const { Option, OptGroup } = Select;

type OwnProps = {
  layerName: string;
};
type StateProps = {
  dataset: APIDataset;
  segmentationLayer: APISegmentationLayer | null | undefined;
  position: Vector3;
  isMappingEnabled: boolean;
  mapping: Mapping | null | undefined;
  mappingName: string | null | undefined;
  hideUnmappedIds: boolean | null | undefined;
  mappingType: MappingType;
  mappingColors: Array<number> | null | undefined;
  setMappingEnabled: (arg0: string, arg1: boolean) => void;
  setHideUnmappedIds: (arg0: string, arg1: boolean) => void;
  setAvailableMappingsForLayer: (arg0: string, arg1: Array<string>, arg2: Array<string>) => void;
  setMapping: (
    arg0: string,
    arg1: string | null | undefined,
    arg2: MappingType,
    optionalProperties?: OptionalMappingProperties,
  ) => void;
  activeViewport: OrthoView;
  isMergerModeEnabled: boolean;
  allowUpdate: boolean;
  isEditableMappingActive: boolean;
};
type Props = OwnProps & StateProps;
type State = {
  // shouldMappingBeEnabled is the UI state which is directly connected to the
  // toggle button. The actual mapping in the store is only activated when
  // the user selects a mapping from the dropdown (which is only possible after
  // using the toggle). This is why, there is this.state.shouldMappingBeEnabled and
  // this.props.isMappingEnabled
  shouldMappingBeEnabled: boolean;
  isRefreshingMappingList: boolean;
  didRefreshMappingList: boolean;
};

const needle = "##";

const packMappingNameAndCategory = (mappingName: string, category: MappingType) =>
  `${category}${needle}${mappingName}`;

const unpackMappingNameAndCategory = (packedString: string) => {
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

  componentDidUpdate(prevProps: Props) {
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
    // @ts-ignore
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

    this.setState({
      isRefreshingMappingList: true,
    });
    const params: [string, APIDataset, string] = [
      this.props.dataset.dataStore.url,
      this.props.dataset, // If there is a fallbackLayer, request mappings for that instead of the tracing segmentation layer
      segmentationLayer.fallbackLayer != null
        ? segmentationLayer.fallbackLayer
        : segmentationLayer.name,
    ];
    const [mappings, agglomerates] = await Promise.all([
      getMappingsForDatasetLayer(...params),
      getAgglomeratesForDatasetLayer(...params),
    ]);
    this.props.setAvailableMappingsForLayer(segmentationLayer.name, mappings, agglomerates);
    this.setState({
      isRefreshingMappingList: false,
      didRefreshMappingList: true,
    });
  }

  handleSetMappingEnabled = (shouldMappingBeEnabled: boolean): void => {
    if (shouldMappingBeEnabled) {
      this.refreshLayerMappings();
    }

    this.setState({
      shouldMappingBeEnabled,
    });

    if (this.props.mappingName != null) {
      this.props.setMappingEnabled(this.props.layerName, shouldMappingBeEnabled);
    }
  };

  render() {
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

    const renderCategoryOptions = (optionStrings: string[], category: MappingType) => {
      const useGroups = availableMappings.length > 0 && availableAgglomerates.length > 0;
      const elements = optionStrings
        .slice()
        .sort(Utils.localeCompareBy([] as Array<string>, (optionString) => optionString))
        .map((optionString) => (
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
        {
          /* Only display the mapping selection when merger mode is not active
         to avoid conflicts in the logic of the UI. */
          !this.props.isMergerModeEnabled ? (
            <React.Fragment>
              <div
                style={{
                  marginBottom: 6,
                }}
              >
                <SwitchSetting
                  onChange={this.handleSetMappingEnabled}
                  value={shouldMappingBeEnabled}
                  label="ID Mapping"
                  loading={this.state.isRefreshingMappingList}
                  disabled={this.props.isEditableMappingActive}
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
                  style={{
                    width: "100%",
                    marginBottom: 14,
                  }}
                  {...selectValueProp}
                  onChange={this.handleChangeMapping}
                  notFoundContent="No mappings found."
                  disabled={this.props.isEditableMappingActive}
                >
                  {renderCategoryOptions(availableMappings, "JSON")}
                  {renderCategoryOptions(availableAgglomerates, "HDF5")}
                </Select>
              ) : null}
            </React.Fragment>
          ) : null
        }
        {renderHideUnmappedSegmentsSwitch ? (
          <SwitchSetting
            onChange={this.handleChangeHideUnmappedSegments}
            value={this.props.hideUnmappedIds === true}
            label="Hide unmapped segments"
            loading={this.state.isRefreshingMappingList}
          />
        ) : null}
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
    isMergerModeEnabled: state.temporaryConfiguration.isMergerModeEnabled,
    allowUpdate: state.tracing.restrictions.allowUpdate,
    isEditableMappingActive: hasEditableMapping(state, ownProps.layerName),
  };
}

const debounceTime = 100;
const maxWait = 500;

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(
  debounceRender(MappingSettingsView, debounceTime, {
    maxWait,
  }),
);
