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
import Model from "oxalis/model";
import api from "oxalis/api/internal_api";

const PARALLEL_MESH_LOADING_COUNT = 6;

export async function maybeFetchMeshFiles(
  segmentationLayer: ?APIDataLayer,
  dataset: APIDataset,
  mustRequest: boolean,
): Promise<void> {
  if (!segmentationLayer) {
    return;
  }
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

export function getIdForPosition(pos: Vector3) {
  const layer = Model.getSegmentationLayer();
  if (!layer) {
    throw new Error("No segmentation layer found");
  }
  const segmentationCube = layer.cube;
  const segmentationLayerName = layer.name;

  if (!segmentationLayerName) {
    return 0;
  }

  const renderedZoomStepForCameraPosition = api.data.getRenderedZoomStepAtPosition(
    segmentationLayerName,
    pos,
  );
  return segmentationCube.getDataValue(pos, null, renderedZoomStepForCameraPosition);
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

  try {
    await processTaskWithPool(tasks, PARALLEL_MESH_LOADING_COUNT);
  } catch (exception) {
    Toast.warning("Some mesh objects could not be loaded.");
  }

  if (Store.getState().isosurfaces[id] == null) {
    // The mesh was removed from the store in the mean time. Don't do anything.
    return;
  }

  Store.dispatch(finishedLoadingIsosurfaceAction(id));
}
