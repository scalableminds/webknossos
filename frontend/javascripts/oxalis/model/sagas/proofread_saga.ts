import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery, put, call, all } from "typed-redux-saga";
import { select, take } from "oxalis/model/sagas/effect-generators";
import { AnnotationToolEnum, MappingStatusEnum, Vector3 } from "oxalis/constants";
import Toast from "libs/toast";
import {
  DeleteEdgeAction,
  loadAgglomerateSkeletonAction,
  MergeTreesAction,
  setTreeNameAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  initializeEditableMappingAction,
  setMappingIsEditableAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { ProofreadAtPositionAction } from "oxalis/model/actions/proofread_actions";
import {
  enforceSkeletonTracing,
  findTreeByName,
  findTreeByNodeId,
  getTreeNameForAgglomerateSkeleton,
} from "oxalis/model/accessors/skeletontracing_accessor";
import {
  pushSaveQueueTransaction,
  setVersionNumberAction,
  undoAction,
} from "oxalis/model/actions/save_actions";
import { splitAgglomerate, mergeAgglomerate } from "oxalis/model/sagas/update_actions";
import Model from "oxalis/model";
import api from "oxalis/api/internal_api";
import {
  getActiveSegmentationTracingLayer,
  getActiveSegmentationTracing,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getLayerByName,
  getMappingInfo,
  getResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { makeMappingEditable } from "admin/admin_rest_api";
import { setMappingNameAction } from "oxalis/model/actions/settings_actions";
import { getSegmentIdForPosition } from "oxalis/controller/combinations/volume_handlers";
import { loadAdHocMeshAction } from "oxalis/model/actions/segmentation_actions";
import { V3 } from "libs/mjs";
import { removeIsosurfaceAction } from "oxalis/model/actions/annotation_actions";
import { loadAgglomerateSkeletonWithId } from "oxalis/model/sagas/skeletontracing_saga";
import { getConstructorForElementClass } from "oxalis/model/bucket_data_handling/bucket";
import { Tree } from "oxalis/store";
import { APISegmentationLayer } from "types/api_flow_types";

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
// The default of 0 effectively disables the loading of the high-quality meshes of
// the oversegmentation by default
function proofreadSegmentProximityNm(): number {
  // @ts-ignore
  return window.__proofreadProximityNm != null ? window.__proofreadProximityNm : 0;
}
let oldSegmentIdsInProximity: number[] | null = null;

function* loadCoarseAdHocMesh(layerName: string, segmentId: number, position: Vector3): Saga<void> {
  const mappingInfo = yield* select((state) =>
    getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
  );
  const { mappingName, mappingType } = mappingInfo;

  // Load the whole agglomerate mesh in a coarse resolution for performance reasons
  const preferredQuality = proofreadCoarseResolutionIndex();
  yield* put(
    loadAdHocMeshAction(segmentId, position, {
      mappingName,
      mappingType,
      passive: true,
      preferredQuality,
    }),
  );
}

function* proofreadAtPosition(action: ProofreadAtPositionAction): Saga<void> {
  const { position } = action;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null || volumeTracingLayer.tracingId == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;

  const layerName = volumeTracingLayer.tracingId;
  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, layerName);
  if (!isHdf5MappingEnabled || volumeTracing.mappingName == null) return;

  const segmentId = getSegmentIdForPosition(position);

  /* Load agglomerate skeleton of the agglomerate at the click position */

  const treeName = yield* call(
    loadAgglomerateSkeletonWithId,
    loadAgglomerateSkeletonAction(layerName, volumeTracing.mappingName, segmentId),
  );

  if (!proofreadUsingMeshes()) return;

  /* Load a coarse ad hoc mesh of the agglomerate at the click position */

  yield* call(loadCoarseAdHocMesh, layerName, segmentId, position);

  if (treeName == null) return;

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.tracing));
  const { trees } = skeletonTracing;
  const tree = findTreeByName(trees, treeName).getOrElse(null);
  if (tree == null) return;

  yield* call(loadFineAdHocMeshesInProximity, layerName, volumeTracingLayer, tree, position);
}

function* loadFineAdHocMeshesInProximity(
  layerName: string,
  volumeTracingLayer: APISegmentationLayer,
  tree: Tree,
  position: Vector3,
): Saga<void> {
  /* Find all segments (nodes) of the agglomerate skeleton within proofreadSegmentProximityNm (graph distance)
     and request the segment IDs in the oversegmentation at the node positions */

  if (proofreadSegmentProximityNm() <= 0) return;

  const nodePositions = tree.nodes.map((node) => node.position);
  const proximityDistanceSquared = proofreadSegmentProximityNm() ** 2;
  const scale = yield* select((state) => state.dataset.dataSource.scale);

  const nodePositionsInProximity = nodePositions.filter(
    (nodePosition) =>
      V3.scaledSquaredDist(nodePosition, position, scale) <= proximityDistanceSquared,
  );
  const resolutionInfo = getResolutionInfo(volumeTracingLayer.resolutions);
  const mag = resolutionInfo.getLowestResolution();

  const fallbackLayerName = volumeTracingLayer.fallbackLayer;
  if (fallbackLayerName == null) return;

  // Request unmapped segmentation ids
  const segmentIdsArrayBuffers: ArrayBuffer[] = yield* all(
    nodePositionsInProximity.map((nodePosition) =>
      call(
        [api.data, api.data.getRawDataCuboid],
        fallbackLayerName,
        nodePosition,
        V3.add(nodePosition, mag),
      ),
    ),
  );

  const { elementClass } = yield* select((state) => getLayerByName(state.dataset, layerName));
  const [TypedArrayClass] = getConstructorForElementClass(elementClass);
  const segmentIdsInProximity = segmentIdsArrayBuffers.map(
    (buffer) => new TypedArrayClass(buffer)[0],
  );

  if (oldSegmentIdsInProximity != null) {
    const segmentIdsInProximitySet = new Set(segmentIdsInProximity);
    // Remove old meshes in oversegmentation
    yield* all(
      oldSegmentIdsInProximity.map((nodeSegmentId) =>
        // Only remove meshes that are not part of the new proximity set
        segmentIdsInProximitySet.has(nodeSegmentId)
          ? null
          : put(removeIsosurfaceAction(layerName, nodeSegmentId)),
      ),
    );
  }

  oldSegmentIdsInProximity = [...segmentIdsInProximity];

  /* Load fine ad hoc meshes of the segments in the oversegmentation in the proximity of the click position */

  const noMappingInfo = {
    mappingName: null,
    mappingType: null,
    useDataStore: true,
    preferredQuality: proofreadFineResolutionIndex(),
  };
  yield* all(
    segmentIdsInProximity.map((nodeSegmentId, index) =>
      put(
        loadAdHocMeshAction(
          nodeSegmentId,
          nodePositionsInProximity[index],
          noMappingInfo,
          layerName,
        ),
      ),
    ),
  );
}

function* createEditableMapping(): Saga<void> {
  const tracingStoreUrl = yield* select((state) => state.tracing.tracingStore.url);
  // Save before making the mapping editable to make sure the correct mapping is activated in the backend
  yield* call([Model, Model.ensureSavedState]);
  // Get volume tracing again to make sure the version is up to date
  const upToDateVolumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (upToDateVolumeTracing == null) return;

  const volumeTracingId = upToDateVolumeTracing.tracingId;
  const layerName = volumeTracingId;
  const serverEditableMapping = yield* call(makeMappingEditable, tracingStoreUrl, volumeTracingId);
  // The server increments the volume tracing's version by 1 when switching the mapping to an editable one
  yield* put(setVersionNumberAction(upToDateVolumeTracing.version + 1, "volume", volumeTracingId));
  yield* put(setMappingNameAction(layerName, serverEditableMapping.mappingName, "HDF5"));
  yield* put(setMappingIsEditableAction());
  yield* put(initializeEditableMappingAction(serverEditableMapping));
}

function* ensureHdf5MappingIsEnabled(layerName: string): Saga<boolean> {
  const mappingInfo = yield* select((state) =>
    getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
  );
  const { mappingName, mappingType, mappingStatus } = mappingInfo;
  if (
    mappingName == null ||
    mappingType !== "HDF5" ||
    mappingStatus === MappingStatusEnum.DISABLED
  ) {
    Toast.error("An HDF5 mapping needs to be enabled to use the proofreading tool.");
    return false;
  }

  return true;
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

  const layerName = volumeTracingId;
  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, layerName);
  if (!isHdf5MappingEnabled) return;

  if (!volumeTracing.mappingIsEditable) {
    try {
      yield* call(createEditableMapping);
    } catch (e) {
      console.error(e);
      // Undo the last splitting/merging action since the proofreading action did not succeed
      yield* put(undoAction());
      return;
    }
  }

  /* Find out the agglomerate IDs at the two node positions */

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

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

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

  /* Reload the segmentation */

  yield* call([api.data, api.data.reloadBuckets], layerName);

  const volumeTracingWithEditableMapping = yield* select((state) =>
    getActiveSegmentationTracing(state),
  );
  if (
    volumeTracingWithEditableMapping == null ||
    volumeTracingWithEditableMapping.mappingName == null
  ) {
    return;
  }

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

  /* Rename agglomerate skeleton(s) according to their new id and mapping name */

  yield* put(
    setTreeNameAction(
      getTreeNameForAgglomerateSkeleton(
        newSourceNodeAgglomerateId,
        volumeTracingWithEditableMapping.mappingName,
      ),
      sourceTree.treeId,
    ),
  );
  if (sourceTree !== targetTree) {
    yield* put(
      setTreeNameAction(
        getTreeNameForAgglomerateSkeleton(
          newTargetNodeAgglomerateId,
          volumeTracingWithEditableMapping.mappingName,
        ),
        targetTree.treeId,
      ),
    );
  }

  /* Remove old meshes and load updated meshes */

  if (proofreadUsingMeshes()) {
    // Remove old over segmentation meshes
    if (oldSegmentIdsInProximity != null) {
      // Remove old meshes in oversegmentation
      yield* all(
        oldSegmentIdsInProximity.map((nodeSegmentId) =>
          put(removeIsosurfaceAction(layerName, nodeSegmentId)),
        ),
      );
      oldSegmentIdsInProximity = null;
    }

    // Remove old agglomerate mesh(es) and load updated agglomerate mesh(es)
    yield* put(removeIsosurfaceAction(layerName, sourceNodeAgglomerateId));
    if (targetNodeAgglomerateId !== sourceNodeAgglomerateId) {
      yield* put(removeIsosurfaceAction(layerName, targetNodeAgglomerateId));
    }

    yield* call(loadCoarseAdHocMesh, layerName, newSourceNodeAgglomerateId, sourceNodePosition);
    if (newTargetNodeAgglomerateId !== newSourceNodeAgglomerateId) {
      yield* call(loadCoarseAdHocMesh, layerName, newTargetNodeAgglomerateId, targetNodePosition);
    }
  }
}
