import type { MeshLodInfo } from "admin/api/mesh";
import { getMeshFilesForDatasetLayer, type meshApi } from "admin/rest_api";
import Deferred from "libs/async/deferred";
import processTaskWithPool from "libs/async/task_pool";
import { mergeGeometries } from "libs/BufferGeometryUtils";
import { computeBvhAsync } from "libs/compute_bvh_async";
import { getDracoLoader } from "libs/draco";
import Toast from "libs/toast";
import { sleep } from "libs/utils";
import sortBy from "lodash-es/sortBy";
import zip from "lodash-es/zip";
import messages from "messages";
import type { ActionPattern } from "redux-saga/effects";
import type { BufferGeometry } from "three";
import { actionChannel, all, call, put, race, take, takeEvery } from "typed-redux-saga";
import type {
  AdditionalCoordinate,
  APIDataset,
  APIMeshFileInfo,
  APISegmentationLayer,
} from "types/api_types";
import { WkDevFlags } from "viewer/api/wk_dev";
import type { Vector3, Vector4 } from "viewer/constants";
import Constants from "viewer/constants";
import CustomLOD from "viewer/controller/custom_lod";
import {
  type BufferGeometryWithInfo,
  sortByDistanceTo,
  type UnmergedBufferGeometryWithInfo,
  VertexSegmentMapping,
} from "viewer/controller/mesh_helpers";
import getSceneController from "viewer/controller/scene_controller_provider";
import {
  getSegmentationLayerByName,
  getVisibleSegmentationLayer,
} from "viewer/model/accessors/dataset_accessor";
import {
  getEditableMappingForVolumeTracingId,
  getTracingForSegmentationLayer,
  isTracingLayerWithoutFallback,
} from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  addPrecomputedMeshAction,
  dispatchMaybeFetchMeshFilesAsync,
  finishedLoadingMeshAction,
  type MaybeFetchMeshFilesAction,
  removeMeshAction,
  startedLoadingMeshAction,
  updateCurrentMeshFileAction,
  updateMeshFileListAction,
} from "viewer/model/actions/annotation_actions";
import type { LoadPrecomputedMeshAction } from "viewer/model/actions/segmentation_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import Store from "viewer/store";
import { getBaseSegmentationName } from "viewer/view/right_border_tabs/segments_tab/segments_view_helper";
import { ensureSceneControllerInitialized, ensureWkInitialized } from "../ready_sagas";
import { getMeshExtraInfo } from "./ad_hoc_mesh_saga";
import { acquireMeshWorker, releaseMeshWorker } from "./common_mesh_saga";
import { GlobalMeshChunkProvider } from "./mesh_chunk_provider";
import {
  batchMeshChunksForLoading,
  getMeshChunkData,
  listMeshChunks,
} from "./mesh_chunk_provider_accessors";

const MIN_BATCH_SIZE_IN_BYTES = 2 ** 16;

// TEMPORARY measurement of where the time of a precomputed mesh load goes. The per-chunk steps run
// in up to PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT tasks at once, so their summed times can exceed
// the wall-clock time. The decoding time includes waiting for a free draco worker.
type ChunkStepTimings = {
  chunkCount: number;
  decode: number;
  prepareGeometry: number;
  addToScene: number;
  yieldToEventLoop: number;
};

function logChunkStepTimings(label: string, timings: ChunkStepTimings): void {
  const toMs = (milliseconds: number) => `${milliseconds.toFixed(0)} ms`;
  console.log(
    `${label}: ${timings.chunkCount} chunks, summed over all chunks: decode ${toMs(timings.decode)}, prepare geometry ${toMs(timings.prepareGeometry)}, merge and add intermediate meshes ${toMs(timings.addToScene)}, yield to event loop ${toMs(timings.yieldToEventLoop)}`,
  );
}

// Avoid redundant fetches of mesh files for the same layer by
// storing Deferreds per layer lazily.
let fetchDeferredsPerLayer: Record<string, Deferred<Array<APIMeshFileInfo>, unknown>> = {};
function* maybeFetchMeshFiles(action: MaybeFetchMeshFilesAction): Saga<void> {
  const { segmentationLayer, dataset, mustRequest, autoActivate, callback } = action;

  // Only an segmentation | tracing layer with an existing fallback layer can have meshFiles.
  if (!segmentationLayer || isTracingLayerWithoutFallback(segmentationLayer)) {
    callback([]);
    return;
  }

  const layerName = segmentationLayer.name;

  function* maybeActivateMeshFile(availableMeshFiles: APIMeshFileInfo[]) {
    const currentMeshFile = yield* select(
      (state) => state.localSegmentationStateByLayer[layerName].currentMeshFile,
    );
    if (!currentMeshFile && availableMeshFiles.length > 0 && autoActivate) {
      yield* put(updateCurrentMeshFileAction(layerName, availableMeshFiles[0].name));
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
  const deferred = new Deferred<Array<APIMeshFileInfo>, unknown>();
  fetchDeferredsPerLayer[layerName] = deferred;
  if (mustRequest) {
    // The mesh files might have been recomputed, so cached chunks can't be trusted anymore.
    GlobalMeshChunkProvider.clear();
  }

  const availableMeshFiles = yield* call(
    getMeshFilesForDatasetLayer,
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
  const {
    segmentId,
    seedPosition,
    seedAdditionalCoordinates,
    meshFileName,
    layerName,
    opacity,
    isVisible,
  } = action;
  const layer = yield* select((state) =>
    layerName != null
      ? getSegmentationLayerByName(state.dataset, layerName)
      : getVisibleSegmentationLayer(state),
  );
  if (layer == null) return;

  // Remove older mesh instance if it exists already.
  yield* put(removeMeshAction(layer.name, action.segmentId));

  // If a REMOVE_MESH action is dispatched and consumed
  // here before loadPrecomputedMeshForSegmentId is finished, the latter saga
  // should be canceled automatically to avoid populating mesh data even though
  // the mesh was removed. This is accomplished by redux-saga's race effect.
  console.log("Start loading mesh for", segmentId);
  const { cancel } = yield* race({
    loadPrecomputedMeshForSegmentId: call(
      loadPrecomputedMeshForSegmentId,
      segmentId,
      seedPosition,
      seedAdditionalCoordinates,
      meshFileName,
      layer,
      opacity,
      isVisible,
    ),
    cancel: take(
      ((otherAction: Action) =>
        otherAction.type === "REMOVE_MESH" &&
        otherAction.segmentId === segmentId &&
        otherAction.layerName === layer.name) as ActionPattern,
    ),
  });
  if (cancel) {
    console.log("cancelled loading mesh for", segmentId);
  } else {
    console.log("Finished loading mesh for", segmentId);
  }
}

type ChunksMap = Record<number, Vector3[] | meshApi.MeshChunk[] | null | undefined>;

function* loadPrecomputedMeshForSegmentId(
  segmentId: bigint,
  seedPosition: Vector3,
  seedAdditionalCoordinates: AdditionalCoordinate[] | undefined | null,
  meshFileName: string,
  segmentationLayer: APISegmentationLayer,
  opacity: number | undefined,
  isVisible: boolean | undefined,
): Saga<void> {
  const layerName = segmentationLayer.name;
  const annotationVersion = yield* select((state) => state.annotation.version);
  const mappingName = yield* call(getMappingName, segmentationLayer);
  yield* put(
    addPrecomputedMeshAction(
      layerName,
      segmentId,
      seedPosition,
      seedAdditionalCoordinates,
      meshFileName,
      mappingName,
      opacity,
      isVisible,
    ),
  );
  yield* put(startedLoadingMeshAction(layerName, segmentId));
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

  const meshFile = availableMeshFiles.find((file) => file.name === meshFileName);
  if (!meshFile) {
    Toast.error("Could not load mesh, since the requested mesh file was not found.");
    return;
  }
  if (segmentId === 0n) {
    Toast.error("Could not load mesh, since the clicked segment ID is 0.");
    return;
  }

  // Limit the number of segments that are meshed at the same time. This way,
  // the first meshes are fully visible earlier and the memory pressure of
  // in-flight chunk buffers stays bounded. Note that the loading state for
  // this segment was already set above so that the UI reflects the pending load.
  const timingLabel = `[mesh timing] segment ${segmentId}`;
  console.time(`${timingLabel}: total after mesh file check`);
  console.time(`${timingLabel}: wait for mesh worker slot`);
  yield call(acquireMeshWorker);
  console.timeEnd(`${timingLabel}: wait for mesh worker slot`);
  try {
    let availableChunksMap: ChunksMap = {};
    let chunkScale: Vector3 | null = null;
    let loadingOrder: number[] | null = null;
    let lods: MeshLodInfo[] | null = null;
    try {
      console.time(`${timingLabel}: listing`);
      const chunkDescriptors = yield* call(
        _getChunkLoadingDescriptors,
        segmentId,
        dataset,
        segmentationLayer,
        meshFile,
        annotationVersion,
      );
      lods = chunkDescriptors.segmentInfo.lods;
      availableChunksMap = chunkDescriptors.availableChunksMap;
      chunkScale = chunkDescriptors.segmentInfo.chunkScale;
      loadingOrder = chunkDescriptors.loadingOrder;
      console.timeEnd(`${timingLabel}: listing`);
    } catch (exception) {
      Toast.warning(messages["tracing.mesh_listing_failed"](segmentId));
      console.warn(
        `Mesh chunks for segment ${segmentId} couldn't be loaded due to`,
        exception,
        "\nOne possible explanation could be that the segment was not included in the mesh file because it's smaller than the dust threshold that was specified for the mesh computation.",
      );
      yield* put(finishedLoadingMeshAction(layerName, segmentId));
      yield* put(removeMeshAction(layerName, segmentId));
      return;
    }

    for (const lod of loadingOrder) {
      yield* call(
        loadPrecomputedMeshesInChunksForLod,
        dataset,
        layerName,
        meshFile,
        segmentationLayer,
        segmentId,
        seedPosition,
        availableChunksMap,
        lod,
        (lod: number) => extractScaleFromMatrix(lods[lod].transform),
        chunkScale,
        additionalCoordinates,
        opacity,
      );
    }
  } finally {
    // Also release worker token even when cancelled by a REMOVE_MESH
    // action (see loadPrecomputedMesh).
    yield* call(releaseMeshWorker);
  }

  console.timeEnd(`${timingLabel}: total after mesh file check`);
  yield* put(finishedLoadingMeshAction(layerName, segmentId));
}

function* getMappingName(segmentationLayer: APISegmentationLayer) {
  const meshExtraInfo = yield* call(getMeshExtraInfo, segmentationLayer.name, null);
  const editableMapping = yield* select((state) =>
    getEditableMappingForVolumeTracingId(state, segmentationLayer.tracingId),
  );

  // meshExtraInfo.mappingName contains the currently active mapping
  // (can be the id of an editable mapping). However, we always need to
  // use the mapping name of the on-disk mapping.
  return editableMapping != null ? editableMapping.baseMappingName : meshExtraInfo.mappingName;
}

function* _getChunkLoadingDescriptors(
  segmentId: bigint,
  dataset: APIDataset,
  segmentationLayer: APISegmentationLayer,
  meshFile: APIMeshFileInfo,
  annotationVersion: number,
) {
  const availableChunksMap: ChunksMap = {};
  let loadingOrder: number[] = [];

  const { segmentMeshController } = getSceneController();
  const version = meshFile.formatVersion;

  const editableMapping = yield* select((state) =>
    getEditableMappingForVolumeTracingId(state, segmentationLayer.tracingId),
  );
  const tracing = yield* select((state) =>
    getTracingForSegmentationLayer(state, segmentationLayer),
  );
  const mappingName = yield* call(getMappingName, segmentationLayer);

  if (version < 3) {
    console.warn("The active mesh file uses a version lower than 3, which is not supported");
  }

  // mappingName only exists for versions >= 3
  if (meshFile.mappingName != null && meshFile.mappingName !== mappingName) {
    throw Error(
      `Trying to use a mesh file that was computed for mapping ${meshFile.mappingName} for a requested mapping of ${mappingName}.`,
    );
  }

  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  console.time(`[mesh timing] segment ${segmentId}: listing, listMeshChunks only`);
  const segmentInfo = yield* call(listMeshChunks, {
    dataStoreUrl: dataset.dataStore.url,
    datasetId: dataset.id,
    layerName: getBaseSegmentationName(segmentationLayer),
    meshFile,
    segmentId,
    // The back-end should only receive a non-null mapping name,
    // if it should perform extra (reverse) look ups to compute a mesh
    // with a specific mapping from a mesh file that was computed
    // without a mapping.
    targetMappingName: meshFile.mappingName == null ? mappingName : null,
    editableMapping:
      editableMapping != null && tracing ? { tracingStoreUrl, tracingId: tracing.tracingId } : null,
    annotationVersion,
  });
  console.timeEnd(`[mesh timing] segment ${segmentId}: listing, listMeshChunks only`);
  segmentInfo.lods.forEach((meshLodInfo, lodIndex) => {
    availableChunksMap[lodIndex] = meshLodInfo?.chunks;
    loadingOrder.push(lodIndex);
    meshLodInfo.transform;
  });
  const currentLODGroup: CustomLOD =
    (yield* call(
      {
        context: segmentMeshController,
        fn: segmentMeshController.getLODGroupOfLayer,
      },
      segmentationLayer.name,
    )) ?? new CustomLOD();
  const currentLODIndex = yield* call(
    {
      context: currentLODGroup,
      fn: currentLODGroup.getCurrentLOD,
    },
    Math.max(...loadingOrder),
  );
  // Load the chunks closest to the current LOD first.
  loadingOrder.sort((a, b) => Math.abs(a - currentLODIndex) - Math.abs(b - currentLODIndex));

  return {
    availableChunksMap,
    loadingOrder,
    segmentInfo,
  };
}
function extractScaleFromMatrix(transform: [Vector4, Vector4, Vector4]): Vector3 {
  return [transform[0][0], transform[1][1], transform[2][2]];
}

// Unlike an error thrown inside all(), the returned error doesn't cancel the other pool.
function* processTasksAndReturnError(tasks: Array<() => Saga<void>>): Saga<unknown> {
  try {
    yield* call(processTaskWithPool, tasks, Constants.PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT);
    return null;
  } catch (error) {
    return error;
  }
}

function* loadPrecomputedMeshesInChunksForLod(
  dataset: APIDataset,
  layerName: string,
  meshFile: APIMeshFileInfo,
  segmentationLayer: APISegmentationLayer,
  segmentId: bigint,
  seedPosition: Vector3,
  availableChunksMap: ChunksMap,
  lod: number,
  getGlobalScale: (lod: number) => Vector3 | null,
  chunkScale: Vector3 | null,
  additionalCoordinates: AdditionalCoordinate[] | null,
  opacity: number | undefined,
) {
  const { segmentMeshController } = getSceneController();
  const loader = getDracoLoader();
  if (availableChunksMap[lod] == null) {
    return;
  }
  const availableChunks = availableChunksMap[lod];
  const meshFileLocation = {
    dataStoreUrl: dataset.dataStore.url,
    datasetId: dataset.id,
    layerName: getBaseSegmentationName(segmentationLayer),
    meshFileName: meshFile.name,
  };
  // Sort the chunks by distance to the seedPosition, so that the mesh loads from the inside out
  const sortedAvailableChunks = sortByDistanceTo(availableChunks, seedPosition);

  const { cachedBatches, missingBatches } = batchMeshChunksForLoading(
    meshFileLocation,
    sortedAvailableChunks as meshApi.MeshChunk[],
    MIN_BATCH_SIZE_IN_BYTES,
  );

  const timingLabel = `[mesh timing] segment ${segmentId}, lod ${lod}`;
  const timings: ChunkStepTimings = {
    chunkCount: 0,
    decode: 0,
    prepareGeometry: 0,
    addToScene: 0,
    yieldToEventLoop: 0,
  };
  let bufferGeometries: UnmergedBufferGeometryWithInfo[] = [];
  const cachedChunkGeometries: UnmergedBufferGeometryWithInfo[] = [];

  function* addGeometryToScene(geometry: BufferGeometry, isMerged: boolean): Saga<void> {
    yield* call(
      {
        context: segmentMeshController,
        fn: segmentMeshController.addMeshFromGeometry,
      },
      geometry,
      segmentId,
      // Apply the scale from the segment info, which includes dataset scale and mag
      getGlobalScale(lod),
      lod,
      layerName,
      additionalCoordinates,
      opacity,
      isMerged,
    );
  }

  // Shows chunks before the whole mesh is merged. They are merged into one mesh first, because
  // rendering one mesh per chunk is slow for meshes with thousands of chunks. The intermediate
  // meshes are replaced by the merged mesh at the end.
  function* addIntermediateMesh(chunkGeometries: UnmergedBufferGeometryWithInfo[]): Saga<void> {
    if (
      chunkGeometries.length === 0 ||
      !WkDevFlags.meshing.addPrecomputedMeshChunksToSceneEagerly
    ) {
      return;
    }
    const stepStart = performance.now();
    const geometry = mergeGeometriesOrNull(chunkGeometries);
    if (geometry != null) {
      yield* call(addGeometryToScene, geometry, false);
    }
    timings.addToScene += performance.now() - stepStart;
  }

  // A batch of chunks from the back-end is shown as soon as it is decoded. Cached chunks are
  // decoded within a fraction of a second, so they are collected and shown together, see below.
  function* onBatchDecoded(
    chunkGeometries: UnmergedBufferGeometryWithInfo[],
    isCached: boolean,
  ): Saga<void> {
    if (isCached) {
      cachedChunkGeometries.push(...chunkGeometries);
    } else {
      yield* call(addIntermediateMesh, chunkGeometries);
    }
  }

  const createLoadTask = (chunks: meshApi.MeshChunk[], isCached: boolean) =>
    function* loadChunks(): Saga<void> {
      const dataForChunks = yield* call(getMeshChunkData, meshFileLocation, segmentId, chunks);

      const errorsWithDetails = [];
      const batchGeometries: UnmergedBufferGeometryWithInfo[] = [];

      for (const [chunk, data] of zip(chunks, dataForChunks)) {
        try {
          if (chunk == null || data == null) {
            throw new Error("Unexpected null value.");
          }
          const position = chunk.position;
          timings.chunkCount++;
          let stepStart = performance.now();
          const bufferGeometry = (yield* call(
            loader.decodeDracoFileAsync,
            data,
          )) as UnmergedBufferGeometryWithInfo;
          timings.decode += performance.now() - stepStart;
          stepStart = performance.now();
          bufferGeometry.unmappedSegmentId = chunk.unmappedSegmentId;
          if (chunkScale != null) {
            bufferGeometry.scale(...chunkScale);
          }

          bufferGeometry.translate(position[0], position[1], position[2]);
          // Compute vertex normals to achieve smooth shading. We do this here
          // within the chunk-specific code (instead of after all chunks are merged)
          // to distribute the workload a bit over time.
          bufferGeometry.computeVertexNormals();
          timings.prepareGeometry += performance.now() - stepStart;

          batchGeometries.push(bufferGeometry);
          bufferGeometries.push(bufferGeometry);
        } catch (error) {
          errorsWithDetails.push({ error, chunk });
        }

        // Yield to the event loop after each chunk. Decoding and adding the
        // geometries is mostly synchronous and would otherwise form a tight
        // loop that starves rendering and can even stop the saga middleware
        // silently (see https://github.com/redux-saga/redux-saga/issues/1592).
        const yieldStart = performance.now();
        yield* call(sleep, 0);
        timings.yieldToEventLoop += performance.now() - yieldStart;
      }
      yield* call(onBatchDecoded, batchGeometries, isCached);

      if (errorsWithDetails.length > 0) {
        console.warn("Errors occurred while decoding mesh chunks:", errorsWithDetails);
        // Use first error as representative
        throw errorsWithDetails[0].error;
      }
    };

  function* loadCachedBatches(): Saga<unknown> {
    const error = yield* call(
      processTasksAndReturnError,
      cachedBatches.map((chunks) => createLoadTask(chunks, true)),
    );
    // If all chunks are cached, the merged mesh follows right away, so an intermediate mesh would
    // only be shown for a moment.
    if (missingBatches.length > 0) {
      yield* call(addIntermediateMesh, cachedChunkGeometries);
    }
    return error;
  }

  // Cached batches don't make requests, so they get their own pool instead of waiting for the
  // request slots. Otherwise, one kind of batch would hold up the other.
  console.time(`${timingLabel}: all chunks (wall clock)`);
  const errors = yield* all([
    call(
      processTasksAndReturnError,
      missingBatches.map((chunks) => createLoadTask(chunks, false)),
    ),
    call(loadCachedBatches),
  ]);
  console.timeEnd(`${timingLabel}: all chunks (wall clock)`);
  logChunkStepTimings(timingLabel, timings);
  const error = errors.find((errorOfPool) => errorOfPool != null);
  if (error != null) {
    Toast.warning(`Some mesh chunks could not be loaded for segment ${segmentId}.`);
    console.error(error);
  }

  // Merge Chunks
  const sortedBufferGeometries = sortBy(
    bufferGeometries,
    (geometryWithInfo) => geometryWithInfo.unmappedSegmentId,
  );

  // mergeGeometries will crash if the array is empty. Even if it's not empty,
  // the function might return null or throw (e.g., when the necessary buffers
  // cannot be allocated because of memory pressure).
  let mergedGeometry: BufferGeometryWithInfo | null = null;
  try {
    console.time(`${timingLabel}: merge geometries`);
    mergedGeometry = (
      sortedBufferGeometries.length > 0 ? mergeGeometries(sortedBufferGeometries, false) : null
    ) as BufferGeometryWithInfo | null;
    console.timeEnd(`${timingLabel}: merge geometries`);
    if (mergedGeometry != null) {
      console.time(`${timingLabel}: vertex segment mapping`);
      mergedGeometry.vertexSegmentMapping = new VertexSegmentMapping(sortedBufferGeometries);
      console.timeEnd(`${timingLabel}: vertex segment mapping`);
      console.time(`${timingLabel}: compute bvh`);
      mergedGeometry.boundsTree = yield* call(computeBvhAsync, mergedGeometry);
      console.timeEnd(`${timingLabel}: compute bvh`);
    }
  } catch (exception) {
    mergedGeometry?.dispose();
    mergedGeometry = null;
    console.error(`Failed to merge mesh chunks for segment ${segmentId}:`, exception);
  }

  console.time(`${timingLabel}: replace chunks with merged mesh in scene`);
  // Remove the intermediate meshes (see above).
  yield* call(
    {
      context: segmentMeshController,
      fn: segmentMeshController.removeMeshById,
    },
    segmentId,
    layerName,
    { lod },
  );

  if (mergedGeometry == null) {
    // Don't fail hard. Instead, show the chunks as separate meshes so that the
    // mesh is still rendered. Only features that require the merged geometry
    // (e.g., highlighting of unmapped segments during proofreading) won't work
    // for this mesh.
    console.warn(
      `Falling back to the unmerged mesh chunks for segment ${segmentId}. See errors above for details.`,
    );
    for (const bufferGeometry of bufferGeometries) {
      yield* call(addGeometryToScene, bufferGeometry, false);
    }
    return;
  }

  yield* call(addGeometryToScene, mergedGeometry, true);
  console.timeEnd(`${timingLabel}: replace chunks with merged mesh in scene`);
}

// Returns null if the geometries can't be merged, e.g., because the merged buffers can't be
// allocated.
function mergeGeometriesOrNull(geometries: BufferGeometry[]): BufferGeometry | null {
  try {
    return mergeGeometries(geometries, false);
  } catch (exception) {
    console.warn("Could not merge mesh chunks:", exception);
    return null;
  }
}

export default function* precomputedMeshSaga(): Saga<void> {
  // Buffer actions since they might be dispatched before WK_INITIALIZED
  fetchDeferredsPerLayer = {};
  const maybeFetchMeshFilesActionChannel = yield* actionChannel("MAYBE_FETCH_MESH_FILES");
  const loadPrecomputedMeshActionChannel = yield* actionChannel("LOAD_PRECOMPUTED_MESH_ACTION");

  yield* call(ensureSceneControllerInitialized);
  yield* call(ensureWkInitialized);
  yield* takeEvery(maybeFetchMeshFilesActionChannel, maybeFetchMeshFiles);
  yield* takeEvery(loadPrecomputedMeshActionChannel, loadPrecomputedMesh);
}
