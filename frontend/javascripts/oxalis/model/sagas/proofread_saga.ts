import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery, put, call, all } from "typed-redux-saga";
import { select, take } from "oxalis/model/sagas/effect-generators";
import { AnnotationToolEnum, MappingStatusEnum, Vector3 } from "oxalis/constants";
import Toast from "libs/toast";
import {
  deleteEdgeAction,
  DeleteEdgeAction,
  deleteTreeAction,
  loadAgglomerateSkeletonAction,
  MergeTreesAction,
  MinCutAgglomerateAction,
  setTreeNameAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  initializeEditableMappingAction,
  setMappingIsEditableAction,
} from "oxalis/model/actions/volumetracing_actions";
import type {
  ProofreadAtPositionAction,
  ProofreadMergeAction,
} from "oxalis/model/actions/proofread_actions";
import {
  enforceSkeletonTracing,
  findTreeByName,
  findTreeByNodeId,
  getActiveTree,
  getTreeNameForAgglomerateSkeleton,
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
  getLayerByName,
  getMappingInfo,
  getResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import { getEdgesForAgglomerateMinCut, makeMappingEditable } from "admin/admin_rest_api";
import { setMappingNameAction } from "oxalis/model/actions/settings_actions";
import { getSegmentIdForPositionAsync } from "oxalis/controller/combinations/volume_handlers";
import { loadAdHocMeshAction } from "oxalis/model/actions/segmentation_actions";
import { V3 } from "libs/mjs";
import { removeIsosurfaceAction } from "oxalis/model/actions/annotation_actions";
import { loadAgglomerateSkeletonWithId } from "oxalis/model/sagas/skeletontracing_saga";
import {
  getConstructorForElementClass,
  TypedArrayConstructor,
} from "oxalis/model/bucket_data_handling/bucket";
import { Tree, VolumeTracing } from "oxalis/store";
import { APISegmentationLayer } from "types/api_flow_types";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import _ from "lodash";

export default function* proofreadRootSaga(): Saga<any> {
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* take("WK_READY");
  yield* takeEvery(
    ["DELETE_EDGE", "MERGE_TREES", "MIN_CUT_AGGLOMERATE"],
    splitOrMergeOrMinCutAgglomerate,
  );
  yield* takeEvery(["PROOFREAD_AT_POSITION"], proofreadAtPosition);
  yield* takeEvery(["CLEAR_PROOFREADING_BY_PRODUCTS"], clearProofreadingByproducts);
  yield* takeEvery(["PROOFREAD_MERGE", "PROOFREAD_SPLIT"], handleProofreadMergeAndSplit);
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
let coarselyLoadedSegmentIds: number[] = [];

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
  coarselyLoadedSegmentIds.push(segmentId);
}

let loadedAgglomerateSkeletonIds: number[] = [];

function* proofreadAtPosition(action: ProofreadAtPositionAction): Saga<void> {
  const { position } = action;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null || volumeTracingLayer.tracingId == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;

  const layerName = volumeTracingLayer.tracingId;
  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, layerName);
  if (!isHdf5MappingEnabled || volumeTracing.mappingName == null) return;

  const segmentId = yield* call(getSegmentIdForPositionAsync, position);

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

  loadedAgglomerateSkeletonIds.push(tree.treeId);

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

  const getUnmappedDataValue = yield* call(createGetUnmappedDataValueFn, volumeTracingLayer);
  if (!getUnmappedDataValue) {
    return;
  }

  // Request unmapped segmentation ids
  const segmentIdsInProximity = yield* all(
    nodePositionsInProximity.map((nodePosition) => call(getUnmappedDataValue, nodePosition)),
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

let currentlyPerformingMinCut = false;

function* splitOrMergeOrMinCutAgglomerate(
  action: MergeTreesAction | DeleteEdgeAction | MinCutAgglomerateAction,
) {
  // Prevent this method from running recursively into itself during Min-Cut.
  if (currentlyPerformingMinCut) {
    return;
  }
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const activeTool = yield* select((state) => state.uiInformation.activeTool);
  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;
  const { tracingId: volumeTracingId } = volumeTracing;

  if (activeTool !== AnnotationToolEnum.PROOFREAD) {
    // Warn the user if an editable mapping is active and an agglomerate skeleton edge was added/deleted,
    // but the proofreading mode was not active
    if (volumeTracing.mappingIsEditable) {
      Toast.warning(
        "In order to edit the active mapping by deleting or adding edges, the proofreading tool needs to be active." +
          " If you want your last action to edit the active mapping, undo it (Ctrl + Z), activate the proofreading tool and then manually redo the action.",
        { timeout: 12000 },
      );
    }
    return;
  }

  const preparation = yield* call(
    prepareSplitOrMerge,
    volumeTracingId,
    volumeTracing,
    volumeTracingLayer,
  );
  if (!preparation) {
    return;
  }
  const { layerName, agglomerateFileMag, getDataValue } = preparation;
  const { sourceNodeId, targetNodeId } = action;

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.tracing));

  const { trees } = skeletonTracing;
  const sourceTree = findTreeByNodeId(trees, sourceNodeId).getOrElse(null);
  const targetTree = findTreeByNodeId(trees, targetNodeId).getOrElse(null);

  if (sourceTree == null || targetTree == null) {
    yield* put(setBusyBlockingInfoAction(false));
    return;
  }

  const sourceNodePosition = sourceTree.nodes.get(sourceNodeId).position;
  const targetNodePosition = targetTree.nodes.get(targetNodeId).position;

  const partnerInfos = yield* call(
    getPartnerAgglomerateIds,
    volumeTracingLayer,
    getDataValue,
    sourceNodePosition,
    targetNodePosition,
  );
  if (!partnerInfos) {
    return;
  }
  const { sourceNodeAgglomerateId, targetNodeAgglomerateId, volumeTracingWithEditableMapping } =
    partnerInfos;

  const editableMappingId = volumeTracingWithEditableMapping.mappingName;

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items = [];
  if (action.type === "MERGE_TREES") {
    if (sourceNodeAgglomerateId === targetNodeAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      yield* put(setBusyBlockingInfoAction(false));
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
      yield* put(setBusyBlockingInfoAction(false));
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
  } else if (action.type === "MIN_CUT_AGGLOMERATE") {
    if (sourceNodeAgglomerateId !== targetNodeAgglomerateId) {
      Toast.error("Segments need to be in the same agglomerate to perform a min-cut.");
      yield* put(setBusyBlockingInfoAction(false));
      return;
    }

    currentlyPerformingMinCut = true;

    const tracingStoreUrl = yield* select((state) => state.tracing.tracingStore.url);
    const segmentsInfo = {
      segmentPosition1: sourceNodePosition,
      segmentPosition2: targetNodePosition,
      mag: agglomerateFileMag,
      agglomerateId: sourceNodeAgglomerateId,
      editableMappingId,
    };

    const edgesToRemove = yield* call(
      getEdgesForAgglomerateMinCut,
      tracingStoreUrl,
      volumeTracingId,
      segmentsInfo,
    );

    for (const edge of edgesToRemove) {
      let firstNodeId;
      let secondNodeId;
      for (const node of sourceTree.nodes.values()) {
        if (_.isEqual(node.position, edge.position1)) {
          firstNodeId = node.id;
        } else if (_.isEqual(node.position, edge.position2)) {
          secondNodeId = node.id;
        }
        if (firstNodeId && secondNodeId) {
          break;
        }
      }

      if (!firstNodeId || !secondNodeId) {
        Toast.warning(
          `Unable to find all nodes for positions ${!firstNodeId ? edge.position1 : null}${
            !secondNodeId ? [", ", edge.position2] : null
          } in ${sourceTree.name}.`,
        );
        yield* put(setBusyBlockingInfoAction(false));
        currentlyPerformingMinCut = false;
        return;
      }

      yield* put(deleteEdgeAction(firstNodeId, secondNodeId));
      items.push(
        splitAgglomerate(
          sourceNodeAgglomerateId,
          edge.position1,
          edge.position2,
          agglomerateFileMag,
        ),
      );
    }
    currentlyPerformingMinCut = false;
  }

  if (items.length === 0) {
    yield* put(setBusyBlockingInfoAction(false));
    return;
  }

  yield* put(pushSaveQueueTransaction(items, "mapping", volumeTracingId));
  yield* call([Model, Model.ensureSavedState]);

  /* Reload the segmentation */

  yield* call([api.data, api.data.reloadBuckets], layerName);

  const [newSourceNodeAgglomerateId, newTargetNodeAgglomerateId] = yield* all([
    call(getDataValue, sourceNodePosition),
    call(getDataValue, targetNodePosition),
  ]);

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

  yield* put(setBusyBlockingInfoAction(false));

  yield* removeOldMeshesAndLoadUpdatedMeshes(
    layerName,
    sourceNodeAgglomerateId,
    targetNodeAgglomerateId,
    newSourceNodeAgglomerateId,
    sourceNodePosition,
    newTargetNodeAgglomerateId,
    targetNodePosition,
  );
}

function* clearProofreadingByproducts() {
  for (const treeId of loadedAgglomerateSkeletonIds) {
    yield* put(deleteTreeAction(treeId, true));
  }

  loadedAgglomerateSkeletonIds = [];

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null || volumeTracingLayer.tracingId == null) return;
  const layerName = volumeTracingLayer.tracingId;

  for (const segmentId of coarselyLoadedSegmentIds) {
    yield* put(removeIsosurfaceAction(layerName, segmentId));
  }
  coarselyLoadedSegmentIds = [];
}

function* handleProofreadMergeAndSplit(action: ProofreadMergeAction) {
  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;
  const { tracingId: volumeTracingId } = volumeTracing;

  const preparation = yield* call(
    prepareSplitOrMerge,
    volumeTracingId,
    volumeTracing,
    volumeTracingLayer,
  );
  if (!preparation) {
    return;
  }
  const { layerName, agglomerateFileMag, getDataValue } = preparation;

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.tracing));

  const sourceTree = getActiveTree(skeletonTracing).getOrElse(null);
  const sourceNodeId = skeletonTracing.activeNodeId;

  if (sourceTree == null || sourceNodeId == null) {
    yield* put(setBusyBlockingInfoAction(false));
    return;
  }

  const sourceNodePosition = sourceTree.nodes.get(sourceNodeId).position;
  const targetNodePosition = V3.floor(action.position);

  const partnerInfos = yield* call(
    getPartnerAgglomerateIds,
    volumeTracingLayer,
    getDataValue,
    sourceNodePosition,
    targetNodePosition,
  );
  if (!partnerInfos) {
    return;
  }
  const { sourceNodeAgglomerateId, targetNodeAgglomerateId } = partnerInfos;

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items = [];

  if (action.type === "PROOFREAD_MERGE") {
    if (sourceNodeAgglomerateId === targetNodeAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      yield* put(setBusyBlockingInfoAction(false));
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
  } else if (action.type === "PROOFREAD_SPLIT") {
    if (sourceNodeAgglomerateId !== targetNodeAgglomerateId) {
      Toast.error("Segments that should be split need to be in the same agglomerate.");
      yield* put(setBusyBlockingInfoAction(false));
      return;
    }
    if (partnerInfos.unmappedSourceId === partnerInfos.unmappedTargetId) {
      Toast.error(
        "The selected positions are both part of the same base segment and cannot be split. Please select another position or use the nodes of the agglomerate skeleton to perform the split.",
      );
      yield* put(setBusyBlockingInfoAction(false));
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

  if (items.length === 0) {
    yield* put(setBusyBlockingInfoAction(false));
    return;
  }

  yield* put(pushSaveQueueTransaction(items, "mapping", volumeTracingId));
  yield* call([Model, Model.ensureSavedState]);

  /* Reload the segmentation */

  yield* call([api.data, api.data.reloadBuckets], layerName);

  const [newSourceNodeAgglomerateId, newTargetNodeAgglomerateId] = yield* all([
    call(getDataValue, sourceNodePosition),
    call(getDataValue, targetNodePosition),
  ]);

  /* Reload agglomerate skeleton */
  if (volumeTracing.mappingName == null) return;
  yield* put(deleteTreeAction(sourceTree.treeId, true));
  yield* call(
    loadAgglomerateSkeletonWithId,
    loadAgglomerateSkeletonAction(layerName, volumeTracing.mappingName, newSourceNodeAgglomerateId),
  );

  yield* put(setBusyBlockingInfoAction(false));

  yield* removeOldMeshesAndLoadUpdatedMeshes(
    layerName,
    sourceNodeAgglomerateId,
    targetNodeAgglomerateId,
    newSourceNodeAgglomerateId,
    sourceNodePosition,
    newTargetNodeAgglomerateId,
    targetNodePosition,
  );
}

// Helper functions

function* prepareSplitOrMerge(
  volumeTracingId: string,
  volumeTracing: VolumeTracing,
  volumeTracingLayer: APISegmentationLayer,
): Saga<{
  layerName: string;
  agglomerateFileMag: any;
  getDataValue: (position: Vector3) => Promise<number>;
} | null> {
  const layerName = volumeTracingId;
  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, layerName);
  if (!isHdf5MappingEnabled) {
    return null;
  }

  const busyBlockingInfo = yield* select((state) => state.uiInformation.busyBlockingInfo);
  if (busyBlockingInfo.isBusy) {
    console.warn(`Ignoring proofreading action (reason: ${busyBlockingInfo.reason || "null"})`);
    return null;
  }

  yield* put(setBusyBlockingInfoAction(true, "Proofreading action"));

  if (!volumeTracing.mappingIsEditable) {
    try {
      yield* call(createEditableMapping);
    } catch (e) {
      console.error(e);
      yield* put(setBusyBlockingInfoAction(false));
      return null;
    }
  }

  /* Find out the agglomerate IDs at the two node positions */
  const resolutionInfo = getResolutionInfo(volumeTracingLayer.resolutions);
  // The mag the agglomerate skeleton corresponds to should be the finest available mag of the volume tracing layer
  const agglomerateFileMag = resolutionInfo.getLowestResolution();
  const agglomerateFileZoomstep = resolutionInfo.getLowestResolutionIndex();

  const getDataValue = (nodePosition: Vector3) =>
    api.data.getDataValue(layerName, nodePosition, agglomerateFileZoomstep);

  return { layerName, agglomerateFileMag, getDataValue };
}

function* getPartnerAgglomerateIds(
  volumeTracingLayer: APISegmentationLayer,
  getDataValue: (position: Vector3) => Promise<number>,
  sourceNodePosition: Vector3,
  targetNodePosition: Vector3,
): Saga<{
  volumeTracingWithEditableMapping: VolumeTracing & { mappingName: string };
  sourceNodeAgglomerateId: number;
  targetNodeAgglomerateId: number;
  unmappedSourceId: number;
  unmappedTargetId: number;
} | null> {
  const getUnmappedDataValue = yield* call(createGetUnmappedDataValueFn, volumeTracingLayer);
  if (!getUnmappedDataValue) {
    return null;
  }
  const [sourceNodeAgglomerateId, targetNodeAgglomerateId, unmappedSourceId, unmappedTargetId] =
    yield* all([
      call(getDataValue, sourceNodePosition),
      call(getDataValue, targetNodePosition),
      call(getUnmappedDataValue, sourceNodePosition),
      call(getUnmappedDataValue, targetNodePosition),
    ]);

  const volumeTracingWithEditableMapping = yield* select((state) =>
    getActiveSegmentationTracing(state),
  );
  const mappingName = volumeTracingWithEditableMapping?.mappingName;
  if (volumeTracingWithEditableMapping == null || mappingName == null) {
    yield* put(setBusyBlockingInfoAction(false));
    return null;
  }
  return {
    volumeTracingWithEditableMapping: { ...volumeTracingWithEditableMapping, mappingName },
    sourceNodeAgglomerateId,
    targetNodeAgglomerateId,
    unmappedSourceId,
    unmappedTargetId,
  };
}

function* removeOldMeshesAndLoadUpdatedMeshes(
  layerName: string,
  sourceNodeAgglomerateId: number,
  targetNodeAgglomerateId: number,
  newSourceNodeAgglomerateId: number,
  sourceNodePosition: Vector3,
  newTargetNodeAgglomerateId: number,
  targetNodePosition: Vector3,
) {
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

function* createGetUnmappedDataValueFn(
  volumeTracingLayer: APISegmentationLayer,
): Saga<((nodePosition: Vector3) => Promise<number>) | null> {
  if (volumeTracingLayer.tracingId == null) return null;
  const layerName = volumeTracingLayer.tracingId;

  const resolutionInfo = getResolutionInfo(volumeTracingLayer.resolutions);
  const mag = resolutionInfo.getLowestResolution();

  const fallbackLayerName = volumeTracingLayer.fallbackLayer;
  if (fallbackLayerName == null) return null;
  const TypedArrayClass = yield* select((state) => {
    const { elementClass } = getLayerByName(state.dataset, layerName);
    return getConstructorForElementClass(elementClass)[0];
  });

  return async (nodePosition: Vector3) => {
    const buffer = await api.data.getRawDataCuboid(
      fallbackLayerName,
      nodePosition,
      V3.add(nodePosition, mag),
    );

    return Number(new TypedArrayClass(buffer)[0]);
  };
}
