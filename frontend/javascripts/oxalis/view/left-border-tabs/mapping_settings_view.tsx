import { Select } from "antd";
import { connect } from "react-redux";
import React from "react";
import debounceRender from "react-debounce-render";
import type { APISegmentationLayer } from "types/api_flow_types";
import { MappingStatusEnum } from "oxalis/constants";
import type { OxalisState, Mapping, MappingType, EditableMapping } from "oxalis/store";
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
  isMappingLocked,
} from "oxalis/model/accessors/volumetracing_accessor";
import messages from "messages";
import { isAnnotationOwner } from "oxalis/model/accessors/annotation_accessor";
import FastTooltip from "components/fast_tooltip";

const { Option, OptGroup } = Select;

type OwnProps = {
  layerName: string;
};
type StateProps = {
  segmentationLayer: APISegmentationLayer | null | undefined;
  isMappingEnabled: boolean;
  mapping: Mapping | null | undefined;
  mappingName: string | null | undefined;
  hideUnmappedIds: boolean | null | undefined;
  mappingType: MappingType;
  editableMapping: EditableMapping | null | undefined;
  isMappingLocked: boolean;
  isMergerModeEnabled: boolean;
  allowUpdate: boolean; // TODOM: Mal mit philipp quatschen, ob das wirklich so ok ist diesen weg einzuschlagen
  isEditableMappingActive: boolean;
  isAnnotationLockedByOwner: boolean;
  isOwner: boolean;
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
    const {
      segmentationLayer,
      mappingName,
      editableMapping,
      isMergerModeEnabled,
      mapping,
      hideUnmappedIds,
      isMappingEnabled,
      isMappingLocked,
      allowUpdate,
      isEditableMappingActive,
      isAnnotationLockedByOwner,
      isOwner,
    } = this.props;

    const availableMappings = segmentationLayer?.mappings != null ? segmentationLayer.mappings : [];
    const availableAgglomerates = segmentationLayer?.agglomerates || [];
    // Antd does not render the placeholder when a value is defined (even when it's null).
    // That's why, we only pass the value when it's actually defined.
    const selectValueProp =
      mappingName != null
        ? {
            value:
              editableMapping != null
                ? `${editableMapping.baseMappingName} (${mappingName})`
                : mappingName,
          }
        : {};

    const renderCategoryOptions = (optionStrings: string[], category: MappingType) => {
      const useGroups = availableMappings.length > 0 && availableAgglomerates.length > 0;
      const elements = optionStrings
        .slice()
        .sort(Utils.localeCompareBy((optionString) => optionString))
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
    const shouldMappingBeEnabled = this.state.shouldMappingBeEnabled || isMappingEnabled;
    const renderHideUnmappedSegmentsSwitch =
      (shouldMappingBeEnabled || isMergerModeEnabled) &&
      mapping &&
      this.props.mappingType === "JSON" &&
      hideUnmappedIds != null;
    const isDisabled = isEditableMappingActive || isMappingLocked || isAnnotationLockedByOwner;
    const disabledMessage = !allowUpdate
      ? messages["tracing.read_only_mode_notification"](isAnnotationLockedByOwner, isOwner)
      : isEditableMappingActive
        ? "The mapping has been edited through proofreading actions and can no longer be disabled or changed."
        : isMappingEnabled
          ? "This mapping has been locked to this annotation, because the segmentation was modified while it was active. It can no longer be disabled or changed."
          : "The segmentation was modified while no mapping was active. To ensure a consistent state, mappings can no longer be enabled.";
    return (
      <React.Fragment>
        {
          /* Only display the mapping selection when merger mode is not active
         to avoid conflicts in the logic of the UI. */
          !this.props.isMergerModeEnabled ? (
            <React.Fragment>
              <FastTooltip title={isDisabled ? disabledMessage : null}>
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
                    loading={shouldMappingBeEnabled && segmentationLayer?.mappings == null}
                    disabled={isDisabled}
                  />
                </div>
              </FastTooltip>

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
            value={hideUnmappedIds}
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
    hideUnmappedIds: activeMappingInfo.hideUnmappedIds,
    isMappingEnabled: activeMappingInfo.mappingStatus === MappingStatusEnum.ENABLED,
    mapping: activeMappingInfo.mapping,
    mappingName: activeMappingInfo.mappingName,
    mappingType: activeMappingInfo.mappingType,
    segmentationLayer,
    isMergerModeEnabled: state.temporaryConfiguration.isMergerModeEnabled,
    allowUpdate: state.tracing.restrictions.allowUpdate,
    editableMapping,
    isEditableMappingActive: hasEditableMapping(state, ownProps.layerName),
    isMappingLocked: isMappingLocked(state, ownProps.layerName),
    isAnnotationLockedByOwner: state.tracing.isLockedByOwner,
    isOwner: isAnnotationOwner(state),
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
