import { Select } from "antd";
import FastTooltip from "components/fast_tooltip";
import { useWkSelector } from "libs/react_hooks";
import * as Utils from "libs/utils";
import messages from "messages";
import type React from "react";
import { Fragment, useCallback, useEffect, useState } from "react";
import { useDispatch } from "react-redux";
import { MappingStatusEnum } from "viewer/constants";
import { isAnnotationOwner } from "viewer/model/accessors/annotation_accessor";
import {
  getMappingInfo,
  getSegmentationLayerByName,
} from "viewer/model/accessors/dataset_accessor";
import {
  getEditableMappingForVolumeTracingId,
  hasEditableMapping,
  isMappingLocked as isMappingLockedAccessor,
} from "viewer/model/accessors/volumetracing_accessor";
import { ensureLayerMappingsAreLoadedAction } from "viewer/model/actions/dataset_actions";
import {
  setHideUnmappedIdsAction,
  setMappingAction,
  setMappingEnabledAction,
} from "viewer/model/actions/settings_actions";
import type { MappingType } from "viewer/store";
import { SwitchSetting } from "viewer/view/components/setting_input_views";

const { Option, OptGroup } = Select;

type Props = {
  layerName: string;
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

const MappingSettingsView: React.FC<Props> = (props) => {
  const { layerName } = props;
  const dispatch = useDispatch();
  const [shouldMappingBeEnabled, setShouldMappingBeEnabled] = useState(false);

  const activeMappingInfo = useWkSelector((state) =>
    getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
  );
  const segmentationLayer = useWkSelector((state) =>
    getSegmentationLayerByName(state.dataset, layerName),
  );
  const editableMapping = useWkSelector((state) =>
    getEditableMappingForVolumeTracingId(state, segmentationLayer.tracingId),
  );

  const { hideUnmappedIds, mapping, mappingName, mappingType } = activeMappingInfo;

  const isMappingEnabled = activeMappingInfo.mappingStatus === MappingStatusEnum.ENABLED;
  const isMergerModeEnabled = useWkSelector(
    (state) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const allowUpdate = useWkSelector((state) => state.annotation.restrictions.allowUpdate);
  const isEditableMappingActive = useWkSelector((state) => hasEditableMapping(state, layerName));
  const isMappingLocked = useWkSelector((state) => isMappingLockedAccessor(state, layerName));
  const isAnnotationLockedByOwner = useWkSelector((state) => state.annotation.isLockedByOwner);
  const isOwner = useWkSelector((state) => isAnnotationOwner(state));

  const ensureMappingsAreLoaded = useCallback(async () => {
    if (!segmentationLayer) {
      return;
    }

    dispatch(ensureLayerMappingsAreLoadedAction(segmentationLayer.name));
  }, [dispatch, segmentationLayer]);

  useEffect(() => {
    if (isMappingEnabled) {
      ensureMappingsAreLoaded();
    }
  }, [isMappingEnabled, ensureMappingsAreLoaded]);

  const handleChangeHideUnmappedSegments = (hideUnmappedIds: boolean) => {
    dispatch(setHideUnmappedIdsAction(layerName, hideUnmappedIds));
  };

  const handleChangeMapping = (packedMappingNameWithCategory: string): void => {
    const [mappingName, mappingType] = unpackMappingNameAndCategory(packedMappingNameWithCategory);

    if (mappingType !== "JSON" && mappingType !== "HDF5") {
      throw new Error("Invalid mapping type");
    }

    dispatch(
      setMappingAction(layerName, mappingName, mappingType, {
        showLoadingIndicator: true,
      }),
    );
    // @ts-ignore
    if (document.activeElement) document.activeElement.blur();
  };

  const handleSetMappingEnabled = (shouldMappingBeEnabled: boolean): void => {
    if (shouldMappingBeEnabled) {
      ensureMappingsAreLoaded();
    }

    setShouldMappingBeEnabled(shouldMappingBeEnabled);

    if (mappingName != null) {
      dispatch(setMappingEnabledAction(layerName, shouldMappingBeEnabled));
    }
  };

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

  // The mapping toggle should be active if either the user clicked on it (shouldMappingBeEnabled)
  // or a mapping was activated, e.g. from the API or by selecting one from the dropdown (isMappingEnabled).
  const isMappingToggleActive = shouldMappingBeEnabled || isMappingEnabled;
  const renderHideUnmappedSegmentsSwitch =
    (isMappingToggleActive || isMergerModeEnabled) &&
    mapping &&
    mappingType === "JSON" &&
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
    <Fragment>
      {
        /* Only display the mapping selection when merger mode is not active
               to avoid conflicts in the logic of the UI. */
        !isMergerModeEnabled ? (
          <Fragment>
            <FastTooltip title={isDisabled ? disabledMessage : null}>
              <div
                style={{
                  marginBottom: 6,
                }}
              >
                <SwitchSetting
                  onChange={handleSetMappingEnabled}
                  value={isMappingToggleActive}
                  label="ID Mapping"
                  // Assume that the mappings are being loaded if they are null
                  loading={isMappingToggleActive && segmentationLayer?.mappings == null}
                  disabled={isDisabled}
                />
              </div>
            </FastTooltip>

            {/*
                Show mapping-select even when the mapping is disabled but the UI was used before
                (i.e., mappingName != null)
                */}
            {isMappingToggleActive ? (
              <Select
                placeholder="Select mapping"
                defaultActiveFirstOption={false}
                style={{
                  width: "100%",
                  marginBottom: 14,
                }}
                {...selectValueProp}
                onChange={handleChangeMapping}
                notFoundContent="No mappings found."
                disabled={isDisabled}
                popupMatchSelectWidth={false}
              >
                {renderCategoryOptions(availableMappings, "JSON")}
                {renderCategoryOptions(availableAgglomerates, "HDF5")}
              </Select>
            ) : null}
          </Fragment>
        ) : null
      }
      {renderHideUnmappedSegmentsSwitch ? (
        <SwitchSetting
          onChange={handleChangeHideUnmappedSegments}
          value={hideUnmappedIds}
          label="Hide unmapped segments"
        />
      ) : null}
    </Fragment>
  );
};

export default MappingSettingsView;
