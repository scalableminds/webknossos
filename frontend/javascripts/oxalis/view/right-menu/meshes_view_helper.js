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

const PARALLEL_MESH_LOADING_COUNT = 6;

export async function maybeFetchMeshFiles(
  segmentationLayer: APIDataLayer,
  dataset: APIDataset,
  mustRequest: boolean,
): Promise<void> {
  const files = Store.getState().availableMeshFiles;

  // only send new get request, if it hasn't happened before (files in store are null)
  // else return the stored files (might be empty array). Or if we force a reload.
  if (!files || mustRequest) {
    const layerName = segmentationLayer.fallbackLayer || segmentationLayer.name;
    const availableMeshFiles = await getMeshfilesForDatasetLayer(
      dataset.dataStore.url,
      dataset,
      layerName,
    );
    Store.dispatch(updateMeshFileListAction(availableMeshFiles));
    if (!Store.getState().currentMeshFile && availableMeshFiles.length > 0) {
      Store.dispatch(updateCurrentMeshFileAction(availableMeshFiles[0]));
    }
  }
}

export async function loadMeshFromFile(
  id: number,
  pos: Vector3,
  fileName: string,
  segmentationLayer: APIDataLayer,
  dataset: APIDataset,
): Promise<void> {
  Store.dispatch(addIsosurfaceAction(id, pos, true));
  Store.dispatch(startedLoadingIsosurfaceAction(id));

  const layerName = segmentationLayer.fallbackLayer || segmentationLayer.name;
  let availableChunks = null;
  try {
    availableChunks = await getMeshfileChunksForSegment(
      dataset.dataStore.url,
      dataset,
      layerName,
      fileName,
      id,
    );
  } catch (exception) {
    console.warn("Mesh chunk couldn't be loaded due to", exception);
    Toast.warning(messages["tracing.mesh_listing_failed"]);

    Store.dispatch(finishedLoadingIsosurfaceAction(id));
    Store.dispatch(removeIsosurfaceAction(id));
    return;
  }

  const tasks = availableChunks.map(chunkPos => async () => {
    if (Store.getState().isosurfaces[id] == null) {
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
    if (Store.getState().isosurfaces[id] == null) {
      // Don't add chunks, since the mesh seems to have been deleted in the meantime (e.g., by the user).
      return;
    }
    const geometry = parseStlBuffer(stlData);
    getSceneController().addIsosurfaceFromGeometry(geometry, id);
  });

  await processTaskWithPool(tasks, PARALLEL_MESH_LOADING_COUNT);

  Store.dispatch(finishedLoadingIsosurfaceAction(id));
}

function processTaskWithPool(tasks, poolSize) {
  return new Promise((resolve, reject) => {
    const promises = [];
    let isFinalResolveScheduled = false;

    const startNextTask = () => {
      if (tasks.length === 0) {
        if (!isFinalResolveScheduled) {
          isFinalResolveScheduled = true;

          // All tasks were kicked off, which is why all promises can be
          // awaited now together.
          Promise.all(promises).then(resolve, reject);
        }
        return;
      }

      const task = tasks.shift();
      const newPromise = task();
      promises.push(newPromise);

      // If that promise is done, process a new one (that way,
      // the pool size stays constant until the queue is almost empty.)
      newPromise.then(startNextTask);
    };

    for (let i = 0; i < poolSize; i++) {
      startNextTask();
    }
  });
}
