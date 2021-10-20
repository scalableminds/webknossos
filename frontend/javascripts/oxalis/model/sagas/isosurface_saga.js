// @flow
import { saveAs } from "file-saver";

import { sleep } from "libs/utils";
import ErrorHandling from "libs/error_handling";
import type { APIDataset } from "types/api_flow_types";
import {
  ResolutionInfo,
  getResolutionInfo,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  changeActiveIsosurfaceCellAction,
  type ChangeActiveIsosurfaceCellAction,
} from "oxalis/model/actions/segmentation_actions";
import { type Vector3 } from "oxalis/constants";
import { type FlycamAction, FlycamActions } from "oxalis/model/actions/flycam_actions";
import {
  removeIsosurfaceAction,
  addIsosurfaceAction,
  finishedRefreshingIsosurfacesAction,
  finishedLoadingIsosurfaceAction,
  startedLoadingIsosurfaceAction,
  type ImportIsosurfaceFromStlAction,
  type UpdateIsosurfaceVisibilityAction,
  type RemoveIsosurfaceAction,
  type RefreshIsosurfaceAction,
  type TriggerIsosurfaceDownloadAction,
} from "oxalis/model/actions/annotation_actions";
import {
  type Saga,
  _takeEvery,
  call,
  put,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import { stlIsosurfaceConstants } from "oxalis/view/right-border-tabs/meshes_view";
import { computeIsosurface, sendAnalyticsEvent } from "admin/admin_rest_api";
import { getFlooredPosition } from "oxalis/model/accessors/flycam_accessor";
import { setImportingMeshStateAction } from "oxalis/model/actions/ui_actions";
import { zoomedAddressToAnotherZoomStepWithInfo } from "oxalis/model/helpers/position_converter";
import DataLayer from "oxalis/model/data_layer";
import Model from "oxalis/model";
import ThreeDMap from "libs/ThreeDMap";
import * as Utils from "libs/utils";
import exportToStl from "libs/stl_exporter";
import getSceneController from "oxalis/controller/scene_controller_provider";
import parseStlBuffer from "libs/parse_stl_buffer";
import window from "libs/window";
import { enforceVolumeTracing } from "oxalis/model/accessors/volumetracing_accessor";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import Toast from "libs/toast";
import messages from "messages";

const MAX_RETRY_COUNT = 5;
const RETRY_WAIT_TIME = 5000;

const isosurfacesMapByLayer: { [layerName: string]: Map<number, ThreeDMap<boolean>> } = {};
const cubeSize = [256, 256, 256];
const modifiedCells: Set<number> = new Set();

export function isIsosurfaceStl(buffer: ArrayBuffer): boolean {
  const dataView = new DataView(buffer);
  const isIsosurface = stlIsosurfaceConstants.isosurfaceMarker.every(
    (marker, index) => dataView.getUint8(index) === marker,
  );
  return isIsosurface;
}

function getMapForSegment(layerName: string, segmentId: number): ThreeDMap<boolean> {
  isosurfacesMapByLayer[layerName] = isosurfacesMapByLayer[layerName] || new Map();
  const isosurfacesMap = isosurfacesMapByLayer[layerName];

  const maybeMap = isosurfacesMap.get(segmentId);
  if (maybeMap == null) {
    const newMap = new ThreeDMap();
    isosurfacesMap.set(segmentId, newMap);
    return newMap;
  }
  return maybeMap;
}

function removeMapForSegment(layerName: string, segmentId: number): void {
  if (isosurfacesMapByLayer[layerName] == null) {
    return;
  }
  isosurfacesMapByLayer[layerName].delete(segmentId);
}

function getZoomedCubeSize(zoomStep: number, resolutionInfo: ResolutionInfo): Vector3 {
  const [x, y, z] = zoomedAddressToAnotherZoomStepWithInfo(
    [...cubeSize, 0],
    resolutionInfo,
    zoomStep,
  );
  // Drop the last element of the Vector4;
  return [x, y, z];
}

function clipPositionToCubeBoundary(
  position: Vector3,
  zoomStep: number,
  resolutionInfo: ResolutionInfo,
): Vector3 {
  const zoomedCubeSize = getZoomedCubeSize(zoomStep, resolutionInfo);
  const currentCube = Utils.map3((el, idx) => Math.floor(el / zoomedCubeSize[idx]), position);
  const clippedPosition = Utils.map3((el, idx) => el * zoomedCubeSize[idx], currentCube);
  return clippedPosition;
}

function getNeighborPosition(
  clippedPosition: Vector3,
  neighborId: number,
  zoomStep: number,
  resolutionInfo: ResolutionInfo,
): Vector3 {
  // front_xy, front_xz, front_yz, back_xy, back_xz, back_yz
  const neighborLookup = [[0, 0, -1], [0, -1, 0], [-1, 0, 0], [0, 0, 1], [0, 1, 0], [1, 0, 0]];

  const zoomedCubeSize = getZoomedCubeSize(zoomStep, resolutionInfo);
  const neighborMultiplier = neighborLookup[neighborId];
  const neighboringPosition = [
    clippedPosition[0] + neighborMultiplier[0] * zoomedCubeSize[0],
    clippedPosition[1] + neighborMultiplier[1] * zoomedCubeSize[1],
    clippedPosition[2] + neighborMultiplier[2] * zoomedCubeSize[2],
  ];
  return neighboringPosition;
}

// Since isosurface rendering is only supported in view mode right now
// (active cell id is only defined in volume annotations, mapping support
// for datasets is limited in volume tracings etc.), we use another state
// variable for the "active cell" in view mode. The cell can be changed via
// shift + click on the isosurface, by clicking on its list entry in the
// meshes tab or by clicking on the "load isosurface for centered cell" button.
let currentViewIsosurfaceCellId = 0;
// The calculation of an isosurface is spread across multiple requests.
// In order to avoid, that too many chunks are computed for one user interaction,
// we store the amount of requests in a batch per segment.
const batchCounterPerSegment: { [key: number]: number } = {};
const MAXIMUM_BATCH_SIZE = 50;

function* changeActiveIsosurfaceCell(action: ChangeActiveIsosurfaceCellAction): Saga<void> {
  currentViewIsosurfaceCellId = action.cellId;
  if (action.shouldReload) {
    yield* call(ensureSuitableIsosurface, null, action.seedPosition, currentViewIsosurfaceCellId);
  }
}

// This function either returns the activeCellId of the current volume tracing
// or the view-only active cell id
function* getCurrentCellId(): Saga<number> {
  const volumeTracing = yield* select(state => state.tracing.volume);
  if (volumeTracing != null) {
    return volumeTracing.activeCellId;
  }

  return currentViewIsosurfaceCellId;
}

function* ensureSuitableIsosurface(
  maybeFlycamAction: ?FlycamAction,
  seedPosition?: Vector3,
  cellId?: number,
  removeExistingIsosurface: boolean = false,
): Saga<void> {
  const segmentId = cellId != null ? cellId : currentViewIsosurfaceCellId;
  const layer = Model.getVisibleSegmentationLayer();
  if (!layer) {
    return;
  }

  // we need this so precomputed meshes don't get reloaded when the flycam gets moved to their position
  if (maybeFlycamAction && !maybeFlycamAction.shouldRefreshIsosurface) {
    return;
  }
  if (segmentId === 0 || layer == null) {
    return;
  }
  yield* call(loadIsosurfaceForSegmentId, segmentId, seedPosition, removeExistingIsosurface);
}

function* getInfoForIsosurfaceLoading(
  layer: DataLayer,
): Saga<{
  dataset: APIDataset,
  zoomStep: number,
  resolutionInfo: ResolutionInfo,
}> {
  const dataset = yield* select(state => state.dataset);
  const resolutionInfo = getResolutionInfo(layer.resolutions);

  const preferredZoomStep = window.__isosurfaceZoomStep != null ? window.__isosurfaceZoomStep : 1;
  const zoomStep = resolutionInfo.getClosestExistingIndex(preferredZoomStep);
  return { dataset, layer, zoomStep, resolutionInfo };
}

function* loadIsosurfaceForSegmentId(
  segmentId: number,
  seedPosition: ?Vector3,
  removeExistingIsosurface: boolean = false,
): Saga<void> {
  const layer = Model.getVisibleSegmentationLayer();
  if (!layer) {
    return;
  }
  const { dataset, zoomStep, resolutionInfo } = yield* call(getInfoForIsosurfaceLoading, layer);

  batchCounterPerSegment[segmentId] = 0;
  yield* call(
    loadIsosurfaceWithNeighbors,
    dataset,
    layer,
    segmentId,
    seedPosition,
    zoomStep,
    resolutionInfo,
    removeExistingIsosurface,
  );
}

function* loadIsosurfaceWithNeighbors(
  dataset: APIDataset,
  layer: DataLayer,
  segmentId: number,
  seedPosition: ?Vector3,
  zoomStep: number,
  resolutionInfo: ResolutionInfo,
  removeExistingIsosurface: boolean,
): Saga<void> {
  let isInitialRequest = true;
  const position =
    seedPosition != null ? seedPosition : yield* select(state => getFlooredPosition(state.flycam));
  const clippedPosition = clipPositionToCubeBoundary(position, zoomStep, resolutionInfo);
  let positionsToRequest = [clippedPosition];

  const hasIsosurface = yield* select(
    state =>
      state.isosurfacesByLayer[layer.name] != null &&
      state.isosurfacesByLayer[layer.name][segmentId] != null,
  );
  if (!hasIsosurface) {
    yield* put(addIsosurfaceAction(layer.name, segmentId, position, false));
  }
  yield* put(startedLoadingIsosurfaceAction(layer.name, segmentId));

  while (positionsToRequest.length > 0) {
    const currentPosition = positionsToRequest.shift();
    const neighbors = yield* call(
      maybeLoadIsosurface,
      dataset,
      layer,
      segmentId,
      currentPosition,
      zoomStep,
      resolutionInfo,
      isInitialRequest,
      removeExistingIsosurface && isInitialRequest,
    );
    isInitialRequest = false;
    positionsToRequest = positionsToRequest.concat(neighbors);
  }

  yield* put(finishedLoadingIsosurfaceAction(layer.name, segmentId));
}

function hasBatchCounterExceededLimit(segmentId: number): boolean {
  return (
    batchCounterPerSegment[segmentId] > (window.__isosurfaceMaxBatchSize || MAXIMUM_BATCH_SIZE)
  );
}

function* maybeLoadIsosurface(
  dataset: APIDataset,
  layer: DataLayer,
  segmentId: number,
  clippedPosition: Vector3,
  zoomStep: number,
  resolutionInfo: ResolutionInfo,
  isInitialRequest: boolean,
  removeExistingIsosurface: boolean,
): Saga<Array<Vector3>> {
  const threeDMap = getMapForSegment(layer.name, segmentId);

  if (threeDMap.get(clippedPosition)) {
    return [];
  }
  if (hasBatchCounterExceededLimit(segmentId)) {
    return [];
  }
  batchCounterPerSegment[segmentId]++;

  threeDMap.set(clippedPosition, true);

  const voxelDimensions = window.__isosurfaceVoxelDimensions || [4, 4, 4];
  const scale = yield* select(state => state.dataset.dataSource.scale);
  const dataStoreHost = yield* select(state => state.dataset.dataStore.url);
  const tracingStoreHost = yield* select(state => state.tracing.tracingStore.url);
  const activeMappingByLayer = yield* select(
    state => state.temporaryConfiguration.activeMappingByLayer,
  );

  const dataStoreUrl = `${dataStoreHost}/data/datasets/${dataset.owningOrganization}/${
    dataset.name
  }/layers/${layer.fallbackLayer != null ? layer.fallbackLayer : layer.name}`;
  const tracingStoreUrl = `${tracingStoreHost}/tracings/volume/${layer.name}`;

  const volumeTracing = yield* select(state => state.tracing.volume);
  // Fetch from datastore if no volumetracing exists or if the tracing has a fallback layer.
  const useDataStore = volumeTracing == null || volumeTracing.fallbackLayer != null;
  const mappingInfo = getMappingInfo(activeMappingByLayer, layer.name);

  if (isInitialRequest) {
    sendAnalyticsEvent("request_isosurface", { mode: useDataStore ? "view" : "annotation" });
  }

  let retryCount = 0;
  while (retryCount < MAX_RETRY_COUNT) {
    try {
      const { buffer: responseBuffer, neighbors } = yield* call(
        computeIsosurface,
        useDataStore ? dataStoreUrl : tracingStoreUrl,
        mappingInfo,
        {
          position: clippedPosition,
          zoomStep,
          segmentId,
          voxelDimensions,
          cubeSize,
          scale,
        },
      );

      // Check again whether the limit was exceeded, since this variable could have been
      // set in the mean time by ctrl-clicking the segment to remove it
      if (hasBatchCounterExceededLimit(segmentId)) {
        return [];
      }
      const vertices = new Float32Array(responseBuffer);
      if (removeExistingIsosurface) {
        getSceneController().removeIsosurfaceById(segmentId);
      }
      getSceneController().addIsosurfaceFromVertices(vertices, segmentId);

      return neighbors.map(neighbor =>
        getNeighborPosition(clippedPosition, neighbor, zoomStep, resolutionInfo),
      );
    } catch (exception) {
      retryCount++;
      ErrorHandling.notify(exception);
      console.warn("Retrying mesh generation...");
      yield* call(sleep, RETRY_WAIT_TIME * 2 ** retryCount);
    }
  }
  return [];
}

function* downloadIsosurfaceCellById(cellId: number): Saga<void> {
  const sceneController = getSceneController();
  const geometry = sceneController.getIsosurfaceGeometry(cellId);
  if (geometry == null) {
    const errorMessage = messages["tracing.not_isosurface_available_to_download"];
    Toast.error(errorMessage, { sticky: false });
    return;
  }
  const stl = exportToStl(geometry);

  // Encode isosurface and cell id property
  const { isosurfaceMarker, cellIdIndex } = stlIsosurfaceConstants;
  isosurfaceMarker.forEach((marker, index) => {
    stl.setUint8(index, marker);
  });
  stl.setUint32(cellIdIndex, cellId, true);

  const blob = new Blob([stl]);
  yield* call(saveAs, blob, `mesh-${cellId}.stl`);
}

function* downloadIsosurfaceCell(action: TriggerIsosurfaceDownloadAction): Saga<void> {
  yield* call(downloadIsosurfaceCellById, action.cellId);
}

function* downloadActiveIsosurfaceCell(): Saga<void> {
  const currentId = yield* call(getCurrentCellId);
  yield* call(downloadIsosurfaceCellById, currentId);
}

function* importIsosurfaceFromStl(action: ImportIsosurfaceFromStlAction): Saga<void> {
  const { layerName, buffer } = action;
  const dataView = new DataView(buffer);
  const segmentId = dataView.getUint32(stlIsosurfaceConstants.cellIdIndex, true);
  const geometry = yield* call(parseStlBuffer, buffer);
  getSceneController().addIsosurfaceFromGeometry(geometry, segmentId);
  yield* put(setImportingMeshStateAction(false));

  // TODO: Ideally, persist the seed position in the STL file. As a workaround,
  // we simply use the current position as a seed position.
  const seedPosition = yield* select(state => getFlooredPosition(state.flycam));
  yield* put(addIsosurfaceAction(layerName, segmentId, seedPosition, true));
}

function* removeIsosurface(
  action: RemoveIsosurfaceAction,
  removeFromScene: boolean = true,
): Saga<void> {
  const { layerName, cellId } = action;
  if (removeFromScene) {
    getSceneController().removeIsosurfaceById(cellId);
  }
  removeMapForSegment(layerName, cellId);

  // Set batch counter to maximum so that potentially running requests are aborted
  batchCounterPerSegment[cellId] = 1 + (window.__isosurfaceMaxBatchSize || MAXIMUM_BATCH_SIZE);

  const currentCellId = yield* call(getCurrentCellId);
  if (cellId === currentCellId) {
    // Clear the active cell id to avoid that the isosurface is immediately reconstructed
    // when the position changes.
    yield* put(changeActiveIsosurfaceCellAction(0, [0, 0, 0], false));
  }
}

function* markEditedCellAsDirty(): Saga<void> {
  const volumeTracing = yield* select(state => state.tracing.volume);
  const useTracingStore = volumeTracing != null && volumeTracing.fallbackLayer == null;
  if (useTracingStore) {
    const activeCellId = yield* select(state => enforceVolumeTracing(state.tracing).activeCellId);
    modifiedCells.add(activeCellId);
  }
}

function* refreshIsosurfaces(): Saga<void> {
  yield* put(saveNowAction());
  // We reload all cells that got modified till the start of reloading.
  // By that we avoid that removing cells that got annotated during reloading from the modifiedCells set.
  const currentlyModifiedCells = new Set(modifiedCells);
  modifiedCells.clear();

  // Also load the Isosurface at the current flycam position.
  const segmentationLayer = Model.getVisibleSegmentationLayer();
  if (!segmentationLayer) {
    return;
  }
  // First create an array containing information about all loaded isosurfaces as the map is manipulated within the loop.
  for (const [cellId, threeDMap] of Array.from(
    isosurfacesMapByLayer[segmentationLayer.name].entries(),
  )) {
    if (!currentlyModifiedCells.has(cellId)) {
      continue;
    }
    const isosurfacePositions = threeDMap.entries().filter(([value, _position]) => value);
    if (isosurfacePositions.length === 0) {
      continue;
    }
    // Removing Isosurface from cache.
    yield* call(removeIsosurface, removeIsosurfaceAction(segmentationLayer.name, cellId), false);
    // The isosurface should only be removed once after re-fetching the isosurface first position.
    let shouldBeRemoved = true;
    for (const [, position] of isosurfacePositions) {
      // Reload the Isosurface at the given position if it isn't already loaded there.
      // This is done to ensure that every voxel of the isosurface is reloaded.
      yield* call(ensureSuitableIsosurface, null, position, cellId, shouldBeRemoved);
      shouldBeRemoved = false;
    }
  }
  const position = yield* select(state => getFlooredPosition(state.flycam));
  const cellIdAtFlycamPosition = segmentationLayer.cube.getDataValue(position);
  yield* call(ensureSuitableIsosurface, null, position, cellIdAtFlycamPosition);
  yield* put(finishedRefreshingIsosurfacesAction());
}

function* refreshIsosurface(action: RefreshIsosurfaceAction): Saga<void> {
  const { cellId } = action;

  const threeDMap = isosurfacesMapByLayer[action.layerName].get(cellId);
  const isosurfacePositions = threeDMap
    ? threeDMap.entries().filter(([value, _position]) => value)
    : [];
  if (isosurfacePositions.length === 0) {
    return;
  }
  yield* put(startedLoadingIsosurfaceAction(action.layerName, cellId));
  // Removing Isosurface from cache.
  yield* call(removeIsosurface, removeIsosurfaceAction(action.layerName, cellId), false);
  // The isosurface should only be removed once after re-fetching the isosurface first position.
  let shouldBeRemoved = true;
  for (const [, position] of isosurfacePositions) {
    // Reload the Isosurface at the given position if it isn't already loaded there.
    // This is done to ensure that every voxel of the isosurface is reloaded.
    yield* call(ensureSuitableIsosurface, null, position, cellId, shouldBeRemoved);
    shouldBeRemoved = false;
  }
  yield* put(finishedLoadingIsosurfaceAction(action.layerName, cellId));
}

function* handleIsosurfaceVisibilityChange(action: UpdateIsosurfaceVisibilityAction): Saga<void> {
  const { id, visibility } = action;
  const SceneController = yield* call(getSceneController);
  SceneController.setIsosurfaceVisibility(id, visibility);
}

export default function* isosurfaceSaga(): Saga<void> {
  yield* take("WK_READY");
  yield _takeEvery(FlycamActions, ensureSuitableIsosurface);
  yield _takeEvery("CHANGE_ACTIVE_ISOSURFACE_CELL", changeActiveIsosurfaceCell);
  yield _takeEvery("TRIGGER_ACTIVE_ISOSURFACE_DOWNLOAD", downloadActiveIsosurfaceCell);
  yield _takeEvery("TRIGGER_ISOSURFACE_DOWNLOAD", downloadIsosurfaceCell);
  yield _takeEvery("IMPORT_ISOSURFACE_FROM_STL", importIsosurfaceFromStl);
  yield _takeEvery("REMOVE_ISOSURFACE", removeIsosurface);
  yield _takeEvery("REFRESH_ISOSURFACES", refreshIsosurfaces);
  yield _takeEvery("REFRESH_ISOSURFACE", refreshIsosurface);
  yield _takeEvery("UPDATE_ISOSURFACE_VISIBILITY", handleIsosurfaceVisibilityChange);
  yield _takeEvery(["START_EDITING", "COPY_SEGMENTATION_LAYER"], markEditedCellAsDirty);
}
