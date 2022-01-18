// @flow
import React, { useState, type ComponentType } from "react";
import { Popconfirm } from "antd";
import {
  getMeshfileChunksForSegment,
  getMeshfileChunkData,
  getMeshfilesForDatasetLayer,
} from "admin/admin_rest_api";
import type { APIDataset, APIDataLayer, APIMeshFile } from "types/api_flow_types";
import parseStlBuffer from "libs/parse_stl_buffer";
import getSceneController from "oxalis/controller/scene_controller_provider";
import Store, { type ActiveMappingInfo } from "oxalis/store";
import {
  addIsosurfaceAction,
  startedLoadingIsosurfaceAction,
  finishedLoadingIsosurfaceAction,
  removeIsosurfaceAction,
  updateMeshFileListAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import { type Vector3, MappingStatusEnum } from "oxalis/constants";
import Toast from "libs/toast";
import messages from "messages";
import processTaskWithPool from "libs/task_pool";
import { setMappingAction, setMappingEnabledAction } from "oxalis/model/actions/settings_actions";
import { waitForCondition } from "libs/utils";
import { getMappingInfo } from "oxalis/model/accessors/dataset_accessor";

const PARALLEL_MESH_LOADING_COUNT = 6;

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

export async function loadMeshFromFile(
  id: number,
  pos: Vector3,
  fileName: string,
  segmentationLayer: APIDataLayer,
  dataset: APIDataset,
): Promise<void> {
  const layerName = segmentationLayer.name;
  Store.dispatch(addIsosurfaceAction(layerName, id, pos, true));
  Store.dispatch(startedLoadingIsosurfaceAction(layerName, id));

  let availableChunks = null;
  try {
    availableChunks = await getMeshfileChunksForSegment(
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(segmentationLayer),
      fileName,
      id,
    );
  } catch (exception) {
    console.warn("Mesh chunk couldn't be loaded due to", exception);
    Toast.warning(messages["tracing.mesh_listing_failed"]);

    Store.dispatch(finishedLoadingIsosurfaceAction(layerName, id));
    Store.dispatch(removeIsosurfaceAction(layerName, id));
    return;
  }

  const tasks = availableChunks.map(chunkPos => async () => {
    if (Store.getState().localSegmentationData[layerName].isosurfaces[id] == null) {
      // Don't load chunk, since the mesh seems to have been deleted in the meantime (e.g., by the user).
      return;
    }

    const stlData = await getMeshfileChunkData(
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(segmentationLayer),
      fileName,
      id,
      chunkPos,
    );
    if (Store.getState().localSegmentationData[layerName].isosurfaces[id] == null) {
      // Don't add chunks, since the mesh seems to have been deleted in the meantime (e.g., by the user).
      return;
    }
    const geometry = parseStlBuffer(stlData);
    getSceneController().addIsosurfaceFromGeometry(geometry, id);
  });

  try {
    await processTaskWithPool(tasks, PARALLEL_MESH_LOADING_COUNT);
  } catch (exception) {
    Toast.warning("Some mesh objects could not be loaded.");
  }

  if (Store.getState().localSegmentationData[layerName].isosurfaces[id] == null) {
    // The mesh was removed from the store in the meantime. Don't do anything.
    return;
  }

  Store.dispatch(finishedLoadingIsosurfaceAction(layerName, id));
}

type MappingActivationConfirmationProps<R> = {|
  mappingName: ?string,
  descriptor: string,
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
    const {
      mappingName,
      descriptor,
      layerName,
      mappingInfo,
      onClick: originalOnClick,
      ...rest
    } = props;
    const [isConfirmVisible, setConfirmVisible] = useState(false);

    // If the mapping name is undefined, no mapping is specified. In that case never show the activation modal.
    // In contrast, if the mapping name is null, this indicates that all mappings should be specifically disabled.
    if (mappingName === undefined || layerName == null) {
      return <WrappedComponent {...rest} onClick={originalOnClick} />;
    }

    const isMappingEnabled = mappingInfo.mappingStatus === MappingStatusEnum.ENABLED;
    const enabledMappingName = isMappingEnabled ? mappingInfo.mappingName : null;
    const checkWhetherConfirmIsNeeded = () => {
      if (mappingName !== enabledMappingName) {
        setConfirmVisible(true);
      } else {
        originalOnClick();
      }
    };

    const mappingString =
      mappingName != null
        ? `for the mapping "${mappingName}" which is not active. The mapping will be activated`
        : "without a mapping but a mapping is active. The mapping will be deactivated";

    return (
      <Popconfirm
        title={`The currently active ${descriptor} was computed ${mappingString} when clicking OK.`}
        overlayStyle={{ maxWidth: 500 }}
        visible={isConfirmVisible}
        onConfirm={async () => {
          setConfirmVisible(false);
          if (mappingName != null) {
            Store.dispatch(setMappingAction(layerName, mappingName, "HDF5"));
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
