import {
  type NeighborInfo,
  getAgglomeratesForSegmentsFromTracingstore,
  getEdgesForAgglomerateMinCut,
  getNeighborsForAgglomerateNode,
  getPositionForSegmentInAgglomerate,
} from "admin/rest_api";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { SoftError, isBigInt, isNumberMap } from "libs/utils";
import _ from "lodash";
import { MappingStatusEnum, TreeTypeEnum, type Vector3 } from "oxalis/constants";
import { getSegmentIdForPositionAsync } from "oxalis/controller/combinations/volume_handlers";
import {
  getLayerByName,
  getMagInfo,
  getMappingInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  areGeometriesTransformed,
  enforceSkeletonTracing,
  findTreeByNodeId,
  getTreeAndNode,
  getTreeNameForAgglomerateSkeleton,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { AnnotationTool } from "oxalis/model/accessors/tool_accessor";
import {
  getActiveSegmentationTracing,
  getActiveSegmentationTracingLayer,
  getEditableMappingForVolumeTracingId,
  getMeshInfoForSegment,
  getSegmentName,
  getSegmentsForLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  dispatchMaybeFetchMeshFilesAsync,
  removeMeshAction,
} from "oxalis/model/actions/annotation_actions";
import type {
  MinCutAgglomerateWithPositionAction,
  ProofreadAtPositionAction,
  ProofreadMergeAction,
} from "oxalis/model/actions/proofread_actions";
import { pushSaveQueueTransaction } from "oxalis/model/actions/save_actions";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import { setMappingAction, setMappingNameAction } from "oxalis/model/actions/settings_actions";
import {
  type CreateNodeAction,
  type DeleteNodeAction,
  type SetNodePositionAction,
  deleteEdgeAction,
  setTreeNameAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  initializeEditableMappingAction,
  removeSegmentAction,
  setHasEditableMappingAction,
  updateSegmentAction,
} from "oxalis/model/actions/volumetracing_actions";
import type { Saga } from "oxalis/model/sagas/effect-generators";
import { select } from "oxalis/model/sagas/effect-generators";
import {
  type UpdateActionWithoutIsolationRequirement,
  mergeAgglomerate,
  splitAgglomerate,
} from "oxalis/model/sagas/update_actions";
import { Model, Store, api } from "oxalis/singletons";
import type { ActiveMappingInfo, Mapping, NumberLikeMap, Tree, VolumeTracing } from "oxalis/store";
import { all, call, put, spawn, takeEvery } from "typed-redux-saga";
import type { AdditionalCoordinate, ServerEditableMapping } from "types/api_types";
import { getCurrentMag } from "../accessors/flycam_accessor";
import type { Action } from "../actions/actions";
import { ensureWkReady } from "./ready_sagas";
import { takeEveryUnlessBusy, takeWithBatchActionSupport } from "./saga_helpers";

function runSagaAndCatchSoftError<T>(saga: (...args: any[]) => Saga<T>) {
  return function* (...args: any[]) {
    try {
      yield* call(saga, ...args);
    } catch (exception) {
      if (exception instanceof SoftError) {
        yield* call([Toast, Toast.warning], exception.message);
        return;
      }
      throw exception;
    }
  };
}

export default function* proofreadRootSaga(): Saga<void> {
  yield* takeWithBatchActionSupport("INITIALIZE_SKELETONTRACING");
  yield* call(ensureWkReady);

  yield* takeEveryUnlessBusy(
    ["DELETE_EDGE", "MERGE_TREES", "MIN_CUT_AGGLOMERATE_WITH_NODE_IDS"],
    runSagaAndCatchSoftError(handleSkeletonProofreadingAction),
    "Proofreading in progress",
  );
  yield* takeEvery(["PROOFREAD_AT_POSITION"], runSagaAndCatchSoftError(proofreadAtPosition));
  yield* takeEvery(
    ["CLEAR_PROOFREADING_BY_PRODUCTS"],
    runSagaAndCatchSoftError(clearProofreadingByproducts),
  );
  yield* takeEveryUnlessBusy(
    ["PROOFREAD_MERGE", "MIN_CUT_AGGLOMERATE"],
    runSagaAndCatchSoftError(handleProofreadMergeOrMinCut),
    "Proofreading in progress",
  );
  yield* takeEveryUnlessBusy(
    ["CUT_AGGLOMERATE_FROM_NEIGHBORS"],
    runSagaAndCatchSoftError(handleProofreadCutFromNeighbors),
    "Proofreading in progress",
  );

  yield* takeEvery(
    ["CREATE_NODE", "DELETE_NODE", "SET_NODE_POSITION"],
    runSagaAndCatchSoftError(checkForAgglomerateSkeletonModification),
  );
}

function proofreadCoarseMagIndex(): number {
  // @ts-ignore
  return window.__proofreadCoarseResolutionIndex != null
    ? // @ts-ignore
      window.__proofreadCoarseResolutionIndex
    : 3;
}
function proofreadUsingMeshes(): boolean {
  // @ts-ignore
  return window.__proofreadUsingMeshes != null ? window.__proofreadUsingMeshes : true;
}

let coarselyLoadedSegmentIds: number[] = [];

function* loadCoarseMesh(
  layerName: string,
  segmentId: number,
  position: Vector3,
  additionalCoordinates: AdditionalCoordinate[] | undefined,
): Saga<void> {
  const autoRenderMeshInProofreading = yield* select(
    (state) => state.userConfiguration.autoRenderMeshInProofreading,
  );
  if (!autoRenderMeshInProofreading) {
    return;
  }
  const dataset = yield* select((state) => state.dataset);
  const layer = getLayerByName(dataset, layerName);

  // Ensure that potential mesh files are already available. Otherwise, the following
  // code would default to ad-hoc meshing.
  yield* call(dispatchMaybeFetchMeshFilesAsync, Store.dispatch, layer, dataset, false);

  const currentMeshFile = yield* select(
    (state) => state.localSegmentationData[layerName].currentMeshFile,
  );

  const meshInfo = yield* select((state) =>
    getMeshInfoForSegment(state, additionalCoordinates || null, layerName, segmentId),
  );

  if (meshInfo != null) {
    console.log(`Don't load mesh for segment ${segmentId} because it already exists.`);
    return;
  }

  if (
    currentMeshFile != null &&
    currentMeshFile.formatVersion >= 3 &&
    currentMeshFile.mappingName == null
  ) {
    // If a mesh file is active which was computed without a mapping, use that instead of computing
    // meshes ad-hoc.
    yield* put(
      loadPrecomputedMeshAction(
        segmentId,
        position,
        additionalCoordinates,
        currentMeshFile.meshFileName,
        undefined,
      ),
    );
  } else {
    const mappingInfo = yield* select((state) =>
      getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
    );
    const { mappingName, mappingType } = mappingInfo;

    // Load the whole agglomerate mesh in a coarse mag for performance reasons
    const preferredQuality = proofreadCoarseMagIndex();
    yield* put(
      loadAdHocMeshAction(segmentId, position, additionalCoordinates, {
        mappingName,
        mappingType,
        preferredQuality,
      }),
    );
  }

  coarselyLoadedSegmentIds.push(segmentId);
}

function* checkForAgglomerateSkeletonModification(
  action: CreateNodeAction | DeleteNodeAction | SetNodePositionAction,
): Saga<void> {
  let nodeId, treeId;

  if (action.type === "CREATE_NODE") {
    ({ treeId } = action);
  } else {
    ({ nodeId, treeId } = action);
  }

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.annotation));

  if (getTreeAndNode(skeletonTracing, nodeId, treeId, TreeTypeEnum.AGGLOMERATE)) {
    Toast.warning(
      "Agglomerate skeletons can only be modified when using the proofreading tool to add or delete edges. Consider switching to the proofreading tool or converting the skeleton to a normal tree via right-click in the Skeleton tab.",
      { timeout: 10000 },
    );
  }
}

function* proofreadAtPosition(action: ProofreadAtPositionAction): Saga<void> {
  const { position, additionalCoordinates } = action;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null || volumeTracingLayer.tracingId == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;

  const layerName = volumeTracingLayer.tracingId;
  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, layerName);
  if (!isHdf5MappingEnabled || volumeTracing.mappingName == null) return;

  const segmentId = yield* call(getSegmentIdForPositionAsync, position);

  if (!proofreadUsingMeshes()) return;

  /* Load a coarse ad-hoc mesh of the agglomerate at the click position */
  yield* call(loadCoarseMesh, layerName, segmentId, position, additionalCoordinates);
}

function* createEditableMapping(): Saga<string> {
  /*
   * Returns the name of the editable mapping. This is not identical to the
   * name of the HDF5 mapping for which the editable mapping is about to be created.
   */
  // Get volume tracing again to make sure the version is up to date
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (!volumeTracing || !volumeTracing.mappingName) {
    // This should never occur, because the proofreading tool is only available when a volume tracing layer is active.
    throw new Error("No active segmentation tracing layer. Cannot create editable mapping.");
  }

  const volumeTracingId = volumeTracing.tracingId;
  const layerName = volumeTracingId;
  const baseMappingName = volumeTracing.mappingName;
  yield* put(setMappingNameAction(layerName, volumeTracingId, "HDF5"));
  yield* put(setHasEditableMappingAction(volumeTracingId));
  // Ensure a saved state so that the mapping is locked and editable before doing the first proofreading operation.
  yield* call([Model, Model.ensureSavedState]);
  const editableMapping: ServerEditableMapping = {
    baseMappingName: baseMappingName,
    tracingId: volumeTracingId,
    createdTimestamp: Date.now(),
  };
  yield* put(initializeEditableMappingAction(editableMapping));
  return volumeTracingId;
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

function* handleSkeletonProofreadingAction(action: Action): Saga<void> {
  // Actually, action is MergeTreesAction | DeleteEdgeAction | MinCutAgglomerateAction,
  // but the takeEveryUnlessBusy wrapper does not understand this.
  // Handles split, merge and min-cut actions on agglomerates.
  // Note that the skeletontracing reducer already mutated the skeletons according to the
  // received action.
  if (
    action.type !== "MERGE_TREES" &&
    action.type !== "DELETE_EDGE" &&
    action.type !== "MIN_CUT_AGGLOMERATE_WITH_NODE_IDS"
  ) {
    return;
  }
  if (action.type === "DELETE_EDGE" && action.initiator === "PROOFREADING") {
    // Ignore DeleteEdge actions that were dispatched by the proofreading saga itself
    return;
  }

  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const { sourceNodeId, targetNodeId } = action;
  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.annotation));
  const { trees } = skeletonTracing;
  const sourceTree = findTreeByNodeId(trees, sourceNodeId);
  const targetTree = findTreeByNodeId(trees, targetNodeId);

  if (sourceTree == null || targetTree == null) {
    return;
  }

  const isModifyingOnlyAgglomerateSkeletons =
    sourceTree.type === TreeTypeEnum.AGGLOMERATE && targetTree.type === TreeTypeEnum.AGGLOMERATE;
  const isModifyingAnyAgglomerateSkeletons =
    sourceTree.type === TreeTypeEnum.AGGLOMERATE || targetTree.type === TreeTypeEnum.AGGLOMERATE;
  const isProofreadingToolActive = yield* select(
    (state) => state.uiInformation.activeTool === AnnotationTool.PROOFREAD,
  );

  if (isProofreadingToolActive && !isModifyingOnlyAgglomerateSkeletons) {
    Toast.warning(
      "Only agglomerate skeletons can be modified using the proofreading tool to edit the active mapping.",
      { timeout: 12000 },
    );
    return;
  } else if (!isProofreadingToolActive && isModifyingAnyAgglomerateSkeletons) {
    Toast.warning(
      "In order to edit the active mapping by deleting or adding edges of agglomerate skeletons, the proofreading tool needs to be active." +
        " If you want to edit the active mapping, activate the proofreading tool and then redo the action.",
      { timeout: 12000 },
    );
    return;
  }

  if (!isProofreadingToolActive) {
    return;
  }

  const preparation = yield* call(prepareSplitOrMerge, true);
  if (!preparation) {
    return;
  }

  const { agglomerateFileMag, getDataValue, activeMapping, volumeTracing } = preparation;
  const { tracingId: volumeTracingId } = volumeTracing;

  // Use untransformedPosition because agglomerate trees should not have
  // any transforms, anyway.
  if (yield* select((state) => areGeometriesTransformed(state))) {
    Toast.error("Proofreading is currently not supported when the skeleton layer is transformed.");
    return;
  }
  const sourceNodePosition = sourceTree.nodes.getOrThrow(sourceNodeId).untransformedPosition;
  const targetNodePosition = targetTree.nodes.getOrThrow(targetNodeId).untransformedPosition;

  const idInfos = yield* call(getAgglomerateInfos, preparation.getMappedAndUnmapped, [
    sourceNodePosition,
    targetNodePosition,
  ]);
  if (!idInfos) {
    return;
  }
  const [sourceInfo, targetInfo] = idInfos;
  const sourceAgglomerateId = sourceInfo.agglomerateId;
  const targetAgglomerateId = targetInfo.agglomerateId;

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items: UpdateActionWithoutIsolationRequirement[] = [];
  if (action.type === "MERGE_TREES") {
    if (sourceAgglomerateId === targetAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      return;
    }
    items.push(
      mergeAgglomerate(
        sourceAgglomerateId,
        targetAgglomerateId,
        sourceInfo.unmappedId,
        targetInfo.unmappedId,
        agglomerateFileMag,
        volumeTracingId,
      ),
    );
    const mergedMapping = yield* call(
      mergeAgglomeratesInMapping,
      activeMapping,
      targetAgglomerateId,
      sourceAgglomerateId,
    );
    yield* put(
      setMappingAction(volumeTracingId, activeMapping.mappingName, activeMapping.mappingType, {
        mapping: mergedMapping,
      }),
    );
  } else if (action.type === "DELETE_EDGE") {
    if (sourceAgglomerateId !== targetAgglomerateId) {
      Toast.error("Segments that should be split need to be in the same agglomerate.");
      return;
    }
    items.push(
      splitAgglomerate(
        sourceAgglomerateId,
        sourceInfo.unmappedId,
        targetInfo.unmappedId,
        agglomerateFileMag,
        volumeTracingId,
      ),
    );
  } else if (action.type === "MIN_CUT_AGGLOMERATE_WITH_NODE_IDS") {
    const hasErrored = yield* call(
      performMinCut,
      sourceAgglomerateId,
      targetAgglomerateId,
      sourceInfo.unmappedId,
      targetInfo.unmappedId,
      agglomerateFileMag,
      volumeTracingId,
      sourceTree,
      items,
    );
    if (hasErrored) {
      return;
    }
  }

  if (items.length === 0) {
    return;
  }

  yield* put(pushSaveQueueTransaction(items));
  yield* call([Model, Model.ensureSavedState]);

  if (action.type === "MIN_CUT_AGGLOMERATE_WITH_NODE_IDS" || action.type === "DELETE_EDGE") {
    if (sourceAgglomerateId !== targetAgglomerateId) {
      Toast.error(
        "The selected positions are not part of the same agglomerate and cannot be split.",
      );
      return;
    }

    // Because we ensured a saved state a few lines above, we can now split the mapping locally
    // as this still requires some communication with the back-end.
    const splitMapping = yield* splitAgglomerateInMapping(
      activeMapping,
      sourceAgglomerateId,
      volumeTracingId,
    );

    console.log("dispatch setMappingAction in proofreading saga");
    yield* put(
      setMappingAction(volumeTracingId, activeMapping.mappingName, activeMapping.mappingType, {
        mapping: splitMapping,
      }),
    );
  }

  const newMapping = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer[volumeTracingId].mapping,
  );

  const [newSourceAgglomerateId, newTargetAgglomerateId] = yield* all([
    call(getDataValue, sourceNodePosition, newMapping),
    call(getDataValue, targetNodePosition, newMapping),
  ]);

  /* Rename agglomerate skeleton(s) according to their new id and mapping name */
  yield* put(
    setTreeNameAction(
      getTreeNameForAgglomerateSkeleton(newSourceAgglomerateId, volumeTracing.mappingName),
      sourceTree.treeId,
    ),
  );
  if (sourceTree !== targetTree) {
    // A split happened, because the new trees are not identical.
    yield* put(
      setTreeNameAction(
        getTreeNameForAgglomerateSkeleton(newTargetAgglomerateId, volumeTracing.mappingName),
        targetTree.treeId,
      ),
    );
  } else {
    // A merge happened. Remove the segment that doesn't exist anymore.
    yield* put(removeSegmentAction(targetAgglomerateId, volumeTracing.tracingId));
  }

  const pack = (agglomerateId: number, newAgglomerateId: number, nodePosition: Vector3) => ({
    agglomerateId,
    newAgglomerateId,
    nodePosition,
  });

  yield* spawn(refreshAffectedMeshes, volumeTracingId, [
    pack(sourceAgglomerateId, newSourceAgglomerateId, sourceNodePosition),
    pack(targetAgglomerateId, newTargetAgglomerateId, targetNodePosition),
  ]);
}

function* performMinCut(
  sourceAgglomerateId: number,
  targetAgglomerateId: number,
  sourceSegmentId: number,
  targetSegmentId: number,
  agglomerateFileMag: Vector3,
  volumeTracingId: string,
  sourceTree: Tree | null,
  items: UpdateActionWithoutIsolationRequirement[],
): Saga<boolean> {
  if (sourceAgglomerateId !== targetAgglomerateId) {
    Toast.error(
      "Segments need to be in the same agglomerate to perform a min-cut splitting operation.",
    );
    return true;
  }

  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const segmentsInfo = {
    segmentId1: sourceSegmentId,
    segmentId2: targetSegmentId,
    mag: agglomerateFileMag,
    agglomerateId: sourceAgglomerateId,
    editableMappingId: volumeTracingId,
  };

  const edgesToRemove = yield* call(
    getEdgesForAgglomerateMinCut,
    tracingStoreUrl,
    volumeTracingId,
    segmentsInfo,
  );

  // Use untransformedPosition below because agglomerate trees should not have
  // any transforms, anyway.
  if (yield* select((state) => areGeometriesTransformed(state))) {
    Toast.error("Proofreading is currently not supported when the skeleton layer is transformed.");
    return true;
  }

  for (const edge of edgesToRemove) {
    if (sourceTree) {
      const result = getDeleteEdgeActionForEdgePositions(sourceTree, edge);
      if (result == null) {
        return true;
      }
      const { firstNodeId, secondNodeId } = result;
      yield* put(deleteEdgeAction(firstNodeId, secondNodeId, Date.now(), "PROOFREADING"));
    }

    console.log(
      "Splitting agglomerate",
      sourceAgglomerateId,
      "with segment ids",
      edge.segmentId1,
      "and",
      edge.segmentId2,
    );
    items.push(
      splitAgglomerate(
        sourceAgglomerateId,
        edge.segmentId1,
        edge.segmentId2,
        agglomerateFileMag,
        volumeTracingId,
      ),
    );
  }

  return false;
}

function* performCutFromNeighbors(
  agglomerateId: number,
  segmentId: number,
  segmentPosition: Vector3 | null,
  agglomerateFileMag: Vector3,
  volumeTracingId: string,
  sourceTree: Tree | null | undefined,
  items: UpdateActionWithoutIsolationRequirement[],
): Saga<
  { didCancel: false; neighborInfo: NeighborInfo } | { didCancel: true; neighborInfo?: null }
> {
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  const segmentsInfo = {
    segmentId,
    mag: agglomerateFileMag,
    agglomerateId,
    editableMappingId: volumeTracingId,
  };

  const neighborInfo = yield* call(
    getNeighborsForAgglomerateNode,
    tracingStoreUrl,
    volumeTracingId,
    segmentsInfo,
  );

  const edgesToRemove: Array<
    | {
        position1: Vector3;
        position2: Vector3;
        segmentId1: number;
        segmentId2: number;
      }
    | {
        position1: null;
        position2: Vector3;
        segmentId1: number;
        segmentId2: number;
      }
  > = neighborInfo.neighbors.map(
    (neighbor) =>
      ({
        position1: segmentPosition,
        position2: neighbor.position,
        segmentId1: segmentId,
        segmentId2: neighbor.segmentId,
      }) as const,
  );

  if (edgesToRemove.length === 0) {
    Toast.info("No neighbors found.");
    return { didCancel: true };
  }

  for (const edge of edgesToRemove) {
    if (sourceTree) {
      if (edge.position1 == null) {
        // Satisfy TypeScript. Should not happen because segmentPosition should not be null
        // when a sourceTree was passed.
        Toast.warning("Could not perform cut from neighbors. See console for more details.");
        console.warn(
          "segmentPosition is not available even though a tree was passed to performCutFromNeighbors.",
        );
        return { didCancel: true };
      }
      const result = getDeleteEdgeActionForEdgePositions(sourceTree, edge);
      if (result == null) {
        return { didCancel: true };
      }
      const { firstNodeId, secondNodeId } = result;
      yield* put(deleteEdgeAction(firstNodeId, secondNodeId, Date.now(), "PROOFREADING"));
    }

    items.push(
      splitAgglomerate(
        agglomerateId,
        edge.segmentId1,
        edge.segmentId2,
        agglomerateFileMag,
        volumeTracingId,
      ),
    );
  }

  return { didCancel: false, neighborInfo };
}

function* clearProofreadingByproducts() {
  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null || volumeTracingLayer.tracingId == null) return;
  const layerName = volumeTracingLayer.tracingId;

  for (const segmentId of coarselyLoadedSegmentIds) {
    yield* put(removeMeshAction(layerName, segmentId));
  }
  coarselyLoadedSegmentIds = [];
}

const MISSING_INFORMATION_WARNING =
  "Please use either the data viewports OR the 3D viewport (but not both) for selecting the partners of a proofreading operation.";

function* handleProofreadMergeOrMinCut(action: Action) {
  // Actually, action is ProofreadMergeAction | MinCutAgglomerateWithPositionAction
  // but the takeEveryUnlessBusy wrapper does not understand this.
  if (action.type !== "PROOFREAD_MERGE" && action.type !== "MIN_CUT_AGGLOMERATE") {
    return;
  }

  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const preparation = yield* call(prepareSplitOrMerge, false);
  if (!preparation) {
    return;
  }
  const { agglomerateFileMag, volumeTracing, activeMapping } = preparation;
  const { tracingId: volumeTracingId } = volumeTracing;
  const idInfos = yield* call(gatherInfoForOperation, action, preparation);

  if (idInfos == null) {
    return;
  }
  const [sourceInfo, targetInfo] = idInfos;
  const sourceAgglomerateId = sourceInfo.agglomerateId;
  const targetAgglomerateId = targetInfo.agglomerateId;
  const sourceAgglomerate = volumeTracing.segments.getNullable(Number(sourceAgglomerateId));
  const targetAgglomerate = volumeTracing.segments.getNullable(Number(targetAgglomerateId));

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items: UpdateActionWithoutIsolationRequirement[] = [];

  if (action.type === "PROOFREAD_MERGE") {
    if (sourceAgglomerateId === targetAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      return;
    }

    items.push(
      mergeAgglomerate(
        sourceAgglomerateId,
        targetAgglomerateId,
        sourceInfo.unmappedId,
        targetInfo.unmappedId,
        agglomerateFileMag,
        volumeTracingId,
      ),
    );

    console.log(
      "Merging agglomerate",
      sourceAgglomerateId,
      "with",
      targetAgglomerateId,
      "and segment ids",
      sourceInfo.unmappedId,
      targetInfo.unmappedId,
    );
    const mergedMapping = yield* call(
      mergeAgglomeratesInMapping,
      activeMapping,
      targetAgglomerateId,
      sourceAgglomerateId,
    );

    yield* put(
      setMappingAction(volumeTracingId, activeMapping.mappingName, activeMapping.mappingType, {
        mapping: mergedMapping,
      }),
    );
  } else if (action.type === "MIN_CUT_AGGLOMERATE") {
    if (sourceInfo.unmappedId === targetInfo.unmappedId) {
      Toast.error(
        "The selected positions are both part of the same base segment and cannot be split. Please select another position or use the nodes of the agglomerate skeleton to perform the split.",
      );
      return;
    }
    const hasErrored = yield* call(
      performMinCut,
      sourceAgglomerateId,
      targetAgglomerateId,
      sourceInfo.unmappedId,
      targetInfo.unmappedId,
      agglomerateFileMag,
      volumeTracingId,
      null,
      items,
    );
    if (hasErrored) {
      return;
    }
  }

  if (items.length === 0) {
    return;
  }

  yield* put(pushSaveQueueTransaction(items));
  yield* call([Model, Model.ensureSavedState]);

  if (action.type === "MIN_CUT_AGGLOMERATE") {
    console.log("start updating the mapping after a min-cut");
    if (sourceAgglomerateId !== targetAgglomerateId) {
      Toast.error(
        "The selected positions are not part of the same agglomerate and cannot be split.",
      );
      return;
    }

    // Now that the changes are saved, we can split the mapping locally (because it requires
    // communication with the back-end).
    const splitMapping = yield* splitAgglomerateInMapping(
      activeMapping,
      sourceAgglomerateId,
      volumeTracingId,
    );

    console.log("dispatch setMappingAction in proofreading saga");
    yield* put(
      setMappingAction(volumeTracingId, activeMapping.mappingName, activeMapping.mappingType, {
        mapping: splitMapping,
      }),
    );
    console.log("finished updating the mapping after a min-cut");
  }

  if (action.type === "PROOFREAD_MERGE") {
    // Remove the segment that doesn't exist anymore.
    yield* put(removeSegmentAction(targetAgglomerateId, volumeTracingId));
  }

  /* Reload meshes */
  const newMapping = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer[volumeTracingId].mapping,
  );
  const newSourceAgglomerateId = yield* call(
    preparation.mapSegmentId,
    sourceInfo.unmappedId,
    newMapping,
  );
  const newTargetAgglomerateId = yield* call(
    preparation.mapSegmentId,
    targetInfo.unmappedId,
    newMapping,
  );
  // Preserving custom names across merges & splits.
  if (
    action.type === "PROOFREAD_MERGE" &&
    sourceAgglomerate &&
    targetAgglomerate &&
    (sourceAgglomerate.name || targetAgglomerate.name)
  ) {
    const mergedName = _.uniq([sourceAgglomerate.name, targetAgglomerate.name])
      .filter((name) => name != null)
      .join(",");
    if (mergedName !== sourceAgglomerate.name) {
      yield* put(updateSegmentAction(sourceAgglomerateId, { name: mergedName }, volumeTracingId));
      Toast.info(`Renamed segment "${getSegmentName(sourceAgglomerate)}" to "${mergedName}."`);
    }
  } else if (
    action.type === "MIN_CUT_AGGLOMERATE" &&
    sourceAgglomerate &&
    sourceAgglomerate.name != null
  ) {
    // Assign custom name to split-off target.
    yield* put(
      updateSegmentAction(
        Number(newTargetAgglomerateId),
        { name: sourceAgglomerate.name },
        volumeTracingId,
      ),
    );

    Toast.info(`Assigned name "${sourceAgglomerate.name}" to new split-off segment.`);
  }

  yield* spawn(refreshAffectedMeshes, volumeTracingId, [
    {
      agglomerateId: sourceAgglomerateId,
      newAgglomerateId: newSourceAgglomerateId,
      nodePosition: sourceInfo.position,
    },
    {
      agglomerateId: targetAgglomerateId,
      newAgglomerateId: newTargetAgglomerateId,
      nodePosition: targetInfo.position,
    },
  ]);
}

function* handleProofreadCutFromNeighbors(action: Action) {
  // Actually, action is CutAgglomerateFromNeighborsAction but the
  // takeEveryUnlessBusy wrapper does not understand this.
  if (action.type !== "CUT_AGGLOMERATE_FROM_NEIGHBORS") {
    return;
  }

  // This action does not depend on the active agglomerate. Instead, it
  // only depends on the rightclicked agglomerate.

  const allowUpdate = yield* select((state) => state.annotation.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const preparation = yield* call(prepareSplitOrMerge, false);
  if (!preparation) {
    return;
  }
  const { agglomerateFileMag, getDataValue, volumeTracing, activeMapping } = preparation;
  const { tracingId: volumeTracingId } = volumeTracing;

  let idInfos;
  let targetPosition = null;
  if (action.position != null) {
    targetPosition = V3.floor(action.position);
    idInfos = yield* call(getAgglomerateInfos, preparation.getMappedAndUnmapped, [targetPosition]);
  } else {
    if (action.agglomerateId == null || action.segmentId == null) {
      Toast.warning(MISSING_INFORMATION_WARNING);
      console.log("Some fields were null:", {
        agglomerateId: action.agglomerateId,
        segmentId: action.segmentId,
      });
      return;
    }
    idInfos = [{ agglomerateId: action.agglomerateId, unmappedId: action.segmentId }];

    targetPosition = yield* call(getPositionForSegmentId, volumeTracing, action.segmentId);
  }
  if (!idInfos) {
    return;
  }
  const targetAgglomerateId = idInfos[0].agglomerateId;
  const targetSegmentId = idInfos[0].unmappedId;

  const targetAgglomerate = volumeTracing.segments.getNullable(Number(targetAgglomerateId));

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items: UpdateActionWithoutIsolationRequirement[] = [];

  const { didCancel, neighborInfo } = yield* call(
    performCutFromNeighbors,
    targetAgglomerateId,
    targetSegmentId,
    targetPosition,
    agglomerateFileMag,
    volumeTracingId,
    action.tree,
    items,
  );
  if (didCancel || items.length === 0) {
    return;
  }

  yield* put(pushSaveQueueTransaction(items));
  yield* call([Model, Model.ensureSavedState]);

  // Now that the changes are saved, we can split the mapping locally (because it requires
  // communication with the back-end).
  const mappingAfterSplit = yield* splitAgglomerateInMapping(
    activeMapping,
    targetAgglomerateId,
    volumeTracingId,
  );

  console.log("dispatch setMappingAction in proofreading saga");
  yield* put(
    setMappingAction(volumeTracingId, activeMapping.mappingName, activeMapping.mappingType, {
      mapping: mappingAfterSplit,
    }),
  );

  const [newTargetAgglomerateId, ...newNeighborAgglomerateIds] = yield* all([
    call(getDataValue, targetPosition, mappingAfterSplit),
    ...neighborInfo.neighbors.map((neighbor) =>
      call(getDataValue, neighbor.position, mappingAfterSplit),
    ),
  ]);

  if (targetAgglomerate != null && targetAgglomerate.name != null) {
    // Assign custom name to split-off target.
    const updateNeighborNamesActions = newNeighborAgglomerateIds.map((newNeighborAgglomerateId) =>
      put(
        updateSegmentAction(
          Number(newNeighborAgglomerateId),
          { name: targetAgglomerate.name },
          volumeTracingId,
        ),
      ),
    );
    yield* all(updateNeighborNamesActions);

    Toast.info(`Assigned name "${targetAgglomerate.name}" to all new split-off segments.`);
  }

  /* Reload meshes */
  yield* spawn(refreshAffectedMeshes, volumeTracingId, [
    {
      agglomerateId: targetAgglomerateId,
      newAgglomerateId: newTargetAgglomerateId,
      nodePosition: targetPosition,
    },
    ...neighborInfo.neighbors.map((neighbor, idx) => ({
      agglomerateId: targetAgglomerateId,
      newAgglomerateId: newNeighborAgglomerateIds[idx],
      nodePosition: neighbor.position,
    })),
  ]);
}

// Helper functions

type Preparation = {
  agglomerateFileMag: Vector3;
  getDataValue: (position: Vector3, overrideMapping?: Mapping | null) => Promise<number>;
  mapSegmentId: (segmentId: number, overrideMapping?: Mapping | null) => number;
  getMappedAndUnmapped: (
    position: Vector3,
  ) => Promise<{ agglomerateId: number; unmappedId: number }>;
  activeMapping: ActiveMappingInfo;
  volumeTracing: VolumeTracing & { mappingName: string };
};

function* prepareSplitOrMerge(isSkeletonProofreading: boolean): Saga<Preparation | null> {
  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracingLayer == null || volumeTracing == null) {
    return null;
  }
  let { mappingName } = volumeTracing;
  if (mappingName == null) {
    return null;
  }

  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, volumeTracing.tracingId);
  if (!isHdf5MappingEnabled) {
    return null;
  }

  if (!volumeTracing.hasEditableMapping) {
    try {
      mappingName = yield* call(createEditableMapping);
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  const magInfo = getMagInfo(volumeTracingLayer.resolutions);
  const currentMag = yield* select((state) => getCurrentMag(state, volumeTracingLayer.name));

  const agglomerateFileMag = isSkeletonProofreading
    ? // In case of skeleton proofreading, the finest mag should be used.
      magInfo.getFinestMag()
    : // For non-skeleton proofreading, the active mag suffices
      currentMag;
  if (agglomerateFileMag == null) {
    return null;
  }
  const agglomerateFileZoomstep = magInfo.getIndexByMag(agglomerateFileMag);

  const getUnmappedDataValue = (position: Vector3): Promise<number> => {
    const { additionalCoordinates } = Store.getState().flycam;
    return api.data.getDataValue(
      volumeTracing.tracingId,
      position,
      agglomerateFileZoomstep,
      additionalCoordinates,
    );
  };

  console.log("Accessing mapping for proofreading");
  const mapping = yield* select(
    (state) =>
      getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, volumeTracing.tracingId)
        .mapping,
  );

  if (mapping == null) {
    Toast.warning("Mapping is not available, cannot proofread.");
    return null;
  }

  const getDataValue = async (
    position: Vector3,
    overrideMapping: Mapping | null = null,
  ): Promise<number> => {
    const unmappedId = await getUnmappedDataValue(position);
    return mapSegmentId(unmappedId, overrideMapping);
  };

  const mapSegmentId = (segmentId: number, overrideMapping: Mapping | null = null): number => {
    const mappingToAccess = overrideMapping ?? mapping;
    const mappedId = isNumberMap(mappingToAccess)
      ? mappingToAccess.get(Number(segmentId))
      : // TODO: Proper 64 bit support (#6921)
        Number(mappingToAccess.get(BigInt(segmentId)));
    if (mappedId == null) {
      // It could happen that the user tries to perform a proofreading operation
      // that involves an id for which the mapped id wasn't fetched yet.
      // In that case, we currently just throw an error. A toast will appear
      // that asks the user to retry. If we notice that this happens in production,
      // we can think about a better way to handle this.
      throw new SoftError(
        `Could not map id ${segmentId}. The mapped partner might not be known yet. Please retry.`,
      );
    }
    return mappedId;
  };

  const getMappedAndUnmapped = async (position: Vector3) => {
    const unmappedId = await getUnmappedDataValue(position);
    const agglomerateId = isNumberMap(mapping)
      ? mapping.get(unmappedId)
      : // TODO: Proper 64 bit support (#6921)
        Number(mapping.get(BigInt(unmappedId)));

    if (agglomerateId == null) {
      // It could happen that the user tries to perform a proofreading operation
      // that involves an id for which the mapped id wasn't fetched yet.
      // In that case, we currently just throw an error. A toast will appear
      // that asks the user to retry. If we notice that this happens in production,
      // we can think about a better way to handle this.
      throw new SoftError(
        `Could not map id ${unmappedId} at position ${position}. The mapped partner might not be known yet. Please retry.`,
      );
    }
    return { agglomerateId, unmappedId };
  };

  const activeMapping = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer[volumeTracing.tracingId],
  );

  if (activeMapping.mapping == null) {
    Toast.error("Mapping is not available, cannot proofread.");
    return null;
  }

  return {
    agglomerateFileMag,
    getDataValue,
    getMappedAndUnmapped,
    mapSegmentId,
    activeMapping,
    volumeTracing: { ...volumeTracing, mappingName },
  };
}

function* getAgglomerateInfos(
  getMappedAndUnmapped: (
    position: Vector3,
  ) => Promise<{ agglomerateId: number; unmappedId: number }>,
  positions: Vector3[],
): Saga<Array<{
  agglomerateId: number;
  unmappedId: number;
}> | null> {
  try {
    const idInfos = yield* all(positions.map((pos) => call(getMappedAndUnmapped, pos)));
    if (idInfos.find((idInfo) => idInfo.agglomerateId === 0 || idInfo.unmappedId === 0) != null) {
      Toast.warning(
        "One of the selected segments has the id 0 which is the background. Cannot merge/split.",
      );
      console.warn("At least one id was zero:", idInfos);
      return null;
    }
    return idInfos;
  } catch (exception) {
    Toast.error("Cannot perform proofreading operation. Please retry. See console for details.");
    console.error(exception);
    return null;
  }
}

function* refreshAffectedMeshes(
  layerName: string,
  items: Array<{
    agglomerateId: number;
    newAgglomerateId: number;
    nodePosition: Vector3;
  }>,
) {
  // ATTENTION: This saga should usually be called with `spawn` to avoid that the user
  // is blocked (via takeEveryUnlessBusy) while the meshes are refreshed.
  if (!proofreadUsingMeshes()) {
    return;
  }
  // Segmentations with more than 3 dimensions are currently not compatible
  // with proofreading. Once such datasets appear, this parameter needs to be
  // adapted.
  const additionalCoordinates = undefined;

  // Remember which meshes were removed in this saga
  // and which were fetched again to avoid doing redundant work.
  const removedIds = new Set();
  const newlyLoadedIds = new Set();
  for (const item of items) {
    // Remove old agglomerate mesh(es) and load updated agglomerate mesh(es)
    if (!removedIds.has(item.agglomerateId)) {
      yield* put(removeMeshAction(layerName, Number(item.agglomerateId)));
      removedIds.add(item.agglomerateId);
    }
    if (!newlyLoadedIds.has(item.newAgglomerateId)) {
      yield* call(
        loadCoarseMesh,
        layerName,
        Number(item.newAgglomerateId),
        item.nodePosition,
        additionalCoordinates,
      );
      newlyLoadedIds.add(item.newAgglomerateId);
    }
  }
}

function getDeleteEdgeActionForEdgePositions(
  sourceTree: Tree,
  edge: { position1: Vector3; position2: Vector3 },
) {
  let firstNodeId;
  let secondNodeId;
  for (const node of sourceTree.nodes.values()) {
    if (_.isEqual(node.untransformedPosition, edge.position1)) {
      firstNodeId = node.id;
    } else if (_.isEqual(node.untransformedPosition, edge.position2)) {
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
    return null;
  }
  return { firstNodeId, secondNodeId };
}

function* getPositionForSegmentId(volumeTracing: VolumeTracing, segmentId: number): Saga<Vector3> {
  const dataset = yield* select((state) => state.dataset);
  const dataStoreUrl = yield* select((state) => state.dataset.dataStore.url);
  const editableMapping = yield* select((state) =>
    getEditableMappingForVolumeTracingId(state, volumeTracing.tracingId),
  );
  if (volumeTracing.fallbackLayer == null || editableMapping == null) {
    // Should not happen in proofreading.
    throw new Error("Could not find fallback layer or editable mapping.");
  }
  const position = yield* call(
    getPositionForSegmentInAgglomerate,
    dataStoreUrl,
    dataset,
    volumeTracing.fallbackLayer,
    editableMapping.baseMappingName,
    segmentId,
  );
  return position;
}

function* splitAgglomerateInMapping(
  activeMapping: ActiveMappingInfo,
  sourceAgglomerateId: number,
  volumeTracingId: string,
) {
  // Obtain all segment ids that map to sourceAgglomerateId
  const mappingEntries = Array.from(activeMapping.mapping as NumberLikeMap);

  const adaptToType =
    mappingEntries.length > 0 && isBigInt(mappingEntries[0][0])
      ? (el: number) => BigInt(el)
      : (el: number) => el;

  // If the mapping contains BigInts, we need a BigInt for the filtering
  const comparableSourceAgglomerateId = adaptToType(sourceAgglomerateId);
  const splitSegmentIds = mappingEntries
    .filter(([_segmentId, agglomerateId]) => agglomerateId === comparableSourceAgglomerateId)
    .map(([segmentId, _agglomerateId]) => segmentId);

  const annotationId = yield* select((state) => state.annotation.annotationId);
  const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
  // Ask the server to map the (split) segment ids. This creates a partial mapping
  // that only contains these ids.
  const mappingAfterSplit = yield* call(
    getAgglomeratesForSegmentsFromTracingstore,
    tracingStoreUrl,
    volumeTracingId,
    splitSegmentIds,
    annotationId,
  );

  // Create a new mapping which is equal to the old one with the difference that
  // ids from splitSegmentIds are mapped to their new target agglomerate ids.
  const splitMapping = new Map(
    Array.from(activeMapping.mapping as NumberLikeMap, ([segmentId, agglomerateId]) => {
      // @ts-ignore get() is expected to accept the type that segmentId has
      const mappedId = mappingAfterSplit.get(segmentId);
      if (mappedId != null) {
        return [segmentId, mappedId];
      }
      return [segmentId, agglomerateId];
    }),
  ) as Mapping;
  return splitMapping;
}

function mergeAgglomeratesInMapping(
  activeMapping: ActiveMappingInfo,
  targetAgglomerateId: number,
  sourceAgglomerateId: number,
): Mapping {
  const adaptToType =
    activeMapping.mapping && isNumberMap(activeMapping.mapping)
      ? (el: number) => el
      : (el: number) => BigInt(el);

  const typedTargetAgglomerateId = adaptToType(targetAgglomerateId);
  const typedSourceAgglomerateId = adaptToType(sourceAgglomerateId);
  return new Map(
    Array.from(activeMapping.mapping as NumberLikeMap, ([key, value]) =>
      value === typedTargetAgglomerateId ? [key, typedSourceAgglomerateId] : [key, value],
    ),
  ) as Mapping;
}

function* gatherInfoForOperation(
  action: ProofreadMergeAction | MinCutAgglomerateWithPositionAction,
  preparation: Preparation,
): Saga<Array<{
  agglomerateId: number;
  unmappedId: number;
  position: Vector3;
}> | null> {
  const { volumeTracing } = preparation;
  const { tracingId: volumeTracingId, activeCellId, activeUnmappedSegmentId } = volumeTracing;
  if (activeCellId === 0) return null;

  const segments = yield* select((store) => getSegmentsForLayer(store, volumeTracingId));
  const activeSegment = segments.getNullable(activeCellId);
  if (activeSegment == null) return null;
  const activeSegmentPositionFloat = activeSegment.somePosition;
  if (activeSegmentPositionFloat == null) return null;

  const activeSegmentPosition = V3.floor(activeSegmentPositionFloat);

  let sourcePosition: Vector3 | undefined;
  let targetPosition: Vector3 | undefined;

  if (action.position) {
    // The action was triggered via a data viewport (not 3D). In this case,
    // the active segment's position can be used as a source.
    if (activeUnmappedSegmentId != null) {
      // The user has selected a super-voxel in the 3D viewport and then clicked
      // in a data viewport to select the second merge partner. However, this mix
      // is currently not supported.
      Toast.warning(MISSING_INFORMATION_WARNING);
      return null;
    }
    sourcePosition = activeSegmentPosition;
    targetPosition = V3.floor(action.position);
    const idInfos = yield* call(getAgglomerateInfos, preparation.getMappedAndUnmapped, [
      sourcePosition,
      targetPosition,
    ]);
    if (idInfos == null) {
      return null;
    }
    const [idInfo1, idInfo2] = idInfos;
    return [
      { ...idInfo1, position: sourcePosition },
      { ...idInfo2, position: targetPosition },
    ];
  }

  // The action was triggered in the 3D viewport. In this case, we don't have
  // a mouse position and also the active segment position isn't necessarily
  // a position of the clicked super-voxel.
  if (
    action.agglomerateId == null ||
    activeCellId == null ||
    activeUnmappedSegmentId == null ||
    action.segmentId == null
  ) {
    Toast.warning(MISSING_INFORMATION_WARNING);
    console.log("Some fields were null:", {
      agglomerateId: action.agglomerateId,
      activeCellId,
      activeUnmappedSegmentId,
      segmentId: action.segmentId,
    });
    return null;
  }
  const targetSegmentId = action.segmentId;
  if (targetSegmentId == null) {
    Toast.warning(MISSING_INFORMATION_WARNING);
    console.log(`No position is known for agglomerate ${action.agglomerateId}`);
    return null;
  }
  if (action.type === "PROOFREAD_MERGE") {
    // When merging two segments, they can share the same seed position afterwards.
    // Also, using the active segment position is fine because it's definitely
    // matching the active agglomerate.
    // Therefore, we do so to avoid another roundtrip to the server.
    sourcePosition = activeSegmentPosition;
    targetPosition = activeSegmentPosition;
  } else {
    // When splitting two segments, we don't really have reliable positions at hand.
    // For the source position, we cannot rely on the active segment position, because
    // the active super-voxel doesn't necessarily match the last click position within
    // the data viewports.
    // For the target position, we also don't have reliable information available.
    [sourcePosition, targetPosition] = yield* all([
      call(getPositionForSegmentId, volumeTracing, activeUnmappedSegmentId),
      call(getPositionForSegmentId, volumeTracing, targetSegmentId),
    ]);
  }

  const idInfos = [
    { agglomerateId: activeCellId, unmappedId: activeUnmappedSegmentId, position: sourcePosition },
    { agglomerateId: action.agglomerateId, unmappedId: action.segmentId, position: targetPosition },
  ];

  return idInfos;
}
