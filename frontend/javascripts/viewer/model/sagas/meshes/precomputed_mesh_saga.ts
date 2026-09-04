import type { MeshLodInfo } from "admin/api/mesh";
import { getMeshFilesForDatasetLayer, meshApi } from "admin/rest_api";
import Deferred from "libs/async/deferred";
import processTaskWithPool from "libs/async/task_pool";
import { mergeGeometries } from "libs/BufferGeometryUtils";
import { computeBvhAsync } from "libs/compute_bvh_async";
import { getDracoLoader } from "libs/draco";
import Toast from "libs/toast";
import { chunkDynamically, sleep } from "libs/utils";
import sortBy from "lodash-es/sortBy";
import zip from "lodash-es/zip";
import messages from "messages";
import type { ActionPattern } from "redux-saga/effects";
import { actionChannel, call, put, race, take, takeEvery } from "typed-redux-saga";
import type {
  AdditionalCoordinate,
  APIDataset,
  APIMeshFileInfo,
  APISegmentationLayer,
} from "types/api_types";
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

const MIN_BATCH_SIZE_IN_BYTES = 2 ** 16;

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
  yield call(acquireMeshWorker);
  try {
    let availableChunksMap: ChunksMap = {};
    let chunkScale: Vector3 | null = null;
    let loadingOrder: number[] | null = null;
    let lods: MeshLodInfo[] | null = null;
    try {
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

// Exported so the proofreading merge orchestration (segment_and_mesh_refresh_sagas.ts) can list
// the full, current chunk set of a (possibly just-merged) agglomerate id, in order to diff it
// against what's already loaded for one side of a merge and fetch only the missing delta chunks
// (see fetchAndMergePrecomputedChunks below).
export function* _getChunkLoadingDescriptors(
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

  const segmentInfo = yield* call(
    meshApi.getMeshFileChunksForSegment,
    dataset.dataStore.url,
    dataset.id,
    getBaseSegmentationName(segmentationLayer),
    meshFile,
    segmentId,
    // The back-end should only receive a non-null mapping name,
    // if it should perform extra (reverse) look ups to compute a mesh
    // with a specific mapping from a mesh file that was computed
    // without a mapping.
    meshFile.mappingName == null ? mappingName : null,
    editableMapping != null && tracing ? tracing.tracingId : null,
    annotationVersion,
  );
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
  // Sort the chunks by distance to the seedPosition, so that the mesh loads from the inside out
  const sortedAvailableChunks = sortByDistanceTo(availableChunks, seedPosition);

  const batches = chunkDynamically(
    sortedAvailableChunks as meshApi.MeshChunk[],
    MIN_BATCH_SIZE_IN_BYTES,
    (chunk) => chunk.byteSize,
  );

  // TODO(#9932): this batch-fetch/decode/tag/scale/translate/computeVertexNormals loop (through
  // the mergeGeometries/VertexSegmentMapping/computeBvhAsync step below) is duplicated almost
  // verbatim in fetchAndMergePrecomputedChunks further down this file, which was added later for
  // the proofreading merge-delta-fetch path instead of factoring a shared helper out of this
  // function. The two differ only in: this one eagerly adds each decoded chunk to the scene before
  // merging (see the addMeshFromGeometry call below) and collects/reports per-chunk errors via
  // errorsWithDetails, while fetchAndMergePrecomputedChunks skips the eager scene-add (by design -
  // it's for a small delta merge, not a full progressive load) and silently skips missing
  // chunks/data instead of collecting errors. Worth extracting a shared
  // "fetch+decode+tag+transform a batch of chunks into UnmergedBufferGeometryWithInfo[]" helper
  // (and, separately, a shared "sort+mergeGeometries+VertexSegmentMapping+computeBvhAsync" helper
  // for the merge step both do afterwards) that both callers parametrize over the eager-add/error-
  // handling behavior they need.
  let bufferGeometries: UnmergedBufferGeometryWithInfo[] = [];
  const tasks = batches.map(
    (chunks) =>
      function* loadChunks(): Saga<void> {
        const dataForChunks = yield* call(
          meshApi.getMeshFileChunkData,
          dataset.dataStore.url,
          dataset.id,
          getBaseSegmentationName(segmentationLayer),
          {
            meshFileName: meshFile.name,
            // Only extract the relevant properties
            requests: chunks.map(({ byteOffset, byteSize }) => ({
              byteOffset,
              byteSize,
              segmentId,
            })),
          },
        );

        const errorsWithDetails = [];

        for (const [chunk, data] of zip(chunks, dataForChunks)) {
          try {
            if (chunk == null || data == null) {
              throw new Error("Unexpected null value.");
            }
            const position = chunk.position;
            const bufferGeometry = (yield* call(
              loader.decodeDracoFileAsync,
              data,
            )) as UnmergedBufferGeometryWithInfo;
            bufferGeometry.unmappedSegmentId = chunk.unmappedSegmentId;
            if (chunkScale != null) {
              bufferGeometry.scale(...chunkScale);
            }

            bufferGeometry.translate(position[0], position[1], position[2]);
            // Compute vertex normals to achieve smooth shading. We do this here
            // within the chunk-specific code (instead of after all chunks are merged)
            // to distribute the workload a bit over time.
            bufferGeometry.computeVertexNormals();

            // Eagerly add the chunk geometry so that they will be rendered
            // as soon as possible. These chunks will be removed later and then
            // replaced by a merged geometry so that we have better performance
            // for large meshes.
            yield* call(
              {
                context: segmentMeshController,
                fn: segmentMeshController.addMeshFromGeometry,
              },
              bufferGeometry,
              segmentId,
              // Apply the scale from the segment info, which includes dataset scale and mag
              getGlobalScale(lod),
              lod,
              layerName,
              additionalCoordinates,
              opacity,
              false,
            );

            bufferGeometries.push(bufferGeometry);
          } catch (error) {
            errorsWithDetails.push({ error, chunk });
          }

          // Yield to the event loop after each chunk. Decoding and adding the
          // geometries is mostly synchronous and would otherwise form a tight
          // loop that starves rendering and can even stop the saga middleware
          // silently (see https://github.com/redux-saga/redux-saga/issues/1592).
          yield* call(sleep, 0);
        }

        if (errorsWithDetails.length > 0) {
          console.warn("Errors occurred while decoding mesh chunks:", errorsWithDetails);
          // Use first error as representative
          throw errorsWithDetails[0].error;
        }
      },
  );

  try {
    yield* call(processTaskWithPool, tasks, Constants.PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT);
  } catch (exception) {
    Toast.warning(`Some mesh chunks could not be loaded for segment ${segmentId}.`);
    console.error(exception);
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
    mergedGeometry = (
      sortedBufferGeometries.length > 0 ? mergeGeometries(sortedBufferGeometries, false) : null
    ) as BufferGeometryWithInfo | null;
    if (mergedGeometry != null) {
      mergedGeometry.vertexSegmentMapping = new VertexSegmentMapping(sortedBufferGeometries);
      mergedGeometry.boundsTree = yield* call(computeBvhAsync, mergedGeometry);
    }
  } catch (exception) {
    mergedGeometry?.dispose();
    mergedGeometry = null;
    console.error(`Failed to merge mesh chunks for segment ${segmentId}:`, exception);
  }

  if (mergedGeometry == null) {
    // Don't fail hard. Instead, keep the eagerly added chunk meshes (see above)
    // so that the mesh is still rendered. Only features that require the merged
    // geometry (e.g., highlighting of unmapped segments during proofreading)
    // won't work for this mesh.
    console.warn(
      `Falling back to the unmerged mesh chunks for segment ${segmentId}. See errors above for details.`,
    );
    return;
  }

  // Remove the eagerly added chunks (see above).
  yield* call(
    {
      context: segmentMeshController,
      fn: segmentMeshController.removeMeshById,
    },
    segmentId,
    layerName,
    { lod },
  );

  // Add the final merged geometry.
  yield* call(
    {
      context: segmentMeshController,
      fn: segmentMeshController.addMeshFromGeometry,
    },
    mergedGeometry,
    segmentId,
    // Apply the scale from the segment info, which includes dataset scale and mag
    getGlobalScale(lod),
    lod,
    layerName,
    additionalCoordinates,
    opacity,
    true,
  );
}

/**
 * Fetches and decodes an explicit, already-known list of mesh-file chunks (no chunk-listing
 * round-trip - the caller already knows which chunks it wants), merging them into a single
 * geometry with an attached VertexSegmentMapping. Unlike loadPrecomputedMeshesInChunksForLod
 * above, this doesn't eagerly add individual chunks to the scene before merging them - it's used
 * by the proofreading merge orchestration (local_mesh_change_sagas.ts) to fetch only the
 * "delta" chunks belonging to the not-yet-loaded side of a merge, which is typically a small,
 * one-shot addition rather than a full progressive load.
 *
 * TODO(#9932): the fetch/decode/tag/scale/translate/computeVertexNormals/merge pipeline below
 * duplicates loadPrecomputedMeshesInChunksForLod above almost verbatim - see the TODO on that
 * function for what a shared extraction could look like.
 */
export function* fetchAndMergePrecomputedChunks(
  dataset: APIDataset,
  meshFile: APIMeshFileInfo,
  segmentationLayer: APISegmentationLayer,
  segmentIdForRequest: bigint,
  chunks: meshApi.MeshChunk[],
  chunkScale: Vector3 | null,
): Saga<BufferGeometryWithInfo | null> {
  if (chunks.length === 0) return null;
  const loader = getDracoLoader();
  const batches = chunkDynamically(chunks, MIN_BATCH_SIZE_IN_BYTES, (chunk) => chunk.byteSize);

  const bufferGeometries: UnmergedBufferGeometryWithInfo[] = [];
  const tasks = batches.map(
    (batchChunks) =>
      function* loadChunks(): Saga<void> {
        const dataForChunks = yield* call(
          meshApi.getMeshFileChunkData,
          dataset.dataStore.url,
          dataset.id,
          getBaseSegmentationName(segmentationLayer),
          {
            meshFileName: meshFile.name,
            requests: batchChunks.map(({ byteOffset, byteSize }) => ({
              byteOffset,
              byteSize,
              segmentId: segmentIdForRequest,
            })),
          },
        );

        for (const [chunk, data] of zip(batchChunks, dataForChunks)) {
          if (chunk == null || data == null) continue;
          const position = chunk.position;
          const bufferGeometry = (yield* call(
            loader.decodeDracoFileAsync,
            data,
          )) as UnmergedBufferGeometryWithInfo;
          bufferGeometry.unmappedSegmentId = chunk.unmappedSegmentId;
          if (chunkScale != null) {
            bufferGeometry.scale(...chunkScale);
          }
          bufferGeometry.translate(position[0], position[1], position[2]);
          bufferGeometry.computeVertexNormals();
          bufferGeometries.push(bufferGeometry);
          yield* call(sleep, 0);
        }
      },
  );

  try {
    yield* call(processTaskWithPool, tasks, Constants.PARALLEL_PRECOMPUTED_MESH_LOADING_COUNT);
  } catch (exception) {
    Toast.warning(`Some mesh chunks could not be loaded for segment ${segmentIdForRequest}.`);
    console.error(exception);
  }

  const sortedBufferGeometries = sortBy(
    bufferGeometries,
    (geometryWithInfo) => geometryWithInfo.unmappedSegmentId,
  );
  if (sortedBufferGeometries.length === 0) return null;

  try {
    const mergedGeometry = mergeGeometries(
      sortedBufferGeometries,
      false,
    ) as BufferGeometryWithInfo | null;
    if (mergedGeometry != null) {
      mergedGeometry.vertexSegmentMapping = new VertexSegmentMapping(sortedBufferGeometries);
      mergedGeometry.boundsTree = yield* call(computeBvhAsync, mergedGeometry);
    }
    return mergedGeometry;
  } catch (exception) {
    console.error(`Failed to merge mesh chunks for segment ${segmentIdForRequest}:`, exception);
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
