import { saveAs } from "file-saver";
import _ from "lodash";
import { V3 } from "libs/mjs";
import { sleep } from "libs/utils";
import ErrorHandling from "libs/error_handling";
import type { APIMeshFile, APISegmentationLayer } from "types/api_flow_types";
import { mergeVertices } from "libs/BufferGeometryUtils";
import Deferred from "libs/deferred";

import Store from "oxalis/store";
import {
  ResolutionInfo,
  getResolutionInfo,
  getMappingInfo,
  getVisibleSegmentationLayer,
  getSegmentationLayerByName,
} from "oxalis/model/accessors/dataset_accessor";
import {
  LoadAdHocMeshAction,
  LoadPrecomputedMeshAction,
  AdHocIsosurfaceInfo,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import type { Action } from "oxalis/model/actions/actions";
import type { Vector3 } from "oxalis/constants";
import { MappingStatusEnum } from "oxalis/constants";
import {
  ImportIsosurfaceFromStlAction,
  UpdateIsosurfaceVisibilityAction,
  RemoveIsosurfaceAction,
  RefreshIsosurfaceAction,
  TriggerIsosurfaceDownloadAction,
  MaybeFetchMeshFilesAction,
  updateMeshFileListAction,
  updateCurrentMeshFileAction,
  dispatchMaybeFetchMeshFilesAsync,
  removeIsosurfaceAction,
  addAdHocIsosurfaceAction,
  addPrecomputedIsosurfaceAction,
  finishedLoadingIsosurfaceAction,
  startedLoadingIsosurfaceAction,
} from "oxalis/model/actions/annotation_actions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import { actionChannel, takeEvery, call, take, race, put } from "typed-redux-saga";
import { stlIsosurfaceConstants } from "oxalis/view/right-border-tabs/segments_tab/segments_view";
import {
  computeIsosurface,
  sendAnalyticsEvent,
  meshV0,
  meshV3,
  getMeshfilesForDatasetLayer,
} from "admin/admin_rest_api";
import { getFlooredPosition } from "oxalis/model/accessors/flycam_accessor";
import { setImportingMeshStateAction } from "oxalis/model/actions/ui_actions";
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
  getTracingForSegmentationLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import Toast from "libs/toast";
import { getDracoLoader } from "libs/draco";
import messages from "messages";
import processTaskWithPool from "libs/task_pool";
import { getBaseSegmentationName } from "oxalis/view/right-border-tabs/segments_tab/segments_view_helper";
import { RemoveSegmentAction, UpdateSegmentAction } from "../actions/volumetracing_actions";

export const NO_LOD_MESH_INDEX = -1;
const MAX_RETRY_COUNT = 5;
const RETRY_WAIT_TIME = 5000;
const MESH_CHUNK_THROTTLE_DELAY = 500;
const PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT = 6;

// The calculation of an isosurface is spread across multiple requests.
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
const adhocIsosurfacesMapByLayer: Record<string, Map<number, ThreeDMap<boolean>>> = {};
function marchingCubeSizeInMag1(): Vector3 {
  // @ts-ignore
  return window.__marchingCubeSizeInMag1 != null
    ? // @ts-ignore
      window.__marchingCubeSizeInMag1
    : [128, 128, 128];
}
const modifiedCells: Set<number> = new Set();
export function isIsosurfaceStl(buffer: ArrayBuffer): boolean {
  const dataView = new DataView(buffer);
  const isIsosurface = stlIsosurfaceConstants.isosurfaceMarker.every(
    (marker, index) => dataView.getUint8(index) === marker,
  );
  return isIsosurface;
}

function getOrAddMapForSegment(layerName: string, segmentId: number): ThreeDMap<boolean> {
  adhocIsosurfacesMapByLayer[layerName] = adhocIsosurfacesMapByLayer[layerName] || new Map();
  const isosurfacesMap = adhocIsosurfacesMapByLayer[layerName];
  const maybeMap = isosurfacesMap.get(segmentId);

  if (maybeMap == null) {
    const newMap = new ThreeDMap();
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'ThreeDMap<unknown>' is not assig... Remove this comment to see the full error message
    isosurfacesMap.set(segmentId, newMap);
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'ThreeDMap<unknown>' is not assignable to typ... Remove this comment to see the full error message
    return newMap;
  }

  return maybeMap;
}

function removeMapForSegment(layerName: string, segmentId: number): void {
  if (adhocIsosurfacesMapByLayer[layerName] == null) {
    return;
  }

  adhocIsosurfacesMapByLayer[layerName].delete(segmentId);
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
  const neighboringPosition = [
    clippedPosition[0] + neighborMultiplier[0] * marchingCubeSizeInMag1()[0],
    clippedPosition[1] + neighborMultiplier[1] * marchingCubeSizeInMag1()[1],
    clippedPosition[2] + neighborMultiplier[2] * marchingCubeSizeInMag1()[2],
  ];
  // @ts-expect-error ts-migrate(2322) FIXME: Type 'number[]' is not assignable to type 'Vector3... Remove this comment to see the full error message
  return neighboringPosition;
}

function* loadAdHocIsosurfaceFromAction(action: LoadAdHocMeshAction): Saga<void> {
  yield* call(
    loadAdHocIsosurface,
    action.seedPosition,
    action.segmentId,
    false,
    action.layerName,
    action.extraInfo,
  );
}

function* loadAdHocIsosurface(
  seedPosition: Vector3,
  segmentId: number,
  removeExistingIsosurface: boolean = false,
  layerName?: string | null | undefined,
  maybeExtraInfo?: AdHocIsosurfaceInfo,
): Saga<void> {
  const layer =
    layerName != null ? Model.getLayerByName(layerName) : Model.getVisibleSegmentationLayer();

  if (segmentId === 0 || layer == null) {
    return;
  }

  const isosurfaceExtraInfo = yield* call(getIsosurfaceExtraInfo, layer.name, maybeExtraInfo);

  yield* call(
    loadIsosurfaceForSegmentId,
    segmentId,
    seedPosition,
    isosurfaceExtraInfo,
    removeExistingIsosurface,
    layer,
  );
}

function* getIsosurfaceExtraInfo(
  layerName: string,
  maybeExtraInfo: AdHocIsosurfaceInfo | null | undefined,
): Saga<AdHocIsosurfaceInfo> {
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

function* getInfoForIsosurfaceLoading(
  layer: DataLayer,
  isosurfaceExtraInfo: AdHocIsosurfaceInfo,
): Saga<{
  zoomStep: number;
  resolutionInfo: ResolutionInfo;
}> {
  const resolutionInfo = getResolutionInfo(layer.resolutions);
  const preferredZoomStep =
    isosurfaceExtraInfo.preferredQuality != null
      ? isosurfaceExtraInfo.preferredQuality
      : yield* select(
          (state) => state.temporaryConfiguration.preferredQualityForMeshAdHocComputation,
        );
  const zoomStep = resolutionInfo.getClosestExistingIndex(preferredZoomStep);
  return {
    zoomStep,
    resolutionInfo,
  };
}

function* loadIsosurfaceForSegmentId(
  segmentId: number,
  seedPosition: Vector3,
  isosurfaceExtraInfo: AdHocIsosurfaceInfo,
  removeExistingIsosurface: boolean,
  layer: DataLayer,
): Saga<void> {
  const { zoomStep, resolutionInfo } = yield* call(
    getInfoForIsosurfaceLoading,
    layer,
    isosurfaceExtraInfo,
  );
  batchCounterPerSegment[segmentId] = 0;
  // If a REMOVE_ISOSURFACE action is dispatched and consumed
  // here before loadIsosurfaceWithNeighbors is finished, the latter saga
  // should be canceled automatically to avoid populating mesh data even though
  // the mesh was removed. This is accomplished by redux-saga's race effect.
  yield* race({
    loadIsosurfaceWithNeighbors: call(
      loadIsosurfaceWithNeighbors,
      layer,
      segmentId,
      seedPosition,
      zoomStep,
      isosurfaceExtraInfo,
      resolutionInfo,
      removeExistingIsosurface,
    ),
    cancel: take(
      (action: Action) =>
        action.type === "REMOVE_ISOSURFACE" &&
        action.segmentId === segmentId &&
        action.layerName === layer.name,
    ),
  });
}

function* loadIsosurfaceWithNeighbors(
  layer: DataLayer,
  segmentId: number,
  position: Vector3,
  zoomStep: number,
  isosurfaceExtraInfo: AdHocIsosurfaceInfo,
  resolutionInfo: ResolutionInfo,
  removeExistingIsosurface: boolean,
): Saga<void> {
  let isInitialRequest = true;
  const { mappingName, mappingType } = isosurfaceExtraInfo;
  const clippedPosition = clipPositionToCubeBoundary(position);
  let positionsToRequest = [clippedPosition];
  yield* put(addAdHocIsosurfaceAction(layer.name, segmentId, position, mappingName, mappingType));
  yield* put(startedLoadingIsosurfaceAction(layer.name, segmentId));

  while (positionsToRequest.length > 0) {
    const currentPosition = positionsToRequest.shift();
    if (currentPosition == null) {
      throw new Error("Satisfy typescript");
    }

    const neighbors = yield* call(
      maybeLoadIsosurface,
      layer,
      segmentId,
      currentPosition,
      zoomStep,
      isosurfaceExtraInfo,
      resolutionInfo,
      isInitialRequest,
      removeExistingIsosurface && isInitialRequest,
    );
    isInitialRequest = false;
    positionsToRequest = positionsToRequest.concat(neighbors);
  }

  yield* put(finishedLoadingIsosurfaceAction(layer.name, segmentId));
}

function hasMeshChunkExceededThrottleLimit(segmentId: number): boolean {
  return batchCounterPerSegment[segmentId] > MESH_CHUNK_THROTTLE_LIMIT;
}

function* maybeLoadIsosurface(
  layer: DataLayer,
  segmentId: number,
  clippedPosition: Vector3,
  zoomStep: number,
  isosurfaceExtraInfo: AdHocIsosurfaceInfo,
  resolutionInfo: ResolutionInfo,
  isInitialRequest: boolean,
  removeExistingIsosurface: boolean,
): Saga<Vector3[]> {
  const threeDMap = getOrAddMapForSegment(layer.name, segmentId);

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
  // @ts-expect-error ts-migrate(2339) FIXME: Property '__isosurfaceSubsamplingStrides' does not... Remove this comment to see the full error message
  const subsamplingStrides = window.__isosurfaceSubsamplingStrides || [1, 1, 1];
  const scale = yield* select((state) => state.dataset.dataSource.scale);
  const dataStoreHost = yield* select((state) => state.dataset.dataStore.url);
  const owningOrganization = yield* select((state) => state.dataset.owningOrganization);
  const datasetName = yield* select((state) => state.dataset.name);
  const tracingStoreHost = yield* select((state) => state.tracing.tracingStore.url);
  const dataStoreUrl = `${dataStoreHost}/data/datasets/${owningOrganization}/${datasetName}/layers/${
    layer.fallbackLayer != null ? layer.fallbackLayer : layer.name
  }`;
  const tracingStoreUrl = `${tracingStoreHost}/tracings/volume/${layer.name}`;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  // Fetch from datastore if no volumetracing ...
  let useDataStore = volumeTracing == null;
  if (isosurfaceExtraInfo.useDataStore != null) {
    // ... except if the caller specified whether to use the data store ...
    useDataStore = isosurfaceExtraInfo.useDataStore;
  } else if (volumeTracing?.mappingIsEditable) {
    // ... or if an editable mapping is active.
    useDataStore = false;
  }
  const mag = resolutionInfo.getResolutionByIndexOrThrow(zoomStep);

  if (isInitialRequest) {
    sendAnalyticsEvent("request_isosurface", {
      mode: useDataStore ? "view" : "annotation",
    });
  }

  let retryCount = 0;

  const { segmentMeshController } = getSceneController();

  while (retryCount < MAX_RETRY_COUNT) {
    try {
      const { buffer: responseBuffer, neighbors } = yield* call(
        {
          context: null,
          fn: computeIsosurface,
        },
        useDataStore ? dataStoreUrl : tracingStoreUrl,
        {
          position: clippedPosition,
          mag,
          segmentId,
          subsamplingStrides,
          cubeSize: getZoomedCubeSize(zoomStep, resolutionInfo),
          scale,
          ...isosurfaceExtraInfo,
        },
      );
      const vertices = new Float32Array(responseBuffer);

      if (removeExistingIsosurface) {
        segmentMeshController.removeIsosurfaceById(segmentId, layer.name);
      }

      segmentMeshController.addIsosurfaceFromVertices(vertices, segmentId, layer.name);
      return neighbors.map((neighbor) => getNeighborPosition(clippedPosition, neighbor));
    } catch (exception) {
      retryCount++;
      // @ts-ignore
      ErrorHandling.notify(exception);
      console.warn("Retrying mesh generation...");
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

function* refreshIsosurfaces(): Saga<void> {
  yield* put(saveNowAction());
  // We reload all cells that got modified till the start of reloading.
  // By that we avoid to remove cells that got annotated during reloading from the modifiedCells set.
  const currentlyModifiedCells = new Set(modifiedCells);
  modifiedCells.clear();
  const segmentationLayer = Model.getVisibleSegmentationLayer();

  if (!segmentationLayer) {
    return;
  }

  adhocIsosurfacesMapByLayer[segmentationLayer.name] =
    adhocIsosurfacesMapByLayer[segmentationLayer.name] || new Map();
  const isosurfacesMapForLayer = adhocIsosurfacesMapByLayer[segmentationLayer.name];

  for (const [segmentId, threeDMap] of Array.from(isosurfacesMapForLayer.entries())) {
    if (!currentlyModifiedCells.has(segmentId)) {
      continue;
    }

    yield* call(_refreshIsosurfaceWithMap, segmentId, threeDMap, segmentationLayer.name);
  }
}

function* refreshIsosurface(action: RefreshIsosurfaceAction): Saga<void> {
  const { segmentId, layerName } = action;

  const isosurfaceInfo = yield* select(
    (state) => state.localSegmentationData[layerName].isosurfaces[segmentId],
  );

  if (isosurfaceInfo.isPrecomputed) {
    yield* put(removeIsosurfaceAction(layerName, isosurfaceInfo.segmentId));
    yield* put(
      loadPrecomputedMeshAction(
        isosurfaceInfo.segmentId,
        isosurfaceInfo.seedPosition,
        isosurfaceInfo.meshFileName,
        layerName,
      ),
    );
  } else {
    const threeDMap = adhocIsosurfacesMapByLayer[action.layerName].get(segmentId);
    if (threeDMap == null) return;
    yield* call(_refreshIsosurfaceWithMap, segmentId, threeDMap, layerName);
  }
}

function* _refreshIsosurfaceWithMap(
  segmentId: number,
  threeDMap: ThreeDMap<boolean>,
  layerName: string,
): Saga<void> {
  const isosurfaceInfo = yield* select(
    (state) => state.localSegmentationData[layerName].isosurfaces[segmentId],
  );
  yield* call(
    [ErrorHandling, ErrorHandling.assert],
    !isosurfaceInfo.isPrecomputed,
    "_refreshIsosurfaceWithMap was called for a precomputed isosurface.",
  );
  if (isosurfaceInfo.isPrecomputed) return;
  const { mappingName, mappingType } = isosurfaceInfo;
  const isosurfacePositions = threeDMap.entries().filter(([value, _position]) => value);

  if (isosurfacePositions.length === 0) {
    return;
  }

  yield* put(startedLoadingIsosurfaceAction(layerName, segmentId));
  // Remove isosurface from cache.
  yield* call(removeIsosurface, removeIsosurfaceAction(layerName, segmentId), false);
  // The isosurface should only be removed once after re-fetching the isosurface first position.
  let shouldBeRemoved = true;

  for (const [, position] of isosurfacePositions) {
    // Reload the isosurface at the given position if it isn't already loaded there.
    // This is done to ensure that every voxel of the isosurface is reloaded.
    yield* call(loadAdHocIsosurface, position, segmentId, shouldBeRemoved, layerName, {
      mappingName,
      mappingType,
    });
    shouldBeRemoved = false;
  }

  yield* put(finishedLoadingIsosurfaceAction(layerName, segmentId));
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
  const { segmentId, seedPosition, meshFileName, layerName } = action;
  const layer = yield* select((state) =>
    layerName != null
      ? getSegmentationLayerByName(state.dataset, layerName)
      : getVisibleSegmentationLayer(state),
  );
  if (layer == null) return;
  // If a REMOVE_ISOSURFACE action is dispatched and consumed
  // here before loadPrecomputedMeshForSegmentId is finished, the latter saga
  // should be canceled automatically to avoid populating mesh data even though
  // the mesh was removed. This is accomplished by redux-saga's race effect.
  yield* race({
    loadPrecomputedMeshForSegmentId: call(
      loadPrecomputedMeshForSegmentId,
      segmentId,
      seedPosition,
      meshFileName,
      layer,
    ),
    cancel: take(
      // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'otherAction' implicitly has an 'any' ty... Remove this comment to see the full error message
      (otherAction) =>
        otherAction.type === "REMOVE_ISOSURFACE" &&
        otherAction.segmentId === segmentId &&
        otherAction.layerName === layer.name,
    ),
  });
}

type ChunksMap = Record<number, Vector3[] | meshV3.MeshChunk[] | null | undefined>;

function* loadPrecomputedMeshForSegmentId(
  id: number,
  seedPosition: Vector3,
  meshFileName: string,
  segmentationLayer: APISegmentationLayer,
): Saga<void> {
  const layerName = segmentationLayer.name;
  yield* put(addPrecomputedIsosurfaceAction(layerName, id, seedPosition, meshFileName));
  yield* put(startedLoadingIsosurfaceAction(layerName, id));
  const dataset = yield* select((state) => state.dataset);
  const { segmentMeshController } = yield* call(getSceneController);
  const currentLODIndex = yield* call({
    context: segmentMeshController.isosurfacesLODRootGroup,
    fn: segmentMeshController.isosurfacesLODRootGroup.getCurrentLOD,
  });

  let availableChunksMap: ChunksMap = {};
  let scale: Vector3 | null = null;
  let loadingOrder: number[] = [];

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

  const version = meshFile.formatVersion;
  try {
    const isosurfaceExtraInfo = yield* call(getIsosurfaceExtraInfo, segmentationLayer.name, null);

    const editableMapping = yield* select((state) =>
      getEditableMappingForVolumeTracingId(state, segmentationLayer.tracingId),
    );
    const tracing = yield* select((state) =>
      getTracingForSegmentationLayer(state, segmentationLayer),
    );
    const mappingName =
      // isosurfaceExtraInfo.mappingName contains the currently active mapping
      // (can be the id of an editable mapping). However, we always need to
      // use the mapping name of the on-disk mapping.
      editableMapping != null ? editableMapping.baseMappingName : isosurfaceExtraInfo.mappingName;

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
      scale = [
        segmentInfo.transform[0][0],
        segmentInfo.transform[1][1],
        segmentInfo.transform[2][2],
      ];
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
  } catch (exception) {
    console.warn("Mesh chunk couldn't be loaded due to", exception);
    Toast.warning(messages["tracing.mesh_listing_failed"]);
    yield* put(finishedLoadingIsosurfaceAction(layerName, id));
    yield* put(removeIsosurfaceAction(layerName, id));
    return;
  }

  const loadChunksTasks = _.compact(
    _.flatten(
      loadingOrder.map((lod) => {
        if (availableChunksMap[lod] == null) {
          return;
        }
        const availableChunks = availableChunksMap[lod];
        // Sort the chunks by distance to the seedPosition, so that the mesh loads from the inside out
        const sortedAvailableChunks = _.sortBy(
          availableChunks,
          (chunk: Vector3 | meshV3.MeshChunk) =>
            V3.length(V3.sub(seedPosition, "position" in chunk ? chunk.position : chunk)),
        ) as Array<Vector3> | Array<meshV3.MeshChunk>;

        const tasks = sortedAvailableChunks.map(
          (chunk) =>
            function* loadChunk(): Saga<void> {
              if ("position" in chunk) {
                // V3
                const dracoData = yield* call(
                  meshV3.getMeshfileChunkData,
                  dataset.dataStore.url,
                  dataset,
                  getBaseSegmentationName(segmentationLayer),
                  meshFileName,
                  chunk.byteOffset,
                  chunk.byteSize,
                );
                const loader = getDracoLoader();

                const geometry = yield* call(loader.decodeDracoFileAsync, dracoData);
                // Compute vertex normals to achieve smooth shading
                geometry.computeVertexNormals();

                yield* call(
                  {
                    context: segmentMeshController,
                    fn: segmentMeshController.addIsosurfaceFromGeometry,
                  },
                  geometry,
                  id,
                  chunk.position,
                  // Apply the scale from the segment info, which includes dataset scale and mag
                  scale,
                  lod,
                  layerName,
                );
              } else {
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
                    fn: segmentMeshController.addIsosurfaceFromGeometry,
                  },
                  geometry,
                  id,
                  null,
                  null,
                  lod,
                  layerName,
                );
              }
            },
        );
        return tasks;
      }),
    ),
  );

  try {
    yield* call(processTaskWithPool, loadChunksTasks, PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT);
  } catch (exception) {
    console.error(exception);
    Toast.warning("Some mesh objects could not be loaded.");
  }

  yield* put(finishedLoadingIsosurfaceAction(layerName, id));
}

/*
 *
 * Ad Hoc and Precomputed Meshes
 *
 */
function* downloadIsosurfaceCellById(
  cellName: string,
  segmentId: number,
  layerName: string,
): Saga<void> {
  const { segmentMeshController } = getSceneController();
  const geometry = segmentMeshController.getIsosurfaceGeometryInBestLOD(segmentId, layerName);

  if (geometry == null) {
    const errorMessage = messages["tracing.not_isosurface_available_to_download"];
    Toast.error(errorMessage, {
      sticky: false,
    });
    return;
  }

  const stl = exportToStl(geometry);
  // Encode isosurface and cell id property
  const { isosurfaceMarker, segmentIdIndex } = stlIsosurfaceConstants;
  isosurfaceMarker.forEach((marker, index) => {
    stl.setUint8(index, marker);
  });
  stl.setUint32(segmentIdIndex, segmentId, true);
  const blob = new Blob([stl]);
  yield* call(saveAs, blob, `${cellName}-${segmentId}.stl`);
}

function* downloadIsosurfaceCell(action: TriggerIsosurfaceDownloadAction): Saga<void> {
  yield* call(downloadIsosurfaceCellById, action.cellName, action.segmentId, action.layerName);
}

function* importIsosurfaceFromStl(action: ImportIsosurfaceFromStlAction): Saga<void> {
  const { layerName, buffer } = action;
  const dataView = new DataView(buffer);
  const segmentId = dataView.getUint32(stlIsosurfaceConstants.segmentIdIndex, true);
  const geometry = yield* call(parseStlBuffer, buffer);
  getSceneController().segmentMeshController.addIsosurfaceFromGeometry(
    geometry,
    segmentId,
    null,
    null,
    NO_LOD_MESH_INDEX,
    layerName,
  );
  yield* put(setImportingMeshStateAction(false));
  // TODO: Ideally, persist the seed position in the STL file. As a workaround,
  // we simply use the current position as a seed position.
  const seedPosition = yield* select((state) => getFlooredPosition(state.flycam));
  // TODO: This code is not used currently and it will not be possible to share these
  // isosurfaces via link.
  // The mesh file the isosurface was computed from is not known.
  yield* put(addPrecomputedIsosurfaceAction(layerName, segmentId, seedPosition, "unknown"));
}

function* handleRemoveSegment(action: RemoveSegmentAction) {
  // The dispatched action will make sure that the isosurface entry is removed from the
  // store **and** from the scene. Otherwise, the store will still contain a reference
  // to the mesh even though it's not in the scene, anymore.
  yield* put(removeIsosurfaceAction(action.layerName, action.segmentId));
}

function removeIsosurface(action: RemoveIsosurfaceAction, removeFromScene: boolean = true): void {
  const { layerName } = action;
  const segmentId = action.segmentId;

  if (removeFromScene) {
    getSceneController().segmentMeshController.removeIsosurfaceById(segmentId, layerName);
  }

  removeMapForSegment(layerName, segmentId);
}

function* handleIsosurfaceVisibilityChange(action: UpdateIsosurfaceVisibilityAction): Saga<void> {
  const { id, visibility, layerName } = action;
  const { segmentMeshController } = yield* call(getSceneController);
  segmentMeshController.setIsosurfaceVisibility(id, visibility, layerName);
}

function* handleIsosurfaceColorChange(action: UpdateSegmentAction): Saga<void> {
  const { segmentMeshController } = yield* call(getSceneController);
  if ("color" in action.segment) {
    segmentMeshController.setIsosurfaceColor(action.segmentId, action.layerName);
  }
}

export default function* isosurfaceSaga(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_READY
  const loadAdHocMeshActionChannel = yield* actionChannel("LOAD_AD_HOC_MESH_ACTION");
  const loadPrecomputedMeshActionChannel = yield* actionChannel("LOAD_PRECOMPUTED_MESH_ACTION");
  const maybeFetchMeshFilesActionChannel = yield* actionChannel("MAYBE_FETCH_MESH_FILES");

  yield* take("SCENE_CONTROLLER_READY");
  yield* take("WK_READY");
  yield* takeEvery(maybeFetchMeshFilesActionChannel, maybeFetchMeshFiles);
  yield* takeEvery(loadAdHocMeshActionChannel, loadAdHocIsosurfaceFromAction);
  yield* takeEvery(loadPrecomputedMeshActionChannel, loadPrecomputedMesh);
  yield* takeEvery("TRIGGER_ISOSURFACE_DOWNLOAD", downloadIsosurfaceCell);
  yield* takeEvery("IMPORT_ISOSURFACE_FROM_STL", importIsosurfaceFromStl);
  yield* takeEvery("REMOVE_ISOSURFACE", removeIsosurface);
  yield* takeEvery("REMOVE_SEGMENT", handleRemoveSegment);
  yield* takeEvery("REFRESH_ISOSURFACES", refreshIsosurfaces);
  yield* takeEvery("REFRESH_ISOSURFACE", refreshIsosurface);
  yield* takeEvery("UPDATE_ISOSURFACE_VISIBILITY", handleIsosurfaceVisibilityChange);
  yield* takeEvery(["START_EDITING", "COPY_SEGMENTATION_LAYER"], markEditedCellAsDirty);
  yield* takeEvery("UPDATE_SEGMENT", handleIsosurfaceColorChange);
}
