import { saveAs } from "file-saver";
import _ from "lodash";
import { V3 } from "libs/mjs";
import { chunkDynamically, sleep } from "libs/utils";
import ErrorHandling from "libs/error_handling";
import type { APIDataset, APIMeshFile, APISegmentationLayer } from "types/api_flow_types";
import { mergeBufferGeometries, mergeVertices } from "libs/BufferGeometryUtils";
import Deferred from "libs/async/deferred";

import Store from "oxalis/store";
import {
  getResolutionInfo,
  getMappingInfo,
  getVisibleSegmentationLayer,
  getSegmentationLayerByName,
} from "oxalis/model/accessors/dataset_accessor";
import {
  LoadAdHocMeshAction,
  LoadPrecomputedMeshAction,
  AdHocMeshInfo,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import type { Action } from "oxalis/model/actions/actions";
import type { Vector3 } from "oxalis/constants";
import { MappingStatusEnum } from "oxalis/constants";
import {
  UpdateMeshVisibilityAction,
  RemoveMeshAction,
  RefreshMeshAction,
  TriggerMeshDownloadAction,
  MaybeFetchMeshFilesAction,
  updateMeshFileListAction,
  updateCurrentMeshFileAction,
  dispatchMaybeFetchMeshFilesAsync,
  removeMeshAction,
  addAdHocMeshAction,
  addPrecomputedMeshAction,
  finishedLoadingMeshAction,
  startedLoadingMeshAction,
  TriggerMeshesDownloadAction,
  updateMeshVisibilityAction,
} from "oxalis/model/actions/annotation_actions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { actionChannel, takeEvery, call, take, race, put, all } from "typed-redux-saga";
import { stlMeshConstants } from "oxalis/view/right-border-tabs/segments_tab/segments_view";
import {
  computeAdHocMesh,
  sendAnalyticsEvent,
  meshV0,
  meshV3,
  getMeshfilesForDatasetLayer,
  getBucketPositionsForAdHocMesh,
} from "admin/admin_rest_api";
import { zoomedAddressToAnotherZoomStepWithInfo } from "oxalis/model/helpers/position_converter";
import DataLayer from "oxalis/model/data_layer";
import { Model } from "oxalis/singletons";
import ThreeDMap from "libs/ThreeDMap";
import exportToStl from "libs/stl_exporter";
import getSceneController from "oxalis/controller/scene_controller_provider";
import parseStlBuffer from "libs/parse_stl_buffer";
import window from "libs/window";
import {
  getActiveSegmentationTracing,
  getEditableMappingForVolumeTracingId,
  getMeshInfoForSegment,
  getTracingForSegmentationLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import Toast from "libs/toast";
import { getDracoLoader } from "libs/draco";
import messages from "messages";
import processTaskWithPool from "libs/async/task_pool";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import {
  BatchUpdateGroupsAndSegmentsAction,
  RemoveSegmentAction,
  UpdateSegmentAction,
} from "../actions/volumetracing_actions";
import { ResolutionInfo } from "../helpers/resolution_info";
import { type AdditionalCoordinate } from "types/api_flow_types";
import Zip from "libs/zipjs_wrapper";
import { FlycamAction } from "../actions/flycam_actions";
import { getAdditionalCoordinatesAsString } from "../accessors/flycam_accessor";

export const NO_LOD_MESH_INDEX = -1;
const MAX_RETRY_COUNT = 5;
const RETRY_WAIT_TIME = 5000;
const MESH_CHUNK_THROTTLE_DELAY = 500;
const PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT = 32;
const MIN_BATCH_SIZE_IN_BYTES = 2 ** 16;

// The calculation of a mesh is spread across multiple requests.
// In order to avoid, that a huge amount of chunks is downloaded at full speed,
// we artificially throttle the download speed after the first MESH_CHUNK_THROTTLE_LIMIT
// requests for each segment.
const batchCounterPerSegment: Record<number, number> = {};
const MESH_CHUNK_THROTTLE_LIMIT = 50;

/*
 *
 * Ad Hoc Meshes
 *
 */
// Maps from additional coordinates, layerName and segmentId to a ThreeDMap that stores for each chunk
// (at x, y, z) position whether the mesh chunk was loaded.
const adhocMeshesMapByLayer: Record<string, Record<string, Map<number, ThreeDMap<boolean>>>> = {};
function marchingCubeSizeInMag1(): Vector3 {
  return (window as any).__marchingCubeSizeInMag1 != null
    ? (window as any).__marchingCubeSizeInMag1
    : [128, 128, 128];
}
const modifiedCells: Set<number> = new Set();
export function isMeshSTL(buffer: ArrayBuffer): boolean {
  const dataView = new DataView(buffer);
  const isMesh = stlMeshConstants.meshMarker.every(
    (marker, index) => dataView.getUint8(index) === marker,
  );
  return isMesh;
}

function getOrAddMapForSegment(
  layerName: string,
  segmentId: number,
  additionalCoordinates?: AdditionalCoordinate[] | null,
): ThreeDMap<boolean> {
  let additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);

  const keys = [additionalCoordKey, layerName];
  // create new map if adhocMeshesMapByLayer[additionalCoordinatesString][layerName] doesn't exist yet.
  _.set(adhocMeshesMapByLayer, keys, _.get(adhocMeshesMapByLayer, keys, new Map()));
  const meshesMap = adhocMeshesMapByLayer[additionalCoordKey][layerName];
  const maybeMap = meshesMap.get(segmentId);

  if (maybeMap == null) {
    const newMap = new ThreeDMap<boolean>();
    meshesMap.set(segmentId, newMap);
    return newMap;
  }

  return maybeMap;
}

function removeMapForSegment(
  layerName: string,
  segmentId: number,
  additionalCoordinateKey: string,
): void {
  if (
    adhocMeshesMapByLayer[additionalCoordinateKey] == null ||
    adhocMeshesMapByLayer[additionalCoordinateKey][layerName] == null
  ) {
    return;
  }

  adhocMeshesMapByLayer[additionalCoordinateKey][layerName].delete(segmentId);
}

function getZoomedCubeSize(zoomStep: number, resolutionInfo: ResolutionInfo): Vector3 {
  // Convert marchingCubeSizeInMag1 to another resolution (zoomStep)
  const [x, y, z] = zoomedAddressToAnotherZoomStepWithInfo(
    [...marchingCubeSizeInMag1(), 0],
    resolutionInfo,
    zoomStep,
  );
  // Drop the last element of the Vector4;
  return [x, y, z];
}

function clipPositionToCubeBoundary(position: Vector3): Vector3 {
  const currentCube = V3.floor(V3.divide3(position, marchingCubeSizeInMag1()));
  const clippedPosition = V3.scale3(currentCube, marchingCubeSizeInMag1());
  return clippedPosition;
}

// front_xy, front_xz, front_yz, back_xy, back_xz, back_yz
const NEIGHBOR_LOOKUP = [
  [0, 0, -1],
  [0, -1, 0],
  [-1, 0, 0],
  [0, 0, 1],
  [0, 1, 0],
  [1, 0, 0],
];

function getNeighborPosition(clippedPosition: Vector3, neighborId: number): Vector3 {
  const neighborMultiplier = NEIGHBOR_LOOKUP[neighborId];
  const neighboringPosition: Vector3 = [
    clippedPosition[0] + neighborMultiplier[0] * marchingCubeSizeInMag1()[0],
    clippedPosition[1] + neighborMultiplier[1] * marchingCubeSizeInMag1()[1],
    clippedPosition[2] + neighborMultiplier[2] * marchingCubeSizeInMag1()[2],
  ];
  return neighboringPosition;
}

function* loadAdHocMeshFromAction(action: LoadAdHocMeshAction): Saga<void> {
  yield* call(
    loadAdHocMesh,
    action.seedPosition,
    action.seedAdditionalCoordinates,
    action.segmentId,
    false,
    action.layerName,
    action.extraInfo,
  );
}

function* getMeshExtraInfo(
  layerName: string,
  maybeExtraInfo: AdHocMeshInfo | null | undefined,
): Saga<AdHocMeshInfo> {
  const activeMappingByLayer = yield* select(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  if (maybeExtraInfo != null) return maybeExtraInfo;
  const mappingInfo = getMappingInfo(activeMappingByLayer, layerName);
  const isMappingActive = mappingInfo.mappingStatus === MappingStatusEnum.ENABLED;
  const mappingName = isMappingActive ? mappingInfo.mappingName : null;
  const mappingType = isMappingActive ? mappingInfo.mappingType : null;
  return {
    mappingName,
    mappingType,
  };
}

function* getInfoForMeshLoading(
  layer: DataLayer,
  meshExtraInfo: AdHocMeshInfo,
): Saga<{
  zoomStep: number;
  resolutionInfo: ResolutionInfo;
}> {
  const resolutionInfo = getResolutionInfo(layer.resolutions);
  const preferredZoomStep =
    meshExtraInfo.preferredQuality != null
      ? meshExtraInfo.preferredQuality
      : yield* select(
          (state) => state.temporaryConfiguration.preferredQualityForMeshAdHocComputation,
        );
  const zoomStep = resolutionInfo.getClosestExistingIndex(preferredZoomStep);
  return {
    zoomStep,
    resolutionInfo,
  };
}

function* loadAdHocMesh(
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  segmentId: number,
  removeExistingMesh: boolean = false,
  layerName?: string | null | undefined,
  maybeExtraInfo?: AdHocMeshInfo,
): Saga<void> {
  const layer =
    layerName != null ? Model.getLayerByName(layerName) : Model.getVisibleSegmentationLayer();

  if (segmentId === 0 || layer == null) {
    return;
  }

  yield* call([Model, Model.ensureSavedState]);

  const meshExtraInfo = yield* call(getMeshExtraInfo, layer.name, maybeExtraInfo);

  const { zoomStep, resolutionInfo } = yield* call(getInfoForMeshLoading, layer, meshExtraInfo);
  batchCounterPerSegment[segmentId] = 0;

  // If a REMOVE_MESH action is dispatched and consumed
  // here before loadFullAdHocMesh is finished, the latter saga
  // should be canceled automatically to avoid populating mesh data even though
  // the mesh was removed. This is accomplished by redux-saga's race effect.
  yield* race({
    loadFullAdHocMesh: call(
      loadFullAdHocMesh,
      layer,
      segmentId,
      seedPosition,
      seedAdditionalCoordinates,
      zoomStep,
      meshExtraInfo,
      resolutionInfo,
      removeExistingMesh,
    ),
    cancel: take(
      (action: Action) =>
        action.type === "REMOVE_MESH" &&
        action.segmentId === segmentId &&
        action.layerName === layer.name,
    ),
  });
  removeMeshWithoutVoxels(segmentId, layer.name, seedAdditionalCoordinates);
}

function removeMeshWithoutVoxels(
  segmentId: number,
  layerName: string,
  additionalCoordinates: AdditionalCoordinate[] | undefined | null,
) {
  // If no voxels were added to the scene (e.g. because the segment doesn't have any voxels in this n-dimension),
  // remove it from the store's state aswell.
  const { segmentMeshController } = getSceneController();
  if (!segmentMeshController.hasMesh(segmentId, layerName, additionalCoordinates)) {
    Store.dispatch(removeMeshAction(layerName, segmentId));
  }
}

function* loadFullAdHocMesh(
  layer: DataLayer,
  segmentId: number,
  position: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | undefined | null,
  zoomStep: number,
  meshExtraInfo: AdHocMeshInfo,
  resolutionInfo: ResolutionInfo,
  removeExistingMesh: boolean,
): Saga<void> {
  let isInitialRequest = true;
  const { mappingName, mappingType } = meshExtraInfo;
  const clippedPosition = clipPositionToCubeBoundary(position);
  yield* put(
    addAdHocMeshAction(
      layer.name,
      segmentId,
      position,
      additionalCoordinates,
      mappingName,
      mappingType,
    ),
  );
  yield* put(startedLoadingMeshAction(layer.name, segmentId));

  const cubeSize = getZoomedCubeSize(zoomStep, resolutionInfo);
  const tracingStoreHost = yield* select((state) => state.tracing.tracingStore.url);
  const mag = resolutionInfo.getResolutionByIndexOrThrow(zoomStep);

  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  const visibleSegmentationLayer = yield* select((state) => getVisibleSegmentationLayer(state));
  // Fetch from datastore if no volumetracing ...
  let useDataStore = volumeTracing == null || visibleSegmentationLayer?.tracingId == null;
  if (meshExtraInfo.useDataStore != null) {
    // ... except if the caller specified whether to use the data store ...
    useDataStore = meshExtraInfo.useDataStore;
  } else if (volumeTracing?.mappingIsEditable) {
    // ... or if an editable mapping is active.
    useDataStore = false;
  }

  // Segment stats can only be used for volume tracings that have a segment index
  // and that don't have editable mappings.
  const usePositionsFromSegmentStats =
    volumeTracing?.hasSegmentIndex &&
    !volumeTracing.mappingIsEditable &&
    visibleSegmentationLayer?.tracingId != null;
  let positionsToRequest = usePositionsFromSegmentStats
    ? yield* getChunkPositionsFromSegmentStats(
        tracingStoreHost,
        layer,
        segmentId,
        cubeSize,
        mag,
        clippedPosition,
        additionalCoordinates,
      )
    : [clippedPosition];

  if (positionsToRequest.length === 0) {
    //if no positions are requested, remove the mesh,
    //so that the old one isn't displayed anymore
    yield* put(removeMeshAction(layer.name, segmentId));
  }
  while (positionsToRequest.length > 0) {
    const currentPosition = positionsToRequest.shift();
    if (currentPosition == null) {
      throw new Error("Satisfy typescript");
    }
    const neighbors = yield* call(
      maybeLoadMeshChunk,
      layer,
      segmentId,
      currentPosition,
      zoomStep,
      meshExtraInfo,
      resolutionInfo,
      isInitialRequest,
      removeExistingMesh && isInitialRequest,
      useDataStore,
      !usePositionsFromSegmentStats,
    );
    isInitialRequest = false;

    // If we are using the positions from the segment index, the backend will
    // send an empty neighbors array, as it's not necessary to have them.
    if (usePositionsFromSegmentStats && neighbors.length > 0) {
      throw new Error("Retrieved neighbor positions even though these were not requested.");
    }
    positionsToRequest = positionsToRequest.concat(neighbors);
  }

  yield* put(finishedLoadingMeshAction(layer.name, segmentId));
}

function* getChunkPositionsFromSegmentStats(
  tracingStoreHost: string,
  layer: DataLayer,
  segmentId: number,
  cubeSize: Vector3,
  mag: Vector3,
  clippedPosition: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
) {
  const unscaledPositions = yield* call(
    getBucketPositionsForAdHocMesh,
    tracingStoreHost,
    layer.name,
    segmentId,
    cubeSize,
    mag,
    additionalCoordinates,
  );
  const positions = unscaledPositions.map((pos) => V3.scale3(pos, mag));
  return sortByDistanceTo(positions, clippedPosition) as Vector3[];
}

function hasMeshChunkExceededThrottleLimit(segmentId: number): boolean {
  return batchCounterPerSegment[segmentId] > MESH_CHUNK_THROTTLE_LIMIT;
}

function* maybeLoadMeshChunk(
  layer: DataLayer,
  segmentId: number,
  clippedPosition: Vector3,
  zoomStep: number,
  meshExtraInfo: AdHocMeshInfo,
  resolutionInfo: ResolutionInfo,
  isInitialRequest: boolean,
  removeExistingMesh: boolean,
  useDataStore: boolean,
  findNeighbors: boolean,
): Saga<Vector3[]> {
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const threeDMap = getOrAddMapForSegment(layer.name, segmentId, additionalCoordinates);

  if (threeDMap.get(clippedPosition)) {
    return [];
  }

  if (hasMeshChunkExceededThrottleLimit(segmentId)) {
    yield* call(sleep, MESH_CHUNK_THROTTLE_DELAY);
  }

  batchCounterPerSegment[segmentId]++;
  threeDMap.set(clippedPosition, true);
  // In general, it is more performant to compute meshes in a more coarse resolution instead of using subsampling strides
  // since in the coarse resolution less data needs to be loaded. Another possibility to increase performance is
  // window.__marchingCubeSizeInMag1 which affects the cube size the marching cube algorithm will work on. If the cube is significantly larger than the
  // segments, computations are wasted.
  const subsamplingStrides = (window as any).__meshSubsamplingStrides || [1, 1, 1];
  const scale = yield* select((state) => state.dataset.dataSource.scale);
  const dataStoreHost = yield* select((state) => state.dataset.dataStore.url);
  const owningOrganization = yield* select((state) => state.dataset.owningOrganization);
  const datasetName = yield* select((state) => state.dataset.name);
  const tracingStoreHost = yield* select((state) => state.tracing.tracingStore.url);
  const dataStoreUrl = `${dataStoreHost}/data/datasets/${owningOrganization}/${datasetName}/layers/${
    layer.fallbackLayer != null ? layer.fallbackLayer : layer.name
  }`;
  const tracingStoreUrl = `${tracingStoreHost}/tracings/volume/${layer.name}`;

  const mag = resolutionInfo.getResolutionByIndexOrThrow(zoomStep);

  if (isInitialRequest) {
    sendAnalyticsEvent("request_isosurface", {
      mode: useDataStore ? "view" : "annotation",
    });
  }

  let retryCount = 0;

  const { segmentMeshController } = getSceneController();

  const cubeSize = getZoomedCubeSize(zoomStep, resolutionInfo);

  while (retryCount < MAX_RETRY_COUNT) {
    try {
      const { buffer: responseBuffer, neighbors } = yield* call(
        {
          context: null,
          fn: computeAdHocMesh,
        },
        useDataStore ? dataStoreUrl : tracingStoreUrl,
        {
          position: clippedPosition,
          additionalCoordinates: additionalCoordinates || undefined,
          mag,
          segmentId,
          subsamplingStrides,
          cubeSize,
          scale,
          findNeighbors,
          ...meshExtraInfo,
        },
      );
      const vertices = new Float32Array(responseBuffer);

      if (removeExistingMesh) {
        segmentMeshController.removeMeshById(segmentId, layer.name);
      }

      segmentMeshController.addMeshFromVertices(
        vertices,
        segmentId,
        layer.name,
        additionalCoordinates,
      );
      return neighbors.map((neighbor) => getNeighborPosition(clippedPosition, neighbor));
    } catch (exception) {
      retryCount++;
      ErrorHandling.notify(exception as Error);
      console.warn("Retrying mesh generation due to", exception);
      yield* call(sleep, RETRY_WAIT_TIME * 2 ** retryCount);
    }
  }

  return [];
}

function* markEditedCellAsDirty(): Saga<void> {
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));

  if (volumeTracing != null && volumeTracing.fallbackLayer == null) {
    const activeCellId = volumeTracing.activeCellId;
    modifiedCells.add(activeCellId);
  }
}

function* refreshMeshes(): Saga<void> {
  yield* put(saveNowAction());
  // We reload all cells that got modified till the start of reloading.
  // By that we avoid to remove cells that got annotated during reloading from the modifiedCells set.
  const currentlyModifiedCells = new Set(modifiedCells);
  modifiedCells.clear();

  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
  const segmentationLayer = Model.getVisibleSegmentationLayer();

  if (!segmentationLayer) {
    return;
  }

  adhocMeshesMapByLayer[additionalCoordKey][segmentationLayer.name] =
    adhocMeshesMapByLayer[additionalCoordKey][segmentationLayer.name] || new Map();
  const meshesMapForLayer = adhocMeshesMapByLayer[additionalCoordKey][segmentationLayer.name];

  for (const [segmentId, threeDMap] of Array.from(meshesMapForLayer.entries())) {
    if (!currentlyModifiedCells.has(segmentId)) {
      continue;
    }

    yield* call(
      _refreshMeshWithMap,
      segmentId,
      threeDMap,
      segmentationLayer.name,
      additionalCoordinates,
    );
  }
}

function* refreshMesh(action: RefreshMeshAction): Saga<void> {
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);

  const { segmentId, layerName } = action;

  const meshInfo = yield* select((state) =>
    getMeshInfoForSegment(state, additionalCoordinates, layerName, segmentId),
  );

  if (meshInfo == null) {
    throw new Error(
      `Mesh refreshing failed due to lack of mesh info for segment ${segmentId} in store.`,
    );
  }

  if (meshInfo.isPrecomputed) {
    yield* put(removeMeshAction(layerName, meshInfo.segmentId));
    yield* put(
      loadPrecomputedMeshAction(
        meshInfo.segmentId,
        meshInfo.seedPosition,
        meshInfo.seedAdditionalCoordinates,
        meshInfo.meshFileName,
        layerName,
      ),
    );
  } else {
    if (adhocMeshesMapByLayer[additionalCoordKey] == null) return;
    const threeDMap = adhocMeshesMapByLayer[additionalCoordKey][action.layerName].get(segmentId);
    if (threeDMap == null) {
      return;
    }
    yield* call(_refreshMeshWithMap, segmentId, threeDMap, layerName, additionalCoordinates);
  }
}

function* _refreshMeshWithMap(
  segmentId: number,
  threeDMap: ThreeDMap<boolean>,
  layerName: string,
  additionalCoordinates: AdditionalCoordinate[] | null,
): Saga<void> {
  const meshInfo = yield* select((state) =>
    getMeshInfoForSegment(state, additionalCoordinates, layerName, segmentId),
  );
  if (meshInfo == null) {
    throw new Error(
      `Mesh refreshing failed due to lack of mesh info for segment ${segmentId} in store.`,
    );
  }
  yield* call(
    [ErrorHandling, ErrorHandling.assert],
    !meshInfo.isPrecomputed,
    "_refreshMeshWithMap was called for a precomputed mesh.",
  );
  if (meshInfo.isPrecomputed) return;
  const { mappingName, mappingType } = meshInfo;
  const meshPositions = threeDMap.entries().filter(([value, _position]) => value);

  if (meshPositions.length === 0) {
    return;
  }

  // Remove mesh from cache.
  yield* call(removeMesh, removeMeshAction(layerName, segmentId), false);
  // The mesh should only be removed once after re-fetching the mesh first position.
  let shouldBeRemoved = true;

  for (const [, position] of meshPositions) {
    // Reload the mesh at the given position if it isn't already loaded there.
    // This is done to ensure that every voxel of the mesh is reloaded.
    yield* call(
      loadAdHocMesh,
      position,
      additionalCoordinates,
      segmentId,
      shouldBeRemoved,
      layerName,
      {
        mappingName,
        mappingType,
      },
    );
    shouldBeRemoved = false;
  }
}

/*
 *
 * Precomputed Meshes
 *
 */

// Avoid redundant fetches of mesh files for the same layer by
// storing Deferreds per layer lazily.
const fetchDeferredsPerLayer: Record<string, Deferred<Array<APIMeshFile>, unknown>> = {};
function* maybeFetchMeshFiles(action: MaybeFetchMeshFilesAction): Saga<void> {
  const { segmentationLayer, dataset, mustRequest, autoActivate, callback } = action;

  if (!segmentationLayer) {
    callback([]);
    return;
  }

  const layerName = segmentationLayer.name;

  function* maybeActivateMeshFile(availableMeshFiles: APIMeshFile[]) {
    const currentMeshFile = yield* select(
      (state) => state.localSegmentationData[layerName].currentMeshFile,
    );
    if (!currentMeshFile && availableMeshFiles.length > 0 && autoActivate) {
      yield* put(updateCurrentMeshFileAction(layerName, availableMeshFiles[0].meshFileName));
    }
  }

  // If a deferred already exists (and mustRequest is not true), the deferred
  // can be awaited (regardless of whether it's finished or not) and its
  // content used to call the callback.
  if (fetchDeferredsPerLayer[layerName] && !mustRequest) {
    const availableMeshFiles = yield* call(() => fetchDeferredsPerLayer[layerName].promise());
    yield* maybeActivateMeshFile(availableMeshFiles);
    callback(availableMeshFiles);
    return;
  }
  // A request has to be made (either because none was made before or because
  // it is enforced by mustRequest).
  // If mustRequest is true and an old deferred exists, a new deferred will be created which
  // replaces the old one (old references to the first Deferred will still
  // work and will be resolved by the corresponding saga execution).
  const deferred = new Deferred<Array<APIMeshFile>, unknown>();
  fetchDeferredsPerLayer[layerName] = deferred;

  const availableMeshFiles = yield* call(
    getMeshfilesForDatasetLayer,
    dataset.dataStore.url,
    dataset,
    getBaseSegmentationName(segmentationLayer),
  );
  yield* put(updateMeshFileListAction(layerName, availableMeshFiles));
  deferred.resolve(availableMeshFiles);

  yield* maybeActivateMeshFile(availableMeshFiles);

  callback(availableMeshFiles);
}

function* loadPrecomputedMesh(action: LoadPrecomputedMeshAction) {
  const { segmentId, seedPosition, seedAdditionalCoordinates, meshFileName, layerName } = action;
  const layer = yield* select((state) =>
    layerName != null
      ? getSegmentationLayerByName(state.dataset, layerName)
      : getVisibleSegmentationLayer(state),
  );
  if (layer == null) return;
  // If a REMOVE_MESH action is dispatched and consumed
  // here before loadPrecomputedMeshForSegmentId is finished, the latter saga
  // should be canceled automatically to avoid populating mesh data even though
  // the mesh was removed. This is accomplished by redux-saga's race effect.
  yield* race({
    loadPrecomputedMeshForSegmentId: call(
      loadPrecomputedMeshForSegmentId,
      segmentId,
      seedPosition,
      seedAdditionalCoordinates,
      meshFileName,
      layer,
    ),
    cancel: take(
      (otherAction: Action) =>
        otherAction.type === "REMOVE_MESH" &&
        otherAction.segmentId === segmentId &&
        otherAction.layerName === layer.name,
    ),
  });
}

type ChunksMap = Record<number, Vector3[] | meshV3.MeshChunk[] | null | undefined>;

function* loadPrecomputedMeshForSegmentId(
  id: number,
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  meshFileName: string,
  segmentationLayer: APISegmentationLayer,
): Saga<void> {
  const layerName = segmentationLayer.name;
  yield* put(
    addPrecomputedMeshAction(layerName, id, seedPosition, seedAdditionalCoordinates, meshFileName),
  );
  yield* put(startedLoadingMeshAction(layerName, id));
  const dataset = yield* select((state) => state.dataset);
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);

  const availableMeshFiles = yield* call(
    dispatchMaybeFetchMeshFilesAsync,
    Store.dispatch,
    segmentationLayer,
    dataset,
    false,
    false,
  );

  const meshFile = availableMeshFiles.find((file) => file.meshFileName === meshFileName);
  if (!meshFile) {
    Toast.error("Could not load mesh, since the requested mesh file was not found.");
    return;
  }

  let availableChunksMap: ChunksMap = {};
  let scale: Vector3 | null = null;
  let loadingOrder: number[] | null = null;
  try {
    const chunkDescriptors = yield* call(
      _getChunkLoadingDescriptors,
      id,
      dataset,
      segmentationLayer,
      meshFile,
    );
    availableChunksMap = chunkDescriptors.availableChunksMap;
    scale = chunkDescriptors.scale;
    loadingOrder = chunkDescriptors.loadingOrder;
  } catch (exception) {
    console.warn("Mesh chunk couldn't be loaded due to", exception);
    Toast.warning(messages["tracing.mesh_listing_failed"]);
    yield* put(finishedLoadingMeshAction(layerName, id));
    yield* put(removeMeshAction(layerName, id));
    return;
  }

  const loadChunksTasks = _getLoadChunksTasks(
    dataset,
    layerName,
    meshFile,
    segmentationLayer,
    id,
    seedPosition,
    availableChunksMap,
    loadingOrder,
    scale,
    additionalCoordinates,
  );

  try {
    yield* call(processTaskWithPool, loadChunksTasks, PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT);
  } catch (exception) {
    console.error(exception);
    Toast.warning(`Some mesh chunks could not be loaded for segment ${id}.`);
  }

  yield* put(finishedLoadingMeshAction(layerName, id));
}

function* _getChunkLoadingDescriptors(
  id: number,
  dataset: APIDataset,
  segmentationLayer: APISegmentationLayer,
  meshFile: APIMeshFile,
) {
  const availableChunksMap: ChunksMap = {};
  let scale: Vector3 | null = null;
  let loadingOrder: number[] = [];

  const { segmentMeshController } = getSceneController();
  const currentLODIndex = yield* call({
    context: segmentMeshController.meshesLODRootGroup,
    fn: segmentMeshController.meshesLODRootGroup.getCurrentLOD,
  });
  const version = meshFile.formatVersion;
  const { meshFileName } = meshFile;
  const meshExtraInfo = yield* call(getMeshExtraInfo, segmentationLayer.name, null);

  const editableMapping = yield* select((state) =>
    getEditableMappingForVolumeTracingId(state, segmentationLayer.tracingId),
  );
  const tracing = yield* select((state) =>
    getTracingForSegmentationLayer(state, segmentationLayer),
  );
  const mappingName =
    // meshExtraInfo.mappingName contains the currently active mapping
    // (can be the id of an editable mapping). However, we always need to
    // use the mapping name of the on-disk mapping.
    editableMapping != null ? editableMapping.baseMappingName : meshExtraInfo.mappingName;

  if (version < 3) {
    console.warn(
      "The active mesh file uses a version lower than 3. webKnossos cannot check whether the mesh file was computed with the correct target mapping. Meshing requests will fail if the mesh file does not match the active mapping.",
    );
  }

  // mappingName only exists for versions >= 3
  if (meshFile.mappingName != null && meshFile.mappingName !== mappingName) {
    throw Error(
      `Trying to use a mesh file that was computed for mapping ${meshFile.mappingName} for a requested mapping of ${mappingName}.`,
    );
  }

  if (version >= 3) {
    const segmentInfo = yield* call(
      meshV3.getMeshfileChunksForSegment,
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(segmentationLayer),
      meshFileName,
      id,
      // The back-end should only receive a non-null mapping name,
      // if it should perform extra (reverse) look ups to compute a mesh
      // with a specific mapping from a mesh file that was computed
      // without a mapping.
      meshFile.mappingName == null ? mappingName : null,
      editableMapping != null && tracing ? tracing.tracingId : null,
    );
    scale = [segmentInfo.transform[0][0], segmentInfo.transform[1][1], segmentInfo.transform[2][2]];
    segmentInfo.chunks.lods.forEach((chunks, lodIndex) => {
      availableChunksMap[lodIndex] = chunks?.chunks;
      loadingOrder.push(lodIndex);
    });
    // Load the chunks closest to the current LOD first.
    loadingOrder.sort((a, b) => Math.abs(a - currentLODIndex) - Math.abs(b - currentLODIndex));
  } else {
    availableChunksMap[NO_LOD_MESH_INDEX] = yield* call(
      meshV0.getMeshfileChunksForSegment,
      dataset.dataStore.url,
      dataset,
      getBaseSegmentationName(segmentationLayer),
      meshFileName,
      id,
    );
    loadingOrder = [NO_LOD_MESH_INDEX];
  }

  return {
    availableChunksMap,
    scale,
    loadingOrder,
  };
}

function _getLoadChunksTasks(
  dataset: APIDataset,
  layerName: string,
  meshFile: APIMeshFile,
  segmentationLayer: APISegmentationLayer,
  id: number,
  seedPosition: Vector3,
  availableChunksMap: ChunksMap,
  loadingOrder: number[],
  scale: Vector3 | null,
  additionalCoordinates: AdditionalCoordinate[] | null,
) {
  const { segmentMeshController } = getSceneController();
  const { meshFileName } = meshFile;
  return _.compact(
    _.flatten(
      loadingOrder.map((lod) => {
        if (availableChunksMap[lod] == null) {
          return;
        }
        const availableChunks = availableChunksMap[lod];
        // Sort the chunks by distance to the seedPosition, so that the mesh loads from the inside out
        const sortedAvailableChunks = sortByDistanceTo(availableChunks, seedPosition);

        let tasks;
        if (sortedAvailableChunks.length > 0 && "position" in sortedAvailableChunks[0]) {
          // V3
          const batches = chunkDynamically(
            sortedAvailableChunks as meshV3.MeshChunk[],
            MIN_BATCH_SIZE_IN_BYTES,
            (chunk) => chunk.byteSize,
          );

          tasks = batches.map(
            (chunks) =>
              function* loadChunks(): Saga<void> {
                // V3
                const dataForChunks = yield* call(
                  meshV3.getMeshfileChunkData,
                  dataset.dataStore.url,
                  dataset,
                  getBaseSegmentationName(segmentationLayer),
                  {
                    meshFile: meshFileName,
                    // Only extract the relevant properties
                    requests: chunks.map(({ byteOffset, byteSize }) => ({ byteOffset, byteSize })),
                  },
                );
                const loader = getDracoLoader();

                const errorsWithDetails = [];

                const chunksWithData = chunks.map((chunk, idx) => ({
                  ...chunk,
                  data: dataForChunks[idx],
                }));
                // Group chunks by position and merge meshes in the same chunk to keep the number
                // of objects in the scene low for better performance. Ideally, more mesh geometries
                // would be merged, but the meshes in different chunks need to be translated differently.
                const chunksGroupedByPosition = _.groupBy(chunksWithData, "position");
                for (const chunksForPosition of Object.values(chunksGroupedByPosition)) {
                  // All chunks in chunksForPosition have the same position
                  const position = chunksForPosition[0].position;

                  const bufferGeometries = [];
                  for (let chunkIdx = 0; chunkIdx < chunksForPosition.length; chunkIdx++) {
                    const chunk = chunksForPosition[chunkIdx];
                    try {
                      const bufferGeometry = yield* call(loader.decodeDracoFileAsync, chunk.data);
                      bufferGeometries.push(bufferGeometry);
                    } catch (error) {
                      errorsWithDetails.push({ error, chunk });
                    }
                  }

                  const geometry = mergeBufferGeometries(bufferGeometries);

                  // If mergeBufferGeometries does not succeed, the method logs the error to the console and returns null
                  if (geometry == null) continue;

                  // Compute vertex normals to achieve smooth shading
                  geometry.computeVertexNormals();

                  yield* call(
                    {
                      context: segmentMeshController,
                      fn: segmentMeshController.addMeshFromGeometry,
                    },
                    geometry,
                    id,
                    position,
                    // Apply the scale from the segment info, which includes dataset scale and mag
                    scale,
                    lod,
                    layerName,
                    additionalCoordinates,
                  );
                }

                if (errorsWithDetails.length > 0) {
                  console.warn("Errors occurred while decoding mesh chunks:", errorsWithDetails);
                  // Use first error as representative
                  throw errorsWithDetails[0].error;
                }
              },
          );
        } else {
          tasks = (sortedAvailableChunks as Vector3[]).map(
            (chunk) =>
              function* loadChunk(): Saga<void> {
                // V0
                const stlData = yield* call(
                  meshV0.getMeshfileChunkData,
                  dataset.dataStore.url,
                  dataset,
                  getBaseSegmentationName(segmentationLayer),
                  meshFileName,
                  id,
                  chunk,
                );
                let geometry = yield* call(parseStlBuffer, stlData);

                // Delete existing vertex normals (since these are not interpolated
                // across faces).
                geometry.deleteAttribute("normal");
                // Ensure that vertices of adjacent faces are shared.
                geometry = mergeVertices(geometry);
                // Recompute normals to achieve smooth shading
                geometry.computeVertexNormals();

                yield* call(
                  {
                    context: segmentMeshController,
                    fn: segmentMeshController.addMeshFromGeometry,
                  },
                  geometry,
                  id,
                  null,
                  null,
                  lod,
                  layerName,
                  additionalCoordinates,
                );
              },
          );
        }

        return tasks;
      }),
    ),
  );
}

function sortByDistanceTo(
  availableChunks: Vector3[] | meshV3.MeshChunk[] | null | undefined,
  seedPosition: Vector3,
) {
  return _.sortBy(availableChunks, (chunk: Vector3 | meshV3.MeshChunk) =>
    V3.length(V3.sub(seedPosition, "position" in chunk ? chunk.position : chunk)),
  ) as Array<Vector3> | Array<meshV3.MeshChunk>;
}

/*
 *
 * Ad Hoc and Precomputed Meshes
 *
 */
function* downloadMeshCellById(cellName: string, segmentId: number, layerName: string): Saga<void> {
  const { segmentMeshController } = getSceneController();
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const geometry = segmentMeshController.getMeshGeometryInBestLOD(
    segmentId,
    layerName,
    additionalCoordinates,
  );

  if (geometry == null) {
    const errorMessage = messages["tracing.not_mesh_available_to_download"];
    Toast.error(errorMessage, {
      sticky: false,
    });
    return;
  }

  try {
    const blob = getSTLBlob(geometry, segmentId);
    yield* call(saveAs, blob, `${cellName}-${segmentId}.stl`);
  } catch (exception) {
    ErrorHandling.notify(exception as Error);
    console.error(exception);
    Toast.error("Could not export to STL. See console for details");
  }
}

function* downloadMeshCellsAsZIP(
  segments: Array<{ segmentName: string; segmentId: number; layerName: string }>,
): Saga<void> {
  const { segmentMeshController } = getSceneController();
  const zipWriter = new Zip.ZipWriter(new Zip.BlobWriter("application/zip"));
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  try {
    const addFileToZipWriterPromises = segments.map((element) => {
      const geometry = segmentMeshController.getMeshGeometryInBestLOD(
        element.segmentId,
        element.layerName,
        additionalCoordinates,
      );

      if (geometry == null) {
        const errorMessage = messages["tracing.not_mesh_available_to_download"];
        Toast.error(errorMessage, {
          sticky: false,
        });
        return;
      }
      const stlDataReader = new Zip.BlobReader(getSTLBlob(geometry, element.segmentId));
      return zipWriter.add(`${element.segmentName}-${element.segmentId}.stl`, stlDataReader);
    });
    yield all(addFileToZipWriterPromises);
    const result = yield* call([zipWriter, zipWriter.close]);
    yield* call(saveAs, result as Blob, "mesh-export.zip");
  } catch (exception) {
    ErrorHandling.notify(exception as Error);
    console.error(exception);
    Toast.error("Could not export meshes as STL files. See console for details");
  }
}

const getSTLBlob = (geometry: THREE.Group, segmentId: number): Blob => {
  const stlDataViews = exportToStl(geometry);
  // Encode mesh and cell id property
  const { meshMarker, segmentIdIndex } = stlMeshConstants;
  meshMarker.forEach((marker, index) => {
    stlDataViews[0].setUint8(index, marker);
  });
  stlDataViews[0].setUint32(segmentIdIndex, segmentId, true);
  return new Blob(stlDataViews);
};

function* downloadMeshCell(action: TriggerMeshDownloadAction): Saga<void> {
  yield* call(downloadMeshCellById, action.segmentName, action.segmentId, action.layerName);
}

function* downloadMeshCells(action: TriggerMeshesDownloadAction): Saga<void> {
  yield* call(downloadMeshCellsAsZIP, action.segmentsArray);
}

function* handleRemoveSegment(action: RemoveSegmentAction) {
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
  const { layerName, segmentId } = action;
  if (adhocMeshesMapByLayer[additionalCoordKey]?.[layerName]?.get(segmentId) != null) {
    // The dispatched action will make sure that the mesh entry is removed from the
    // store **and** from the scene. Otherwise, the store will still contain a reference
    // to the mesh even though it's not in the scene, anymore.
    yield* put(removeMeshAction(action.layerName, action.segmentId));
  }
}

function* removeMesh(action: RemoveMeshAction, removeFromScene: boolean = true): Saga<void> {
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
  const { layerName } = action;
  const segmentId = action.segmentId;

  if (removeFromScene) {
    getSceneController().segmentMeshController.removeMeshById(segmentId, layerName);
  }
  removeMapForSegment(layerName, segmentId, additionalCoordKey);
}

function* handleMeshVisibilityChange(action: UpdateMeshVisibilityAction): Saga<void> {
  const { id, visibility, layerName, additionalCoordinates } = action;
  const { segmentMeshController } = yield* call(getSceneController);
  segmentMeshController.setMeshVisibility(id, visibility, layerName, additionalCoordinates);
}

export function* handleAdditionalCoordinateUpdate(): Saga<void> {
  // We want to prevent iterating through all additional coordinates to adjust the mesh visibility, so we store the
  // previous additional coordinates in this method. Thus we have to catch SET_ADDITIONAL_COORDINATES actions in a
  // while-true loop and register this saga in the root saga instead of calling from the mesh saga.
  yield* take("WK_READY");

  let previousAdditionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const { segmentMeshController } = yield* call(getSceneController);

  while (true) {
    const action = (yield* take(["SET_ADDITIONAL_COORDINATES"]) as any) as FlycamAction;
    //satisfy TS
    if (action.type !== "SET_ADDITIONAL_COORDINATES") {
      throw new Error("Unexpected action type");
    }
    const meshRecords = segmentMeshController.meshesGroupsPerSegmentationId;

    if (action.values == null || action.values.length === 0) break;
    const newAdditionalCoordKey = getAdditionalCoordinatesAsString(action.values);

    for (const additionalCoordinates of [action.values, previousAdditionalCoordinates]) {
      const currentAdditionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
      const shouldBeVisible = currentAdditionalCoordKey === newAdditionalCoordKey;
      const recordsOfLayers = meshRecords[currentAdditionalCoordKey] || {};
      for (const [layerName, recordsForOneLayer] of Object.entries(recordsOfLayers)) {
        const segmentIds = Object.keys(recordsForOneLayer);
        for (const segmentIdAsString of segmentIds) {
          const segmentId = parseInt(segmentIdAsString);
          yield* put(
            updateMeshVisibilityAction(
              layerName,
              segmentId,
              shouldBeVisible,
              additionalCoordinates,
            ),
          );
          yield* call(
            {
              context: segmentMeshController,
              fn: segmentMeshController.setMeshVisibility,
            },
            segmentId,
            shouldBeVisible,
            layerName,
            additionalCoordinates,
          );
        }
      }
    }
    previousAdditionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  }
}

function* handleSegmentColorChange(action: UpdateSegmentAction): Saga<void> {
  const { segmentMeshController } = yield* call(getSceneController);
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  if (
    "color" in action.segment &&
    segmentMeshController.hasMesh(action.segmentId, action.layerName, additionalCoordinates)
  ) {
    segmentMeshController.setMeshColor(action.segmentId, action.layerName);
  }
}

function* handleBatchSegmentColorChange(
  batchAction: BatchUpdateGroupsAndSegmentsAction,
): Saga<void> {
  // Manually unpack batched actions and handle these.
  // In theory, this could happen automatically. See this issue in the corresponding (rather unmaintained) package: https://github.com/tshelburne/redux-batched-actions/pull/18
  // However, there seem to be some problems with that approach (e.g., too many updates, infinite recursion) and the discussion there didn't really reach a consensus
  // about the correct solution.
  // This is why we stick to the manual unpacking for now.
  const updateSegmentActions = batchAction.payload
    .filter((action) => action.type === "UPDATE_SEGMENT")
    .map((action) => call(handleSegmentColorChange, action as UpdateSegmentAction));
  yield* all(updateSegmentActions);
}

export default function* meshSaga(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_READY
  const loadAdHocMeshActionChannel = yield* actionChannel("LOAD_AD_HOC_MESH_ACTION");
  const loadPrecomputedMeshActionChannel = yield* actionChannel("LOAD_PRECOMPUTED_MESH_ACTION");
  const maybeFetchMeshFilesActionChannel = yield* actionChannel("MAYBE_FETCH_MESH_FILES");

  yield* take("SCENE_CONTROLLER_READY");
  yield* take("WK_READY");
  yield* takeEvery(maybeFetchMeshFilesActionChannel, maybeFetchMeshFiles);
  yield* takeEvery(loadAdHocMeshActionChannel, loadAdHocMeshFromAction);
  yield* takeEvery(loadPrecomputedMeshActionChannel, loadPrecomputedMesh);
  yield* takeEvery("TRIGGER_MESH_DOWNLOAD", downloadMeshCell);
  yield* takeEvery("TRIGGER_MESHES_DOWNLOAD", downloadMeshCells);
  yield* takeEvery("REMOVE_MESH", removeMesh);
  yield* takeEvery("REMOVE_SEGMENT", handleRemoveSegment);
  yield* takeEvery("REFRESH_MESHES", refreshMeshes);
  yield* takeEvery("REFRESH_MESH", refreshMesh);
  yield* takeEvery("UPDATE_MESH_VISIBILITY", handleMeshVisibilityChange);
  yield* takeEvery(["START_EDITING", "COPY_SEGMENTATION_LAYER"], markEditedCellAsDirty);
  yield* takeEvery("UPDATE_SEGMENT", handleSegmentColorChange);
  yield* takeEvery("BATCH_UPDATE_GROUPS_AND_SEGMENTS", handleBatchSegmentColorChange);
}
