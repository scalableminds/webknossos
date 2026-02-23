import { Select, type SelectProps } from "antd";
import FastTooltip from "components/fast_tooltip";
import { localeCompareBy } from "libs/utils";
import messages from "messages";
import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useDispatch, useSelector } from "react-redux";
import { MappingStatusEnum } from "viewer/constants";
import { isAnnotationOwner } from "viewer/model/accessors/annotation_accessor";
import {
  getMappingInfo,
  getSegmentationLayerByName,
} from "viewer/model/accessors/dataset_accessor";
import {
  getEditableMappingForVolumeTracingId,
  hasEditableMapping,
  isMappingLocked,
} from "viewer/model/accessors/volumetracing_accessor";
import { ensureLayerMappingsAreLoadedAction } from "viewer/model/actions/dataset_actions";
import {
  setHideUnmappedIdsAction,
  setMappingAction,
  setMappingEnabledAction,
} from "viewer/model/actions/settings_actions";
import type { MappingType, WebknossosState } from "viewer/store";
import { SwitchSetting } from "viewer/view/components/setting_input_views";

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

function MappingSettingsView({ layerName }: Props) {
  const dispatch = useDispatch();
  // shouldMappingBeEnabled is the UI state which is directly connected to the
  // toggle button. The actual mapping in the store is only activated when
  // the user selects a mapping from the dropdown (which is only possible after
  // using the toggle). This is why, there is this.state.shouldMappingBeEnabled and
  // isMappingEnabled derived from the store.
  const [shouldMappingBeEnabled, setShouldMappingBeEnabled] = useState(false);

  const activeMappingInfo = useSelector((state: WebknossosState) =>
    getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
  );
  const segmentationLayer = useSelector((state: WebknossosState) =>
    getSegmentationLayerByName(state.dataset, layerName),
  );
  const editableMapping = useSelector((state: WebknossosState) =>
    getEditableMappingForVolumeTracingId(state, segmentationLayer.tracingId),
  );
  const isMergerModeEnabled = useSelector(
    (state: WebknossosState) => state.temporaryConfiguration.isMergerModeEnabled,
  );
  const allowUpdate = useSelector(
    (state: WebknossosState) => state.annotation.isUpdatingCurrentlyAllowed,
  );
  const isEditableMappingActive = useSelector((state: WebknossosState) =>
    hasEditableMapping(state, layerName),
  );
  const isMappingLockedState = useSelector((state: WebknossosState) =>
    isMappingLocked(state, layerName),
  );
  const isAnnotationLockedByOwner = useSelector(
    (state: WebknossosState) => state.annotation.isLockedByOwner,
  );
  const isOwner = useSelector((state: WebknossosState) => isAnnotationOwner(state));

  const { hideUnmappedIds, mappingStatus, mapping, mappingName, mappingType } = activeMappingInfo;
  const isMappingEnabled = mappingStatus === MappingStatusEnum.ENABLED;

  const ensureMappingsAreLoaded = useCallback(() => {
    if (segmentationLayer) {
      dispatch(ensureLayerMappingsAreLoadedAction(segmentationLayer.name));
    }
  }, [dispatch, segmentationLayer]);

  useEffect(() => {
    if (isMappingEnabled) {
      ensureMappingsAreLoaded();
    }
  }, [isMappingEnabled, ensureMappingsAreLoaded]);

  const handleChangeHideUnmappedSegments = useCallback(
    (hideUnmapped: boolean) => {
      dispatch(setHideUnmappedIdsAction(layerName, hideUnmapped));
    },
    [dispatch, layerName],
  );

  const handleChangeMapping = useCallback(
    (packedMappingNameWithCategory: string): void => {
      const [mappingName, mappingType] = unpackMappingNameAndCategory(
        packedMappingNameWithCategory,
      );

      if (mappingType !== "JSON" && mappingType !== "HDF5") {
        throw new Error("Invalid mapping type");
      }

      dispatch(
        setMappingAction(layerName, mappingName, mappingType, false, {
          showLoadingIndicator: true,
        }),
      );

      // @ts-expect-error
      if (document.activeElement) document.activeElement.blur();
    },
    [dispatch, layerName],
  );

  const handleSetMappingEnabled = useCallback(
    (newShouldMappingBeEnabled: boolean): void => {
      if (newShouldMappingBeEnabled) {
        ensureMappingsAreLoaded();
      }
      setShouldMappingBeEnabled(newShouldMappingBeEnabled);
      if (mappingName != null) {
        dispatch(setMappingEnabledAction(layerName, newShouldMappingBeEnabled));
      }
    },
    [dispatch, ensureMappingsAreLoaded, layerName, mappingName],
  );

  const availableMappings = useMemo(
    () => segmentationLayer?.mappings ?? [],
    [segmentationLayer?.mappings],
  );
  const availableAgglomerates = useMemo(
    () => segmentationLayer?.agglomerates ?? [],
    [segmentationLayer?.agglomerates],
  );

  // Show mapping-select even when the mapping is disabled but the UI was used before
  // (i.e., mappingName != null)
  const isMappingActive = shouldMappingBeEnabled || isMappingEnabled;

  const selectValueProp = useMemo(
    () =>
      mappingName != null
        ? {
            value:
              editableMapping != null
                ? `${editableMapping.baseMappingName} (${mappingName})`
                : mappingName,
          }
        : {},
    [mappingName, editableMapping],
  );

  const isDisabled = useMemo(
    () => isEditableMappingActive || isMappingLockedState || isAnnotationLockedByOwner,
    [isEditableMappingActive, isMappingLockedState, isAnnotationLockedByOwner],
  );

  const disabledMessage = useMemo(() => {
    if (!allowUpdate) {
      return messages["tracing.read_only_mode_notification"](isAnnotationLockedByOwner, isOwner);
    }
    if (isEditableMappingActive) {
      return "The mapping has been edited through proofreading actions and can no longer be disabled or changed.";
    }
    if (isMappingEnabled) {
      return "This mapping has been locked to this annotation, because the segmentation was modified while it was active. It can no longer be disabled or changed.";
    }
    return "The segmentation was modified while no mapping was active. To ensure a consistent state, mappings can no longer be enabled.";
  }, [allowUpdate, isAnnotationLockedByOwner, isOwner, isEditableMappingActive, isMappingEnabled]);

  const selectOptions: SelectProps["options"] = useMemo(() => {
    const useGroups = availableMappings.length > 0 && availableAgglomerates.length > 0;

    const toOption = (optionString: string, category: MappingType) => ({
      key: packMappingNameAndCategory(optionString, category),
      value: packMappingNameAndCategory(optionString, category),
      title: optionString,
      label: optionString,
    });

    const mappingOptions = availableMappings
      .slice()
      .sort(localeCompareBy((s) => s))
      .map((s) => toOption(s, "JSON"));

    const agglomerateOptions = availableAgglomerates
      .slice()
      .sort(localeCompareBy((s) => s))
      .map((s) => toOption(s, "HDF5"));

    if (useGroups) {
      return [
        { label: "JSON", options: mappingOptions },
        { label: "HDF5", options: agglomerateOptions },
      ];
    }

    return [...mappingOptions, ...agglomerateOptions];
  }, [availableMappings, availableAgglomerates]);

  const renderHideUnmappedSegmentsSwitch =
    (isMappingActive || isMergerModeEnabled) &&
    mapping &&
    mappingType === "JSON" &&
    hideUnmappedIds != null;

  return (
    <React.Fragment>
      {!isMergerModeEnabled ? (
        <React.Fragment>
          <FastTooltip title={isDisabled ? disabledMessage : null}>
            <div style={{ marginBottom: 6 }}>
              <SwitchSetting
                onChange={handleSetMappingEnabled}
                value={isMappingActive}
                label="ID Mapping"
                loading={isMappingActive && segmentationLayer?.mappings == null}
                disabled={isDisabled}
              />
            </div>
          </FastTooltip>

          {isMappingActive ? (
            <Select
              placeholder="Select mapping"
              defaultActiveFirstOption={false}
              style={{ width: "100%", marginBottom: 14 }}
              {...selectValueProp}
              onChange={handleChangeMapping}
              notFoundContent="No mappings found."
              disabled={isDisabled}
              popupMatchSelectWidth={false}
              options={selectOptions}
            />
          ) : null}
        </React.Fragment>
      ) : null}

      {renderHideUnmappedSegmentsSwitch ? (
        <SwitchSetting
          onChange={handleChangeHideUnmappedSegments}
          value={hideUnmappedIds}
          label="Hide unmapped segments"
          loading={false}
        />
      ) : null}
    </React.Fragment>
  );
}

export default MappingSettingsView;
