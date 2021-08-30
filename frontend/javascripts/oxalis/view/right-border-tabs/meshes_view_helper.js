// @flow
import {
  getMeshfileChunksForSegment,
  getMeshfileChunkData,
  getMeshfilesForDatasetLayer,
} from "admin/admin_rest_api";
import type { APIDataset, APIDataLayer } from "types/api_flow_types";
import parseStlBuffer from "libs/parse_stl_buffer";
import getSceneController from "oxalis/controller/scene_controller_provider";
import Store from "oxalis/store";
import {
  addIsosurfaceAction,
  startedLoadingIsosurfaceAction,
  finishedLoadingIsosurfaceAction,
  removeIsosurfaceAction,
  updateMeshFileListAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import type { Vector3 } from "oxalis/constants";
import Toast from "libs/toast";
import messages from "messages";
import processTaskWithPool from "libs/task_pool";

const PARALLEL_MESH_LOADING_COUNT = 6;

function getBaseLayerName(segmentationLayer: APIDataLayer) {
  return segmentationLayer.fallbackLayer || segmentationLayer.name;
}

export async function maybeFetchMeshFiles(
  segmentationLayer: ?APIDataLayer,
  dataset: APIDataset,
  mustRequest: boolean,
  autoActivate: boolean = true,
): Promise<Array<string>> {
  if (!segmentationLayer) {
    return [];
  }
  const layerName = segmentationLayer.name;
  const files = Store.getState().availableMeshFilesByLayer[layerName];

  // only send new get request, if it hasn't happened before (files in store are null)
  // else return the stored files (might be empty array). Or if we force a reload.
  if (!files || mustRequest) {
    const availableMeshFiles = await getMeshfilesForDatasetLayer(
      dataset.dataStore.url,
      dataset,
      getBaseLayerName(segmentationLayer),
    );
    Store.dispatch(updateMeshFileListAction(layerName, availableMeshFiles));
    if (
      !Store.getState().currentMeshFileByLayer[layerName] &&
      availableMeshFiles.length > 0 &&
      autoActivate
    ) {
      Store.dispatch(updateCurrentMeshFileAction(layerName, availableMeshFiles[0]));
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
      getBaseLayerName(segmentationLayer),
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
    if (Store.getState().isosurfacesByLayer[layerName][id] == null) {
      // Don't load chunk, since the mesh seems to have been deleted in the meantime (e.g., by the user).
      return;
    }

    const stlData = await getMeshfileChunkData(
      dataset.dataStore.url,
      dataset,
      layerName,
      fileName,
      id,
      chunkPos,
    );
    if (Store.getState().isosurfacesByLayer[layerName][id] == null) {
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

  if (Store.getState().isosurfacesByLayer[layerName][id] == null) {
    // The mesh was removed from the store in the mean time. Don't do anything.
    return;
  }

  Store.dispatch(finishedLoadingIsosurfaceAction(layerName, id));
}
