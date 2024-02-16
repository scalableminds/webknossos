import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery, put, call, all, fork } from "typed-redux-saga";
import { select, take } from "oxalis/model/sagas/effect-generators";
import { AnnotationToolEnum, MappingStatusEnum, TreeTypeEnum, Vector3 } from "oxalis/constants";
import Toast from "libs/toast";
import {
  type CreateNodeAction,
  type DeleteNodeAction,
  deleteEdgeAction,
  type DeleteEdgeAction,
  type MergeTreesAction,
  setTreeNameAction,
  type SetNodePositionAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  initializeEditableMappingAction,
  setMappingIsEditableAction,
} from "oxalis/model/actions/volumetracing_actions";
import type {
  CutAgglomerateFromNeighborsAction,
  MinCutAgglomerateAction,
  MinCutAgglomerateWithPositionAction,
  ProofreadAtPositionAction,
  ProofreadMergeAction,
} from "oxalis/model/actions/proofread_actions";
import {
  enforceSkeletonTracing,
  findTreeByNodeId,
  getNodeAndTree,
  getTreeNameForAgglomerateSkeleton,
} from "oxalis/model/accessors/skeletontracing_accessor";
import {
  pushSaveQueueTransaction,
  setVersionNumberAction,
} from "oxalis/model/actions/save_actions";
import {
  splitAgglomerate,
  mergeAgglomerate,
  UpdateAction,
} from "oxalis/model/sagas/update_actions";
import { Model, api, Store } from "oxalis/singletons";
import {
  getActiveSegmentationTracingLayer,
  getActiveSegmentationTracing,
  getSegmentsForLayer,
} from "oxalis/model/accessors/volumetracing_accessor";
import {
  getLayerByName,
  getMappingInfo,
  getResolutionInfo,
} from "oxalis/model/accessors/dataset_accessor";
import {
  NeighborInfo,
  getEdgesForAgglomerateMinCut,
  getNeighborsForAgglomerateNode,
  makeMappingEditable,
} from "admin/admin_rest_api";
import { setMappingNameAction } from "oxalis/model/actions/settings_actions";
import { getSegmentIdForPositionAsync } from "oxalis/controller/combinations/volume_handlers";
import {
  loadAdHocMeshAction,
  loadPrecomputedMeshAction,
} from "oxalis/model/actions/segmentation_actions";
import { V3 } from "libs/mjs";
import { removeMeshAction } from "oxalis/model/actions/annotation_actions";
import { getConstructorForElementClass } from "oxalis/model/bucket_data_handling/bucket";
import { Tree, VolumeTracing } from "oxalis/store";
import { APISegmentationLayer } from "types/api_flow_types";
import { setBusyBlockingInfoAction } from "oxalis/model/actions/ui_actions";
import _ from "lodash";
import { type AdditionalCoordinate } from "types/api_flow_types";
import { takeEveryUnlessBusy } from "./saga_helpers";
import { Action } from "../actions/actions";

export default function* proofreadRootSaga(): Saga<void> {
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* take("WK_READY");
  yield* takeEveryUnlessBusy(
    ["DELETE_EDGE", "MERGE_TREES", "MIN_CUT_AGGLOMERATE"],
    handleSkeletonProofreadingAction,
    "Proofreading in progress",
  );
  yield* takeEvery(["PROOFREAD_AT_POSITION"], proofreadAtPosition);
  yield* takeEvery(["CLEAR_PROOFREADING_BY_PRODUCTS"], clearProofreadingByproducts);
  yield* takeEveryUnlessBusy(
    ["PROOFREAD_MERGE", "MIN_CUT_AGGLOMERATE_WITH_POSITION"],
    handleProofreadMergeOrMinCutOrCutNeighbors,
    "Proofreading in progress",
  );
  yield* takeEveryUnlessBusy(
    ["CUT_AGGLOMERATE_FROM_NEIGHBORS"],
    handleProofreadCutNeighbors,
    "Proofreading in progress",
  );

  yield* takeEvery(
    ["CREATE_NODE", "DELETE_NODE", "SET_NODE_POSITION"],
    checkForAgglomerateSkeletonModification,
  );
}

function proofreadCoarseResolutionIndex(): number {
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
  if ((yield* select((state) => state.userConfiguration.autoRenderMeshInProofreading)) === false)
    return;
  const currentMeshFile = yield* select(
    (state) => state.localSegmentationData[layerName].currentMeshFile,
  );

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
      ),
    );
  } else {
    const mappingInfo = yield* select((state) =>
      getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
    );
    const { mappingName, mappingType } = mappingInfo;

    // Load the whole agglomerate mesh in a coarse resolution for performance reasons
    const preferredQuality = proofreadCoarseResolutionIndex();
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

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.tracing));

  getNodeAndTree(skeletonTracing, nodeId, treeId, TreeTypeEnum.AGGLOMERATE).map((_) => {
    Toast.warning(
      "Agglomerate skeletons can only be modified when using the proofreading tool to add or delete edges. Consider switching to the proofreading tool or converting the skeleton to a normal tree via right-click in the Skeleton tab.",
      { timeout: 10000 },
    );
  });
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

  /* Load a coarse ad hoc mesh of the agglomerate at the click position */
  yield* call(loadCoarseMesh, layerName, segmentId, position, additionalCoordinates);
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

function* handleSkeletonProofreadingAction(action: Action): Saga<void> {
  // Actually, action is MergeTreesAction | DeleteEdgeAction | MinCutAgglomerateAction,
  // but the takeEveryUnlessBusy wrapper does not understand this.
  if (
    action.type !== "MERGE_TREES" &&
    action.type !== "DELETE_EDGE" &&
    action.type !== "MIN_CUT_AGGLOMERATE"
  ) {
    return;
  }
  // Handles split, merge and min-cut actions on agglomerates.

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

  const { sourceNodeId, targetNodeId } = action;

  const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.tracing));

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
  const isProofreadingToolActive = activeTool === AnnotationToolEnum.PROOFREAD;

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

  const sourceNodePosition = sourceTree.nodes.get(sourceNodeId).position;
  const targetNodePosition = targetTree.nodes.get(targetNodeId).position;

  const partnerInfos = yield* call(getAgglomerateInfos, volumeTracing, getDataValue, [
    sourceNodePosition,
    targetNodePosition,
  ]);
  if (!partnerInfos) {
    return;
  }
  const { volumeTracingWithEditableMapping, idInfos } = partnerInfos;
  const [sourceInfo, targetInfo] = idInfos;
  const sourceAgglomerateId = sourceInfo.agglomerateId;
  const targetAgglomerateId = targetInfo.agglomerateId;

  const editableMappingId = volumeTracingWithEditableMapping.mappingName;

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items: UpdateAction[] = [];
  if (action.type === "MERGE_TREES") {
    if (sourceAgglomerateId === targetAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      return;
    }
    items.push(
      mergeAgglomerate(
        sourceAgglomerateId,
        targetAgglomerateId,
        sourceNodePosition,
        targetNodePosition,
        agglomerateFileMag,
      ),
    );
  } else if (action.type === "DELETE_EDGE") {
    if (sourceAgglomerateId !== targetAgglomerateId) {
      Toast.error("Segments that should be split need to be in the same agglomerate.");
      return;
    }
    items.push(
      splitAgglomerate(
        sourceAgglomerateId,
        sourceNodePosition,
        targetNodePosition,
        agglomerateFileMag,
      ),
    );
  } else if (action.type === "MIN_CUT_AGGLOMERATE") {
    const hasErrored = yield* call(
      performMinCut,
      sourceAgglomerateId,
      targetAgglomerateId,
      sourceNodePosition,
      targetNodePosition,
      agglomerateFileMag,
      editableMappingId,
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

  yield* put(pushSaveQueueTransaction(items, "mapping", volumeTracingId));
  yield* call([Model, Model.ensureSavedState]);

  /* Reload the segmentation */
  yield* call([api.data, api.data.reloadBuckets], layerName, (bucket) =>
    bucket.containsValue(targetAgglomerateId),
  );

  const [newSourceAgglomerateId, newTargetAgglomerateId] = yield* all([
    call(getDataValue, sourceNodePosition),
    call(getDataValue, targetNodePosition),
  ]);

  /* Rename agglomerate skeleton(s) according to their new id and mapping name */

  yield* put(
    setTreeNameAction(
      getTreeNameForAgglomerateSkeleton(
        newSourceAgglomerateId,
        volumeTracingWithEditableMapping.mappingName,
      ),
      sourceTree.treeId,
    ),
  );
  if (sourceTree !== targetTree) {
    yield* put(
      setTreeNameAction(
        getTreeNameForAgglomerateSkeleton(
          newTargetAgglomerateId,
          volumeTracingWithEditableMapping.mappingName,
        ),
        targetTree.treeId,
      ),
    );
  }

  const pack = (agglomerateId: number, newAgglomerateId: number, nodePosition: Vector3) => ({
    agglomerateId,
    newAgglomerateId,
    nodePosition,
  });

  // todop: test fork
  // We fork here to avoid that the user is blocked (via isBusy) while the
  // meshes are refreshed.
  yield* fork(refreshAffectedMeshes, layerName, [
    pack(sourceAgglomerateId, newSourceAgglomerateId, sourceNodePosition),
    pack(targetAgglomerateId, newTargetAgglomerateId, targetNodePosition),
  ]);
}

function* performMinCut(
  sourceAgglomerateId: number,
  targetAgglomerateId: number,
  sourcePosition: Vector3,
  targetPosition: Vector3,
  agglomerateFileMag: Vector3,
  editableMappingId: string,
  volumeTracingId: string,
  sourceTree: Tree | null,
  items: UpdateAction[],
): Saga<boolean> {
  if (sourceAgglomerateId !== targetAgglomerateId) {
    Toast.error(
      "Segments need to be in the same agglomerate to perform a min-cut splitting operation.",
    );
    return true;
  }

  currentlyPerformingMinCut = true;
  const tracingStoreUrl = yield* select((state) => state.tracing.tracingStore.url);
  const segmentsInfo = {
    segmentPosition1: sourcePosition,
    segmentPosition2: targetPosition,
    mag: agglomerateFileMag,
    agglomerateId: sourceAgglomerateId,
    editableMappingId,
  };

  const edgesToRemove = yield* call(
    getEdgesForAgglomerateMinCut,
    tracingStoreUrl,
    volumeTracingId,
    segmentsInfo,
  );

  for (const edge of edgesToRemove) {
    if (sourceTree) {
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
        currentlyPerformingMinCut = false;
        return true;
      }
      yield* put(deleteEdgeAction(firstNodeId, secondNodeId));
    }

    items.push(
      splitAgglomerate(sourceAgglomerateId, edge.position1, edge.position2, agglomerateFileMag),
    );
  }
  currentlyPerformingMinCut = false;

  return false;
}

function* performCutFromNeighbors(
  agglomerateId: number,
  segmentPosition: Vector3,
  agglomerateFileMag: Vector3,
  editableMappingId: string,
  volumeTracingId: string,
  sourceTree: Tree | null,
  items: UpdateAction[],
): Saga<
  { didCancel: false; neighborInfo: NeighborInfo } | { didCancel: true; neighborInfo?: null }
> {
  // todop: do we need this?
  // currentlyPerformingMinCut = true;
  const tracingStoreUrl = yield* select((state) => state.tracing.tracingStore.url);
  const segmentsInfo = {
    segmentPosition,
    mag: agglomerateFileMag,
    agglomerateId,
    editableMappingId,
  };

  const neighborInfo = yield* call(
    getNeighborsForAgglomerateNode,
    tracingStoreUrl,
    volumeTracingId,
    segmentsInfo,
  );

  const edgesToRemove = neighborInfo.neighbors.map((neighbor) => ({
    position1: neighbor.position,
    position2: segmentPosition,
    segmentId1: neighbor.segmentId,
    segmentId2: agglomerateId,
  }));

  for (const edge of edgesToRemove) {
    if (sourceTree) {
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
        // currentlyPerformingMinCut = false;
        return { didCancel: true };
      }
      yield* put(deleteEdgeAction(firstNodeId, secondNodeId));
    }

    items.push(splitAgglomerate(agglomerateId, edge.position1, edge.position2, agglomerateFileMag));
  }
  // currentlyPerformingMinCut = false;

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

function* handleProofreadMergeOrMinCutOrCutNeighbors(action: Action) {
  // Actually, action is ProofreadMergeAction | MinCutAgglomerateWithPositionAction | CutAgglomerateFromNeighborsAction
  // but the takeEveryUnlessBusy wrapper does not understand this.
  if (
    action.type !== "PROOFREAD_MERGE" &&
    action.type !== "MIN_CUT_AGGLOMERATE_WITH_POSITION" &&
    action.type !== "CUT_AGGLOMERATE_FROM_NEIGHBORS"
  ) {
    return;
  }

  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;
  const { tracingId: volumeTracingId, activeCellId } = volumeTracing;
  if (activeCellId === 0) return;

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

  const segments = yield* select((store) => getSegmentsForLayer(store, layerName));
  const sourcePositionMaybe = segments.getNullable(activeCellId)?.somePosition;
  if (sourcePositionMaybe == null) return;

  const sourcePosition = V3.floor(sourcePositionMaybe);
  const targetPosition = V3.floor(action.position);

  const partnerInfos = yield* call(getAgglomerateInfos, volumeTracing, getDataValue, [
    sourcePosition,
    targetPosition,
  ]);
  if (!partnerInfos) {
    return;
  }
  const { volumeTracingWithEditableMapping, idInfos } = partnerInfos;
  const [sourceInfo, targetInfo] = idInfos;
  const sourceAgglomerateId = sourceInfo.agglomerateId;
  const targetAgglomerateId = targetInfo.agglomerateId;

  const editableMappingId = volumeTracingWithEditableMapping.mappingName;

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items: UpdateAction[] = [];

  if (action.type === "PROOFREAD_MERGE") {
    if (sourceAgglomerateId === targetAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      return;
    }
    items.push(
      mergeAgglomerate(
        sourceAgglomerateId,
        targetAgglomerateId,
        sourcePosition,
        targetPosition,
        agglomerateFileMag,
      ),
    );
  } else if (action.type === "MIN_CUT_AGGLOMERATE_WITH_POSITION") {
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
      sourcePosition,
      targetPosition,
      agglomerateFileMag,
      editableMappingId,
      volumeTracingId,
      null,
      items,
    );
    if (hasErrored) {
      return;
    }
  }
  // } else if (action.type === "CUT_AGGLOMERATE_FROM_NEIGHBORS") {
  //   const { didCancel, neighborInfo } = yield* call(
  //     performCutFromNeighbors,
  //     // We ignore the active (source) agglomerate, because the action
  //     // only depends on the clicked agglomerate.
  //     targetAgglomerateId,
  //     targetPosition,
  //     agglomerateFileMag,
  //     editableMappingId,
  //     volumeTracingId,
  //     null,
  //     items,
  //   );
  //   if (hasErrored) {
  //     return;
  //   }
  // }

  if (items.length === 0) {
    return;
  }

  yield* put(pushSaveQueueTransaction(items, "mapping", volumeTracingId));
  yield* call([Model, Model.ensureSavedState]);

  /* Reload the segmentation */
  yield* call([api.data, api.data.reloadBuckets], layerName, (bucket) =>
    bucket.containsValue(targetAgglomerateId),
  );

  const [newSourceAgglomerateId, newTargetAgglomerateId] = yield* all([
    call(getDataValue, sourcePosition),
    call(getDataValue, targetPosition),
  ]);

  /* Reload agglomerate skeleton */
  if (volumeTracing.mappingName == null) return;

  yield* refreshAffectedMeshes(layerName, [
    {
      agglomerateId: sourceAgglomerateId,
      newAgglomerateId: newSourceAgglomerateId,
      nodePosition: sourcePosition,
    },
    {
      agglomerateId: targetAgglomerateId,
      newAgglomerateId: newTargetAgglomerateId,
      nodePosition: targetPosition,
    },
  ]);
}

function* handleProofreadCutNeighbors(action: Action) {
  // Actually, action is ProofreadMergeAction | MinCutAgglomerateWithPositionAction | CutAgglomerateFromNeighborsAction
  // but the takeEveryUnlessBusy wrapper does not understand this.
  if (action.type !== "CUT_AGGLOMERATE_FROM_NEIGHBORS") {
    return;
  }

  const allowUpdate = yield* select((state) => state.tracing.restrictions.allowUpdate);
  if (!allowUpdate) return;

  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null) return;
  const volumeTracing = yield* select((state) => getActiveSegmentationTracing(state));
  if (volumeTracing == null) return;
  const { tracingId: volumeTracingId, activeCellId } = volumeTracing;
  if (activeCellId === 0) return;

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

  const targetPosition = V3.floor(action.position);

  const partnerInfos = yield* call(getAgglomerateInfos, volumeTracing, getDataValue, [
    targetPosition,
  ]);
  if (!partnerInfos) {
    return;
  }
  const { volumeTracingWithEditableMapping, idInfos } = partnerInfos;
  const targetAgglomerateId = idInfos[0].agglomerateId;

  const editableMappingId = volumeTracingWithEditableMapping.mappingName;

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items: UpdateAction[] = [];

  const { didCancel, neighborInfo } = yield* call(
    performCutFromNeighbors,
    // We ignore the active (source) agglomerate, because the action
    // only depends on the clicked agglomerate.
    targetAgglomerateId,
    targetPosition,
    agglomerateFileMag,
    editableMappingId,
    volumeTracingId,
    null,
    items,
  );
  if (didCancel) {
    return;
  }

  if (items.length === 0) {
    return;
  }

  yield* put(pushSaveQueueTransaction(items, "mapping", volumeTracingId));
  yield* call([Model, Model.ensureSavedState]);

  /* Reload the segmentation */
  yield* call([api.data, api.data.reloadBuckets], layerName, (bucket) =>
    bucket.containsValue(targetAgglomerateId),
  );

  const [newTargetAgglomerateId, ...newNeighborAgglomerateIds] = yield* all([
    call(getDataValue, targetPosition),
    ...neighborInfo.neighbors.map((neighbor) => call(getDataValue, neighbor.position)),
  ]);

  /* Reload agglomerate skeleton */
  if (volumeTracing.mappingName == null) return;

  yield* refreshAffectedMeshes(layerName, [
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

function* prepareSplitOrMerge(
  volumeTracingId: string,
  volumeTracing: VolumeTracing,
  volumeTracingLayer: APISegmentationLayer,
): Saga<{
  layerName: string;
  agglomerateFileMag: Vector3;
  getDataValue: (position: Vector3) => Promise<number>;
} | null> {
  const layerName = volumeTracingId;
  const isHdf5MappingEnabled = yield* call(ensureHdf5MappingIsEnabled, layerName);
  if (!isHdf5MappingEnabled) {
    return null;
  }

  if (!volumeTracing.mappingIsEditable) {
    try {
      yield* call(createEditableMapping);
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  const resolutionInfo = getResolutionInfo(volumeTracingLayer.resolutions);
  // The mag the agglomerate skeleton corresponds to should be the finest available mag of the volume tracing layer
  const agglomerateFileMag = resolutionInfo.getFinestResolution();
  const agglomerateFileZoomstep = resolutionInfo.getFinestResolutionIndex();

  const getDataValue = (position: Vector3) => {
    const { additionalCoordinates } = Store.getState().flycam;
    return api.data.getDataValue(
      layerName,
      position,
      agglomerateFileZoomstep,
      additionalCoordinates,
    );
  };

  return { layerName, agglomerateFileMag, getDataValue };
}

function* getAgglomerateInfos(
  volumeTracing: VolumeTracing,
  getDataValue: (position: Vector3) => Promise<number>,
  positions: Vector3[],
): Saga<{
  volumeTracingWithEditableMapping: VolumeTracing & { mappingName: string };
  idInfos: Array<{
    agglomerateId: number;
    unmappedId: number;
  }>;
} | null> {
  const getUnmappedDataValue = yield* call(createGetUnmappedDataValueFn, volumeTracing);

  const getMappedAndUnmapped = async (position: Vector3) => {
    const [agglomerateId, unmappedId] = await Promise.all([
      getDataValue(position),
      getUnmappedDataValue(position),
    ]);
    return { agglomerateId, unmappedId };
  };

  const idInfos = yield* all(positions.map((pos) => call(getMappedAndUnmapped, pos)));

  const volumeTracingWithEditableMapping = yield* select((state) =>
    getActiveSegmentationTracing(state),
  );
  const mappingName = volumeTracingWithEditableMapping?.mappingName;
  if (volumeTracingWithEditableMapping == null || mappingName == null) {
    return null;
  }
  if (idInfos.find((idInfo) => idInfo.agglomerateId === 0 || idInfo.unmappedId === 0) != null) {
    console.warn("At least one id was zero:", idInfos);
    Toast.warning(
      "One of the selected segments has the id 0 which is the background. Cannot merge/split.",
    );
    return null;
  }
  return {
    volumeTracingWithEditableMapping: { ...volumeTracingWithEditableMapping, mappingName },
    idInfos,
  };
}

function* refreshAffectedMeshes(
  layerName: string,
  items: Array<{
    agglomerateId: number;
    newAgglomerateId: number;
    nodePosition: Vector3;
  }>,
) {
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
      yield* put(removeMeshAction(layerName, item.agglomerateId));
      removedIds.add(item.agglomerateId);
    }
    if (!newlyLoadedIds.has(item.newAgglomerateId)) {
      yield* call(
        loadCoarseMesh,
        layerName,
        item.newAgglomerateId,
        item.nodePosition,
        additionalCoordinates,
      );
      newlyLoadedIds.add(item.newAgglomerateId);
    }
  }
}

function* createGetUnmappedDataValueFn(
  volumeTracing: VolumeTracing,
): Saga<(nodePosition: Vector3) => Promise<number>> {
  const layerName = volumeTracing.tracingId;
  const layer = yield* select((state) => getLayerByName(state.dataset, layerName));

  const resolutionInfo = getResolutionInfo(layer.resolutions);
  const mag = resolutionInfo.getFinestResolution();

  const fallbackLayerName = volumeTracing.fallbackLayer;
  if (fallbackLayerName == null) {
    // todop: should not happen, right?
    throw new Error("No fallback layer exists for volume tracing during proofreading.");
  }

  const TypedArrayClass = getConstructorForElementClass(layer.elementClass)[0];

  return async (nodePosition: Vector3) => {
    const buffer = await api.data.getRawDataCuboid(
      fallbackLayerName,
      nodePosition,
      V3.add(nodePosition, mag),
      mag,
    );

    return Number(new TypedArrayClass(buffer)[0]);
  };
}
