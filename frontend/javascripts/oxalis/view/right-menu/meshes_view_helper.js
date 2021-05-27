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
  updateMeshFileListAction,
  updateCurrentMeshFileAction,
} from "oxalis/model/actions/annotation_actions";
import type { Vector3 } from "oxalis/constants";

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
  const availableChunks = await getMeshfileChunksForSegment(
    dataset.dataStore.url,
    dataset,
    layerName,
    fileName,
    id,
  );
  for (const chunkPos of availableChunks) {
    // eslint-disable-next-line no-await-in-loop
    const stlData = await getMeshfileChunkData(
      dataset.dataStore.url,
      dataset,
      layerName,
      fileName,
      id,
      chunkPos,
    );
    const geometry = parseStlBuffer(stlData);
    getSceneController().addIsosurfaceFromGeometry(geometry, id);
  }
  Store.dispatch(finishedLoadingIsosurfaceAction(id));
}
