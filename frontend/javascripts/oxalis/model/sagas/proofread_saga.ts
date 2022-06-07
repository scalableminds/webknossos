import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery, put, call, all } from "typed-redux-saga";
import { select, take } from "oxalis/model/sagas/effect-generators";
import { AnnotationToolEnum, MappingStatusEnum, Vector3 } from "oxalis/constants";
import Toast from "libs/toast";
import {
  DeleteEdgeAction,
  deleteTreeAction,
  loadAgglomerateSkeletonAction,
  MergeTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  initializeEditableMappingAction,
  setMappingisEditableAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { ProofreadAtPositionAction } from "oxalis/model/actions/proofread_actions";
import {
  enforceSkeletonTracing,
  findTreeByName,
  findTreeByNodeId,
} from "oxalis/model/accessors/skeletontracing_accessor";
import {
  pushSaveQueueTransaction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import { splitAgglomerate, mergeAgglomerate } from "oxalis/model/sagas/update_actions";
import Model from "oxalis/model";
import api from "oxalis/api/internal_api";
import {
  getActiveSegmentationTracingLayer,
  getActiveSegmentationTracing,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getMappingInfo,
  getResolutionInfo,
  ResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { makeMappingEditable } from "admin/admin_rest_api";
import {
  setMappingNameAction,
  updateTemporarySettingAction,
} from "oxalis/model/actions/settings_actions";
import { getSegmentIdForPosition } from "oxalis/controller/combinations/volume_handlers";
import { loadAdHocMeshAction } from "oxalis/model/actions/segmentation_actions";
import { V3 } from "libs/mjs";
import { removeIsosurfaceAction } from "oxalis/model/actions/annotation_actions";
import { loadAgglomerateSkeletonWithId } from "oxalis/model/sagas/skeletontracing_saga";

export default function* proofreadMapping(): Saga<any> {
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* take("WK_READY");
  yield* takeEvery(["DELETE_EDGE", "MERGE_TREES"], splitOrMergeAgglomerate);
  yield* takeEvery(["PROOFREAD_AT_POSITION"], proofreadAtPosition);
}

function proofreadCoarseResolutionIndex(): number {
  // @ts-ignore
  return window.__proofreadCoarseResolutionIndex != null
    ? // @ts-ignore
      window.__proofreadCoarseResolutionIndex
    : 3;
}
function proofreadFineResolutionIndex(): number {
  // @ts-ignore
  return window.__proofreadFineResolutionIndex != null
    ? // @ts-ignore
      window.__proofreadFineResolutionIndex
    : 2;
}
function proofreadUsingMeshes(): boolean {
  // @ts-ignore
  return window.__proofreadUsingMeshes != null ? window.__proofreadUsingMeshes : true;
}
function proofreadSegmentSurroundNm(): number {
  // @ts-ignore
  return window.__proofreadSurroundNm != null ? window.__proofreadSurroundNm : 2000;
}
let oldSegmentIdsInSurround: number[] | null = null;

function* loadCoarseAdHocMesh(
  layerName: string,
  resolutionInfo: ResolutionInfo,
  segmentId: number,
  position: Vector3,
): Saga<void> {
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;

  const activeMappingByLayer = yield* select(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  const mappingInfo = getMappingInfo(activeMappingByLayer, layerName);
  const { mappingName, mappingType } = mappingInfo;

  // Load the whole agglomerate mesh in a coarse resolution for performance reasons
  const oldPreferredQuality = yield* select(
    (state) => state.temporaryConfiguration.preferredQualityForMeshAdHocComputation,
  );

  const resolutionIndices = resolutionInfo.getAllIndices();
  const coarseResolutionIndex =
    resolutionIndices[Math.min(proofreadCoarseResolutionIndex(), resolutionIndices.length - 1)];
  yield* put(
    updateTemporarySettingAction("preferredQualityForMeshAdHocComputation", coarseResolutionIndex),
  );

  // Use the data store if the mapping is not editable yet. If it, is request the mesh from the tracing store.
  const useDataStore = !volumeTracing.mappingIsEditable;
  yield* put(
    loadAdHocMeshAction(segmentId, position, {
      mappingName,
      mappingType,
      passive: true,
      useDataStore,
    }),
  );
  yield* put(
    updateTemporarySettingAction("preferredQualityForMeshAdHocComputation", oldPreferredQuality),
  );
}

function* proofreadAtPosition(action: ProofreadAtPositionAction): Saga<void> {
  const { position } = action;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null || volumeTracingLayer.tracingId == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;

  const resolutionInfo = getResolutionInfo(volumeTracingLayer.resolutions);

  const layerName = volumeTracingLayer.tracingId;
  const segmentId = getSegmentIdForPosition(position);
  const { mappingName } = volumeTracing;

  if (mappingName == null) return;

  const treeName = yield* call(
    loadAgglomerateSkeletonWithId,
    loadAgglomerateSkeletonAction(layerName, mappingName, segmentId),
  );

  if (!proofreadUsingMeshes()) return;

  yield* call(loadCoarseAdHocMesh, layerName, resolutionInfo, segmentId, position);

  if (treeName == null) return;

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.tracing));
  const { trees } = skeletonTracing;
  const tree = findTreeByName(trees, treeName).getOrElse(null);

  if (tree == null) return;

  // Find all segments (nodes) that are within x µm to load meshes in oversegmentation
  const nodePositions = tree.nodes.map((node) => node.position);
  const distanceSquared = proofreadSegmentSurroundNm() ** 2;
  const scale = yield* select((state) => state.dataset.dataSource.scale);

  const nodePositionsInSurround = nodePositions.filter(
    (nodePosition) => V3.scaledSquaredDist(nodePosition, position, scale) <= distanceSquared,
  );
  const mag = resolutionInfo.getLowestResolution();

  const fallbackLayerName = volumeTracingLayer.fallbackLayer;
  if (fallbackLayerName == null) return;

  // Request unmapped segmentation ids
  const segmentIdsArrayBuffers: ArrayBuffer[] = yield* all(
    nodePositionsInSurround.map((nodePosition) =>
      call(
        [api.data, api.data.getRawDataCuboid],
        fallbackLayerName,
        nodePosition,
        V3.add(nodePosition, mag),
      ),
    ),
  );
  // HACK: This only works for uint32 segmentations
  const segmentIdsInSurround = segmentIdsArrayBuffers.map((buffer) => new Uint32Array(buffer)[0]);

  if (oldSegmentIdsInSurround != null) {
    // Remove old meshes in oversegmentation
    yield* all(
      oldSegmentIdsInSurround.map((nodeSegmentId) =>
        put(removeIsosurfaceAction(layerName, nodeSegmentId)),
      ),
    );
  }

  oldSegmentIdsInSurround = segmentIdsInSurround;

  // Load meshes in oversegmentation in fine resolution
  const noMappingInfo = {
    mappingName: null,
    mappingType: null,
    useDataStore: true,
  };
  const oldPreferredQuality = yield* select(
    (state) => state.temporaryConfiguration.preferredQualityForMeshAdHocComputation,
  );
  yield* put(
    updateTemporarySettingAction(
      "preferredQualityForMeshAdHocComputation",
      proofreadFineResolutionIndex(),
    ),
  );
  yield* all(
    segmentIdsInSurround.map((nodeSegmentId, index) =>
      put(
        loadAdHocMeshAction(
          nodeSegmentId,
          nodePositionsInSurround[index],
          noMappingInfo,
          layerName,
        ),
      ),
    ),
  );
  yield* put(
    updateTemporarySettingAction("preferredQualityForMeshAdHocComputation", oldPreferredQuality),
  );
}

function* splitOrMergeAgglomerate(action: MergeTreesAction | DeleteEdgeAction) {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  if (activeTool !== AnnotationToolEnum.PROOFREAD) return;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;
  const { tracingId: volumeTracingId } = volumeTracing;

  const layerName = volumeTracingLayer.name;
  const activeMappingByLayer = yield* select(
    (state) => state.temporaryConfiguration.activeMappingByLayer,
  );
  const mappingInfo = getMappingInfo(activeMappingByLayer, layerName);
  const { mappingName, mappingType, mappingStatus } = mappingInfo;
  if (
    mappingName == null ||
    mappingType !== "HDF5" ||
    mappingStatus === MappingStatusEnum.DISABLED
  ) {
    Toast.error("An HDF5 mapping needs to be enabled to use the proofreading tool.");
  }

  if (!volumeTracing.mappingIsEditable) {
    const tracingStoreUrl = yield* select((state) => state.tracing.tracingStore.url);
    // Save before making the mapping editable to make sure the correct mapping is activated in the backend
    yield* call([Model, Model.ensureSavedState]);
    // Get volume tracing again to make sure the version is up to date
    const upToDateVolumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
    if (upToDateVolumeTracing == null) return;

    const serverEditableMapping = yield* call(
      makeMappingEditable,
      tracingStoreUrl,
      volumeTracingId,
    );
    // The server increments the volume tracing's version by 1 when switching the mapping to an editable one
    yield* put(
      setVersionNumberAction(upToDateVolumeTracing.version + 1, "volume", volumeTracingId),
    );
    yield* put(setMappingNameAction(layerName, serverEditableMapping.mappingName));
    yield* put(setMappingisEditableAction());
    yield* put(initializeEditableMappingAction(serverEditableMapping));
  }

  const resolutionInfo = getResolutionInfo(volumeTracingLayer.resolutions);
  // The mag the agglomerate skeleton corresponds to should be the finest available mag of the volume tracing layer
  const agglomerateFileMag = resolutionInfo.getLowestResolution();
  const agglomerateFileZoomstep = resolutionInfo.getLowestResolutionIndex();
  const { sourceNodeId, targetNodeId } = action;

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.tracing));

  const { trees } = skeletonTracing;
  const sourceTree = findTreeByNodeId(trees, sourceNodeId).getOrElse(null);
  const targetTree = findTreeByNodeId(trees, targetNodeId).getOrElse(null);

  if (sourceTree == null || targetTree == null) {
    return;
  }

  const sourceNodePosition = sourceTree.nodes.get(sourceNodeId).position;
  const targetNodePosition = targetTree.nodes.get(targetNodeId).position;
  const sourceNodeAgglomerateId = yield* call(
    [api.data, api.data.getDataValue],
    layerName,
    sourceNodePosition,
    agglomerateFileZoomstep,
  );
  const targetNodeAgglomerateId = yield* call(
    [api.data, api.data.getDataValue],
    layerName,
    targetNodePosition,
    agglomerateFileZoomstep,
  );

  const items = [];
  if (action.type === "MERGE_TREES") {
    if (sourceNodeAgglomerateId === targetNodeAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      return;
    }
    items.push(
      mergeAgglomerate(
        sourceNodeAgglomerateId,
        targetNodeAgglomerateId,
        sourceNodePosition,
        targetNodePosition,
        agglomerateFileMag,
      ),
    );
  } else if (action.type === "DELETE_EDGE") {
    if (sourceNodeAgglomerateId !== targetNodeAgglomerateId) {
      Toast.error("Segments that should be split need to be in the same agglomerate.");
      return;
    }
    items.push(
      splitAgglomerate(
        sourceNodeAgglomerateId,
        sourceNodePosition,
        targetNodePosition,
        agglomerateFileMag,
      ),
    );
  }

  if (items.length === 0) return;

  yield* put(pushSaveQueueTransaction(items, "mapping", volumeTracingId));
  yield* call([Model, Model.ensureSavedState]);

  yield* call([api.data, api.data.reloadBuckets], layerName);

  const volumeTracingWithEditableMapping = yield* select((state) =>
    getActiveSegmentationTracing(state),
  );
  if (
    volumeTracingWithEditableMapping == null ||
    volumeTracingWithEditableMapping.mappingName == null
  )
    return;

  const newSourceNodeAgglomerateId = yield* call(
    [api.data, api.data.getDataValue],
    layerName,
    sourceNodePosition,
    agglomerateFileZoomstep,
  );

  const newTargetNodeAgglomerateId = yield* call(
    [api.data, api.data.getDataValue],
    layerName,
    targetNodePosition,
    agglomerateFileZoomstep,
  );

  // Remove old agglomerate skeleton(s) and load new agglomerate skeleton(s)
  yield* put(deleteTreeAction(sourceTree.treeId));
  if (sourceTree !== targetTree) {
    yield* put(deleteTreeAction(targetTree.treeId));
  }

  yield* call(
    loadAgglomerateSkeletonWithId,
    loadAgglomerateSkeletonAction(
      layerName,
      volumeTracingWithEditableMapping.mappingName,
      newSourceNodeAgglomerateId,
    ),
  );
  if (newTargetNodeAgglomerateId !== newSourceNodeAgglomerateId) {
    yield* call(
      loadAgglomerateSkeletonWithId,
      loadAgglomerateSkeletonAction(
        layerName,
        volumeTracingWithEditableMapping.mappingName,
        newTargetNodeAgglomerateId,
      ),
    );
  }

  if (proofreadUsingMeshes()) {
    // Remove old over segmentation meshes
    if (oldSegmentIdsInSurround != null) {
      // Remove old meshes in oversegmentation
      yield* all(
        oldSegmentIdsInSurround.map((nodeSegmentId) =>
          put(removeIsosurfaceAction(layerName, nodeSegmentId)),
        ),
      );
      oldSegmentIdsInSurround = null;
    }

    // Remove old agglomerate mesh(es) and load new agglomerate mesh(es)
    yield* put(removeIsosurfaceAction(layerName, sourceNodeAgglomerateId));
    if (targetNodeAgglomerateId !== sourceNodeAgglomerateId) {
      yield* put(removeIsosurfaceAction(layerName, targetNodeAgglomerateId));
    }

    yield* call(
      loadCoarseAdHocMesh,
      layerName,
      resolutionInfo,
      newSourceNodeAgglomerateId,
      sourceNodePosition,
    );
    if (newTargetNodeAgglomerateId !== newSourceNodeAgglomerateId) {
      yield* call(
        loadCoarseAdHocMesh,
        layerName,
        resolutionInfo,
        newTargetNodeAgglomerateId,
        targetNodePosition,
      );
    }
  }
}
