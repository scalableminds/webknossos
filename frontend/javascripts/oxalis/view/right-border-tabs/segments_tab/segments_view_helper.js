// @flow
import React, { useState, type ComponentType } from "react";
import { Popconfirm } from "antd";
import { getMeshfilesForDatasetLayer } from "admin/admin_rest_api";
import type { APIDataset, APIDataLayer, APIMeshFile } from "types/api_flow_types";
import Store, { type ActiveMappingInfo } from "oxalis/store";
import {
  updateMeshFileListAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import { MappingStatusEnum } from "oxalis/constants";
import { setMappingAction, setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import { waitForCondition } from "libs/utils";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";

export function getBaseSegmentationName(segmentationLayer: APIDataLayer) {
  return segmentationLayer.fallbackLayer || segmentationLayer.name;
}

export async function maybeFetchMeshFiles(
  segmentationLayer: ?APIDataLayer,
  dataset: APIDataset,
  mustRequest: boolean,
  autoActivate: boolean = true,
): Promise<Array<APIMeshFile>> {
  if (!segmentationLayer) {
    return [];
  }
  const layerName = segmentationLayer.name;
  const files = Store.getState().localSegmentationData[layerName].availableMeshFiles;

  // Only send new get request, if it hasn't happened before (files in store are null)
  // else return the stored files (might be empty array). Or if we force a reload.
  if (!files || mustRequest) {
    const availableMeshFiles = await getMeshfilesForDatasetLayer(
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(segmentationLayer),
    );
    Store.dispatch(updateMeshFileListAction(layerName, availableMeshFiles));
    if (
      !Store.getState().localSegmentationData[layerName].currentMeshFile &&
      availableMeshFiles.length > 0 &&
      autoActivate
    ) {
      Store.dispatch(updateCurrentMeshFileAction(layerName, availableMeshFiles[0].meshFileName));
    }
    return availableMeshFiles;
  }
  return files;
}

type MappingActivationConfirmationProps<R> = {|
  currentMeshFile: ?APIMeshFile,
  layerName: ?string,
  mappingInfo: ActiveMappingInfo,
  onClick: Function,
  ...R,
|};

export function withMappingActivationConfirmation<P, C: ComponentType<P>>(
  WrappedComponent: C,
): ComponentType<MappingActivationConfirmationProps<P>> {
  return function ComponentWithMappingActivationConfirmation(
    props: MappingActivationConfirmationProps<P>,
  ) {
    const { currentMeshFile, layerName, mappingInfo, onClick: originalOnClick, ...rest } = props;
    const [isConfirmVisible, setConfirmVisible] = useState(false);

    // If the mesh file mapping name is undefined, the mesh file doesn't contain that information
    // because it is too old. In that case never show the activation modal.
    if (currentMeshFile == null || currentMeshFile.mappingName === undefined || layerName == null) {
      return <WrappedComponent {...rest} onClick={originalOnClick} />;
    }

    const isMappingEnabled = mappingInfo.mappingStatus === MappingStatusEnum.ENABLED;
    const enabledMappingName = isMappingEnabled ? mappingInfo.mappingName : null;
    const checkWhetherConfirmIsNeeded = () => {
      if (currentMeshFile.mappingName !== enabledMappingName) {
        setConfirmVisible(true);
      } else {
        originalOnClick();
      }
    };

    const mappingString =
      currentMeshFile.mappingName != null
        ? `for the mapping "${
            currentMeshFile.mappingName
          }" which is not active. The mapping will be activated`
        : "without a mapping but a mapping is active. The mapping will be deactivated";

    return (
      <Popconfirm
        title={`The currently active mesh file "${
          currentMeshFile.meshFileName
        }" was computed ${mappingString} when clicking OK.`}
        overlayStyle={{ maxWidth: 500 }}
        visible={isConfirmVisible}
        onConfirm={async () => {
          setConfirmVisible(false);
          if (currentMeshFile.mappingName != null) {
            Store.dispatch(setMappingAction(layerName, currentMeshFile.mappingName, "HDF5"));
            await waitForCondition(
              () =>
                getMappingInfo(
                  Store.getState().temporaryConfiguration.activeMappingByLayer,
                  layerName,
                ).mappingStatus === MappingStatusEnum.ENABLED,
              100,
            );
          } else {
            Store.dispatch(setMappingEnabledAction(layerName, false));
            await waitForCondition(
              () =>
                getMappingInfo(
                  Store.getState().temporaryConfiguration.activeMappingByLayer,
                  layerName,
                ).mappingStatus === MappingStatusEnum.DISABLED,
              100,
            );
          }
          originalOnClick();
        }}
        onCancel={() => setConfirmVisible(false)}
      >
        <WrappedComponent {...rest} onClick={checkWhetherConfirmIsNeeded} />
      </Popconfirm>
    );
  };
}
