import {
  computeAdHocMesh,
  getBucketPositionsForAdHocMesh,
  sendAnalyticsEvent,
} from "admin/rest_api";
import ThreeDMap from "libs/ThreeDMap";
import ErrorHandling from "libs/error_handling";
import { V3 } from "libs/mjs";
import { sleep } from "libs/utils";
import _ from "lodash";
import type { ActionPattern } from "redux-saga/effects";
import { actionChannel, call, put, race, take, takeEvery } from "typed-redux-saga";
import type { AdditionalCoordinate } from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { Vector3 } from "viewer/constants";
import Constants, { MappingStatusEnum } from "viewer/constants";
import { sortByDistanceTo } from "viewer/controller/mesh_helpers";
import getSceneController from "viewer/controller/scene_controller_provider";
import {
  getMagInfo,
  getMappingInfo,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getActiveSegmentationTracing,
  getMeshInfoForSegment,
} from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  type RefreshMeshAction,
  type RemoveMeshAction,
  addAdHocMeshAction,
  finishedLoadingMeshAction,
  removeMeshAction,
  startedLoadingMeshAction,
} from "viewer/model/actions/annotation_actions";
import { saveNowAction } from "viewer/model/actions/save_actions";
import {
  type AdHocMeshInfo,
  type LoadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "viewer/model/actions/segmentation_actions";
import type DataLayer from "viewer/model/data_layer";
import type { MagInfo } from "viewer/model/helpers/mag_info";
import { zoomedAddressToAnotherZoomStepWithInfo } from "viewer/model/helpers/position_converter";
import type { Saga } from "viewer/model/sagas/effect-generators";
import { select } from "viewer/model/sagas/effect-generators";
import { Model } from "viewer/singletons";
import Store from "viewer/store";
import { stlMeshConstants } from "viewer/view/right-border-tabs/segments_tab/segments_view";
import { getAdditionalCoordinatesAsString } from "../../accessors/flycam_accessor";
import { ensureSceneControllerReady, ensureWkReady } from "../ready_sagas";

const MAX_RETRY_COUNT = 5;
const RETRY_WAIT_TIME = 5000;
const MESH_CHUNK_THROTTLE_DELAY = 500;

// The calculation of a mesh is spread across multiple requests.
// In order to avoid, that a huge amount of chunks is downloaded at full speed,
// we artificially throttle the download speed after the first MESH_CHUNK_THROTTLE_LIMIT
// requests for each segment.
const batchCounterPerSegment: Record<number, number> = {};
const MESH_CHUNK_THROTTLE_LIMIT = 50;

// Maps from additional coordinates, layerName and segmentId to a ThreeDMap that stores for each chunk
// (at x, y, z) position whether the mesh chunk was loaded.
const adhocMeshesMapByLayer: Record<string, Record<string, Map<number, ThreeDMap<boolean>>>> = {};

function marchingCubeSizeInTargetMag(): Vector3 {
  return WkDevFlags.meshing.marchingCubeSizeInTargetMag;
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
  const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);

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

export function* removeMesh(action: RemoveMeshAction, removeFromScene: boolean = true): Saga<void> {
  const additionalCoordinates = yield* select((state) => state.flycam.additionalCoordinates);
  const additionalCoordKey = getAdditionalCoordinatesAsString(additionalCoordinates);
  const { layerName } = action;
  const segmentId = action.segmentId;

  if (removeFromScene) {
    getSceneController().segmentMeshController.removeMeshById(segmentId, layerName);
  }
  removeMapForSegment(layerName, segmentId, additionalCoordKey);
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

function getCubeSizeInMag1(zoomStep: number, magInfo: MagInfo): Vector3 {
  // Convert marchingCubeSizeInTargetMag to mag1 via zoomStep
  // Drop the last element of the Vector4;
  const [x, y, z] = zoomedAddressToAnotherZoomStepWithInfo(
    [...marchingCubeSizeInTargetMag(), zoomStep],
    magInfo,
    0,
  );
  return [x, y, z];
}

function clipPositionToCubeBoundary(
  position: Vector3,
  zoomStep: number,
  magInfo: MagInfo,
): Vector3 {
  const cubeSizeInMag1 = getCubeSizeInMag1(zoomStep, magInfo);
  const currentCube = V3.floor(V3.divide3(position, cubeSizeInMag1));
  const clippedPosition = V3.scale3(currentCube, cubeSizeInMag1);
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

function getNeighborPosition(
  clippedPosition: Vector3,
  neighborId: number,
  zoomStep: number,
  magInfo: MagInfo,
): Vector3 {
  const neighborMultiplier = NEIGHBOR_LOOKUP[neighborId];
  const cubeSizeInMag1 = getCubeSizeInMag1(zoomStep, magInfo);
  const neighboringPosition: Vector3 = [
    clippedPosition[0] + neighborMultiplier[0] * cubeSizeInMag1[0],
    clippedPosition[1] + neighborMultiplier[1] * cubeSizeInMag1[1],
    clippedPosition[2] + neighborMultiplier[2] * cubeSizeInMag1[2],
  ];
  return neighboringPosition;
}

function* loadAdHocMeshFromAction(action: LoadAdHocMeshAction): Saga<void> {
  const { layerName } = action;
  const layer =
    layerName != null ? Model.getLayerByName(layerName) : Model.getVisibleSegmentationLayer();
  if (layer == null) {
    return;
  }
  // Remove older mesh instance if it exists already.
  yield* put(removeMeshAction(layer.name, action.segmentId));

  yield* call(
    loadAdHocMesh,
    action.seedPosition,
    action.seedAdditionalCoordinates,
    action.segmentId,
    false,
    layer.name,
    action.extraInfo,
  );
}

export function* getMeshExtraInfo(
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
  magInfo: MagInfo;
}> {
  const magInfo = getMagInfo(layer.mags);
  const preferredZoomStep =
    meshExtraInfo.preferredQuality != null
      ? meshExtraInfo.preferredQuality
      : yield* select(
          (state) => state.temporaryConfiguration.preferredQualityForMeshAdHocComputation,
        );
  const zoomStep = magInfo.getClosestExistingIndex(preferredZoomStep);
  return {
    zoomStep,
    magInfo: magInfo,
  };
}

function* loadAdHocMesh(
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  segmentId: number,
  removeExistingMesh: boolean = false,
  layerName: string,
  maybeExtraInfo?: AdHocMeshInfo,
): Saga<void> {
  const layer = Model.getLayerByName(layerName);

  if (segmentId === 0) {
    return;
  }

  yield* call([Model, Model.ensureSavedState]);

  const meshExtraInfo = yield* call(getMeshExtraInfo, layer.name, maybeExtraInfo);

  const { zoomStep, magInfo } = yield* call(getInfoForMeshLoading, layer, meshExtraInfo);
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
      magInfo,
      removeExistingMesh,
    ),
    cancel: take(
      ((action: Action) =>
        action.type === "REMOVE_MESH" &&
        action.segmentId === segmentId &&
        action.layerName === layer.name) as ActionPattern,
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
  // remove it from the store's state as well.
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
  magInfo: MagInfo,
  removeExistingMesh: boolean,
): Saga<void> {
  let isInitialRequest = true;
  const { mappingName, mappingType, opacity } = meshExtraInfo;
  const clippedPosition = clipPositionToCubeBoundary(position, zoomStep, magInfo);
  yield* put(
    addAdHocMeshAction(
      layer.name,
      segmentId,
      position,
      additionalCoordinates,
      mappingName,
      mappingType,
      opacity || Constants.DEFAULT_MESH_OPACITY,
    ),
  );
  yield* put(startedLoadingMeshAction(layer.name, segmentId));

  const cubeSize = marchingCubeSizeInTargetMag();
  const tracingStoreHost = yield* select((state) => state.annotation.tracingStore.url);
  const mag = magInfo.getMagByIndexOrThrow(zoomStep);

  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  const visibleSegmentationLayer = yield* select((state) => getVisibleSegmentationLayer(state));
  // Fetch from datastore if no volumetracing ...
  let useDataStore = volumeTracing == null || visibleSegmentationLayer?.tracingId == null;
  if (meshExtraInfo.useDataStore != null) {
    // ... except if the caller specified whether to use the data store ...
    useDataStore = meshExtraInfo.useDataStore;
  } else if (volumeTracing?.hasEditableMapping) {
    // ... or if an editable mapping is active.
    useDataStore = false;
  }

  // Segment stats can only be used for volume tracings that have a segment index
  // and that don't have editable mappings.
  const usePositionsFromSegmentIndex =
    volumeTracing?.hasSegmentIndex &&
    !volumeTracing.hasEditableMapping &&
    visibleSegmentationLayer?.tracingId != null;
  let positionsToRequest = usePositionsFromSegmentIndex
    ? yield* getChunkPositionsFromSegmentIndex(
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
      magInfo,
      isInitialRequest,
      removeExistingMesh && isInitialRequest,
      useDataStore,
      !usePositionsFromSegmentIndex,
    );
    isInitialRequest = false;

    // If we are using the positions from the segment index, the backend will
    // send an empty neighbors array, as it's not necessary to have them.
    if (usePositionsFromSegmentIndex && neighbors.length > 0) {
      throw new Error("Retrieved neighbor positions even though these were not requested.");
    }
    positionsToRequest = positionsToRequest.concat(neighbors);
  }

  yield* put(finishedLoadingMeshAction(layer.name, segmentId));
}

function* getChunkPositionsFromSegmentIndex(
  tracingStoreHost: string,
  layer: DataLayer,
  segmentId: number,
  cubeSize: Vector3,
  mag: Vector3,
  clippedPosition: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | null | undefined,
) {
  const targetMagPositions = yield* call(
    getBucketPositionsForAdHocMesh,
    tracingStoreHost,
    layer.name,
    segmentId,
    cubeSize,
    mag,
    additionalCoordinates,
  );
  const mag1Positions = targetMagPositions.map((pos) => V3.scale3(pos, mag));
  return sortByDistanceTo(mag1Positions, clippedPosition) as Vector3[];
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
  magInfo: MagInfo,
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
  const scaleFactor = yield* select((state) => state.dataset.dataSource.scale.factor);
  const dataStoreHost = yield* select((state) => state.dataset.dataStore.url);
  const owningOrganization = yield* select((state) => state.dataset.owningOrganization);
  const datasetDirectoryName = yield* select((state) => state.dataset.directoryName);
  const tracingStoreHost = yield* select((state) => state.annotation.tracingStore.url);
  const dataStoreUrl = `${dataStoreHost}/data/datasets/${owningOrganization}/${datasetDirectoryName}/layers/${
    layer.fallbackLayer != null ? layer.fallbackLayer : layer.name
  }`;
  const tracingStoreUrl = `${tracingStoreHost}/tracings/volume/${layer.name}`;

  const mag = magInfo.getMagByIndexOrThrow(zoomStep);

  if (isInitialRequest) {
    sendAnalyticsEvent("request_isosurface", {
      mode: useDataStore ? "view" : "annotation",
    });
  }

  let retryCount = 0;

  const { segmentMeshController } = getSceneController();

  const cubeSize = marchingCubeSizeInTargetMag();

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
          cubeSize,
          scaleFactor,
          findNeighbors,
          ...meshExtraInfo,
        },
      );
      const vertices = new Float32Array(responseBuffer);

      if (removeExistingMesh) {
        segmentMeshController.removeMeshById(segmentId, layer.name);
      }

      const opacity = meshExtraInfo.opacity || Constants.DEFAULT_MESH_OPACITY;

      // We await addMeshFromVerticesAsync here, because the mesh saga will remove
      // an ad-hoc loaded mesh immediately if it was "empty". Since the check is
      // done by looking at the scene, we await the population of the scene.
      // Theoretically, this could be built differently so that other ad-hoc chunks
      // can be loaded in parallel to addMeshFromVerticesAsync. However, it's unclear
      // how big the bottleneck really is.
      yield* call(
        { fn: segmentMeshController.addMeshFromVerticesAsync, context: segmentMeshController },
        vertices,
        segmentId,
        layer.name,
        opacity,
        additionalCoordinates,
      );
      return neighbors.map((neighbor) =>
        getNeighborPosition(clippedPosition, neighbor, zoomStep, magInfo),
      );
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
      refreshMeshWithMap,
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
        meshInfo.opacity,
        layerName,
      ),
    );
  } else {
    if (adhocMeshesMapByLayer[additionalCoordKey] == null) return;
    const threeDMap = adhocMeshesMapByLayer[additionalCoordKey][action.layerName].get(segmentId);
    if (threeDMap == null) {
      return;
    }
    yield* call(
      refreshMeshWithMap,
      segmentId,
      threeDMap,
      layerName,
      additionalCoordinates,
      meshInfo.opacity,
    );
  }
}

function* refreshMeshWithMap(
  segmentId: number,
  threeDMap: ThreeDMap<boolean>,
  layerName: string,
  additionalCoordinates: AdditionalCoordinate[] | null,
  opacity: number = Constants.DEFAULT_MESH_OPACITY,
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
        opacity,
      },
    );
    shouldBeRemoved = false;
  }
}

export default function* adHocMeshSaga(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_READY
  const loadAdHocMeshActionChannel = yield* actionChannel("LOAD_AD_HOC_MESH_ACTION");

  yield* call(ensureSceneControllerReady);
  yield* call(ensureWkReady);
  yield* takeEvery(loadAdHocMeshActionChannel, loadAdHocMeshFromAction);
  yield* takeEvery("REMOVE_MESH", removeMesh);
  yield* takeEvery("REFRESH_MESHES", refreshMeshes);
  yield* takeEvery("REFRESH_MESH", refreshMesh);
  yield* takeEvery(["START_EDITING", "COPY_SEGMENTATION_LAYER"], markEditedCellAsDirty);
}
