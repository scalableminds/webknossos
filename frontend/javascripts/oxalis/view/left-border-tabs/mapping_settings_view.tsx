import { Select, Tooltip } from "antd";
import { connect } from "react-redux";
import React from "react";
import debounceRender from "react-debounce-render";
import type { APIDataset, APISegmentationLayer } from "types/api_flow_types";
import type { Vector3 } from "oxalis/constants";
import { MappingStatusEnum } from "oxalis/constants";
import type { OxalisState, Mapping, MappingType, EditableMapping } from "oxalis/store";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  getSegmentationLayerByName,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  ensureLayerMappingsAreLoadedAction,
  setLayerMappingsAction,
} from "oxalis/model/actions/dataset_actions";
import {
  setMappingEnabledAction,
  setHideUnmappedIdsAction,
  setMappingAction,
} from "oxalis/model/actions/settings_actions";
import { SwitchSetting } from "oxalis/view/components/setting_input_views";
import * as Utils from "libs/utils";
import {
  getEditableMappingForVolumeTracingId,
  hasEditableMapping,
  isMappingPinned,
} from "oxalis/model/accessors/volumetracing_accessor";

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
  editableMapping: EditableMapping | null | undefined;
  isMappingPinned: boolean;
  isMergerModeEnabled: boolean;
  allowUpdate: boolean;
  isEditableMappingActive: boolean;
} & typeof mapDispatchToProps;
type Props = OwnProps & StateProps;
type State = {
  // shouldMappingBeEnabled is the UI state which is directly connected to the
  // toggle button. The actual mapping in the store is only activated when
  // the user selects a mapping from the dropdown (which is only possible after
  // using the toggle). This is why, there is this.state.shouldMappingBeEnabled and
  // this.props.isMappingEnabled
  shouldMappingBeEnabled: boolean;
  isRefreshingMappingList: boolean;
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
  };

  componentDidMount() {
    if (this.props.isMappingEnabled) {
      this.ensureMappingsAreLoaded();
    }
  }

  componentDidUpdate(prevProps: Props) {
    if (this.props.isMappingEnabled !== prevProps.isMappingEnabled) {
      this.ensureMappingsAreLoaded();
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

  async ensureMappingsAreLoaded() {
    const { segmentationLayer } = this.props;

    if (!segmentationLayer) {
      return;
    }

    this.props.ensureLayerMappingsAreLoaded(segmentationLayer.name);
  }

  handleSetMappingEnabled = (shouldMappingBeEnabled: boolean): void => {
    if (shouldMappingBeEnabled) {
      this.ensureMappingsAreLoaded();
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
      this.props.segmentationLayer?.mappings != null ? this.props.segmentationLayer.mappings : [];
    const availableAgglomerates =
      this.props.segmentationLayer?.agglomerates != null
        ? this.props.segmentationLayer.agglomerates
        : [];
    // Antd does not render the placeholder when a value is defined (even when it's null).
    // That's why, we only pass the value when it's actually defined.
    const selectValueProp =
      this.props.mappingName != null
        ? {
            value:
              this.props.editableMapping != null
                ? `${this.props.editableMapping.baseMappingName} (${this.props.mappingName})`
                : this.props.mappingName,
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
    const isDisabled = this.props.isEditableMappingActive || this.props.isMappingPinned;
    const disabledMessage = this.props.isEditableMappingActive
      ? "Editable mappings from proofreading actions cannot be disabled"
      : this.props.mapping
      ? "This mapping has been pinned to this annotation and thus cannot be disabled."
      : "This annotation was started with no mapping enabled. To ensure a consistent state, mappings cannot be enabled.";
    return (
      <React.Fragment>
        {
          /* Only display the mapping selection when merger mode is not active
         to avoid conflicts in the logic of the UI. */
          !this.props.isMergerModeEnabled ? (
            <React.Fragment>
              <Tooltip title={isDisabled ? disabledMessage : null}>
                <div
                  style={{
                    marginBottom: 6,
                  }}
                >
                  <SwitchSetting
                    onChange={this.handleSetMappingEnabled}
                    value={shouldMappingBeEnabled}
                    label="ID Mapping"
                    // Assume that the mappings are being loaded if they are null
                    loading={
                      shouldMappingBeEnabled && this.props.segmentationLayer?.mappings == null
                    }
                    disabled={isDisabled}
                  />
                </div>
              </Tooltip>

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
                  disabled={isDisabled}
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
  ensureLayerMappingsAreLoaded: ensureLayerMappingsAreLoadedAction,
};

function mapStateToProps(state: OxalisState, ownProps: OwnProps) {
  const activeMappingInfo = getMappingInfo(
    state.temporaryConfiguration.activeMappingByLayer,
    ownProps.layerName,
  );
  const segmentationLayer = getSegmentationLayerByName(state.dataset, ownProps.layerName);
  const editableMapping = getEditableMappingForVolumeTracingId(state, segmentationLayer.tracingId);

  return {
    dataset: state.dataset,
    position: getPosition(state.flycam),
    hideUnmappedIds: activeMappingInfo.hideUnmappedIds,
    isMappingEnabled: activeMappingInfo.mappingStatus === MappingStatusEnum.ENABLED,
    mapping: activeMappingInfo.mapping,
    mappingName: activeMappingInfo.mappingName,
    mappingType: activeMappingInfo.mappingType,
    mappingColors: activeMappingInfo.mappingColors,
    segmentationLayer,
    isMergerModeEnabled: state.temporaryConfiguration.isMergerModeEnabled,
    allowUpdate: state.tracing.restrictions.allowUpdate,
    editableMapping,
    isEditableMappingActive: hasEditableMapping(state, ownProps.layerName),
    isMappingPinned: isMappingPinned(state, ownProps.layerName),
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
