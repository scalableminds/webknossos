import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery, put, call, all } from "typed-redux-saga";
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
import { getEdgesForAgglomerateMinCut, makeMappingEditable } from "admin/admin_rest_api";
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

export default function* proofreadRootSaga(): Saga<void> {
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* take("WK_READY");
  yield* takeEvery(
    ["DELETE_EDGE", "MERGE_TREES", "MIN_CUT_AGGLOMERATE"],
    splitOrMergeOrMinCutAgglomerate,
  );
  yield* takeEvery(["PROOFREAD_AT_POSITION"], proofreadAtPosition);
  yield* takeEvery(["CLEAR_PROOFREADING_BY_PRODUCTS"], clearProofreadingByproducts);
  yield* takeEvery(
    ["PROOFREAD_MERGE", "MIN_CUT_AGGLOMERATE_WITH_POSITION"],
    handleProofreadMergeOrMinCut,
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
  const { sourceAgglomerateId, targetAgglomerateId, volumeTracingWithEditableMapping } =
    partnerInfos;

  const editableMappingId = volumeTracingWithEditableMapping.mappingName;

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items: UpdateAction[] = [];
  if (action.type === "MERGE_TREES") {
    if (sourceAgglomerateId === targetAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      yield* put(setBusyBlockingInfoAction(false));
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
      yield* put(setBusyBlockingInfoAction(false));
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
    const shouldReturn = yield* call(
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
    if (shouldReturn) {
      return;
    }
  }

  if (items.length === 0) {
    yield* put(setBusyBlockingInfoAction(false));
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

  yield* put(setBusyBlockingInfoAction(false));

  yield* removeOldMeshesAndLoadUpdatedMeshes(
    layerName,
    sourceAgglomerateId,
    targetAgglomerateId,
    newSourceAgglomerateId,
    sourceNodePosition,
    newTargetAgglomerateId,
    targetNodePosition,
  );
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
    yield* put(setBusyBlockingInfoAction(false));
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
        yield* put(setBusyBlockingInfoAction(false));
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

function* clearProofreadingByproducts() {
  const volumeTracingLayer = yield* select((state) => getActiveSegmentationTracingLayer(state));
  if (volumeTracingLayer == null || volumeTracingLayer.tracingId == null) return;
  const layerName = volumeTracingLayer.tracingId;

  for (const segmentId of coarselyLoadedSegmentIds) {
    yield* put(removeMeshAction(layerName, segmentId));
  }
  coarselyLoadedSegmentIds = [];
}

function* handleProofreadMergeOrMinCut(
  action: ProofreadMergeAction | MinCutAgglomerateWithPositionAction,
) {
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

  const partnerInfos = yield* call(
    getPartnerAgglomerateIds,
    volumeTracingLayer,
    getDataValue,
    sourcePosition,
    targetPosition,
  );
  if (!partnerInfos) {
    return;
  }
  const { sourceAgglomerateId, targetAgglomerateId, volumeTracingWithEditableMapping } =
    partnerInfos;
  const editableMappingId = volumeTracingWithEditableMapping.mappingName;

  /* Send the respective split/merge update action to the backend (by pushing to the save queue
     and saving immediately) */

  const items: UpdateAction[] = [];

  if (action.type === "PROOFREAD_MERGE") {
    if (sourceAgglomerateId === targetAgglomerateId) {
      Toast.error("Segments that should be merged need to be in different agglomerates.");
      yield* put(setBusyBlockingInfoAction(false));
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
    if (partnerInfos.unmappedSourceId === partnerInfos.unmappedTargetId) {
      Toast.error(
        "The selected positions are both part of the same base segment and cannot be split. Please select another position or use the nodes of the agglomerate skeleton to perform the split.",
      );
      yield* put(setBusyBlockingInfoAction(false));
      return;
    }
    const shouldReturn = yield* call(
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
    if (shouldReturn) {
      return;
    }
  }

  if (items.length === 0) {
    yield* put(setBusyBlockingInfoAction(false));
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

  yield* put(setBusyBlockingInfoAction(false));

  yield* removeOldMeshesAndLoadUpdatedMeshes(
    layerName,
    sourceAgglomerateId,
    targetAgglomerateId,
    newSourceAgglomerateId,
    sourcePosition,
    newTargetAgglomerateId,
    targetPosition,
  );
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

function* getPartnerAgglomerateIds(
  volumeTracingLayer: APISegmentationLayer,
  getDataValue: (position: Vector3) => Promise<number>,
  sourcePosition: Vector3,
  targetPosition: Vector3,
): Saga<{
  volumeTracingWithEditableMapping: VolumeTracing & { mappingName: string };
  sourceAgglomerateId: number;
  targetAgglomerateId: number;
  unmappedSourceId: number;
  unmappedTargetId: number;
} | null> {
  const getUnmappedDataValue = yield* call(createGetUnmappedDataValueFn, volumeTracingLayer);
  if (!getUnmappedDataValue) {
    return null;
  }
  const [sourceAgglomerateId, targetAgglomerateId, unmappedSourceId, unmappedTargetId] = yield* all(
    [
      call(getDataValue, sourcePosition),
      call(getDataValue, targetPosition),
      call(getUnmappedDataValue, sourcePosition),
      call(getUnmappedDataValue, targetPosition),
    ],
  );

  const volumeTracingWithEditableMapping = yield* select((state) =>
    getActiveSegmentationTracing(state),
  );
  const mappingName = volumeTracingWithEditableMapping?.mappingName;
  if (volumeTracingWithEditableMapping == null || mappingName == null) {
    yield* put(setBusyBlockingInfoAction(false));
    return null;
  }
  if ([sourceAgglomerateId, targetAgglomerateId, unmappedSourceId, unmappedTargetId].includes(0)) {
    Toast.warning(
      "One of the selected segments has the id 0 which is the background. Cannot merge/split.",
    );
    yield* put(setBusyBlockingInfoAction(false));
    return null;
  }
  return {
    volumeTracingWithEditableMapping: { ...volumeTracingWithEditableMapping, mappingName },
    sourceAgglomerateId,
    targetAgglomerateId,
    unmappedSourceId,
    unmappedTargetId,
  };
}

function* removeOldMeshesAndLoadUpdatedMeshes(
  layerName: string,
  sourceAgglomerateId: number,
  targetAgglomerateId: number,
  newSourceAgglomerateId: number,
  sourceNodePosition: Vector3,
  newTargetAgglomerateId: number,
  targetNodePosition: Vector3,
) {
  if (proofreadUsingMeshes()) {
    // Remove old agglomerate mesh(es) and load updated agglomerate mesh(es)
    yield* put(removeMeshAction(layerName, sourceAgglomerateId));
    if (targetAgglomerateId !== sourceAgglomerateId) {
      yield* put(removeMeshAction(layerName, targetAgglomerateId));
    }

    // Segmentations with more than 3 dimensions are currently not compatible
    // with proofreading. Once such datasets appear, this parameter needs to be
    // adapted.
    const additionalCoordinates = undefined;
    yield* call(
      loadCoarseMesh,
      layerName,
      newSourceAgglomerateId,
      sourceNodePosition,
      additionalCoordinates,
    );
    if (newTargetAgglomerateId !== newSourceAgglomerateId) {
      yield* call(
        loadCoarseMesh,
        layerName,
        newTargetAgglomerateId,
        targetNodePosition,
        additionalCoordinates,
      );
    }
  }
}

function* createGetUnmappedDataValueFn(
  volumeTracingLayer: APISegmentationLayer,
): Saga<((nodePosition: Vector3) => Promise<number>) | null> {
  if (volumeTracingLayer.tracingId == null) return null;
  const layerName = volumeTracingLayer.tracingId;

  const resolutionInfo = getResolutionInfo(volumeTracingLayer.resolutions);
  const mag = resolutionInfo.getFinestResolution();

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
      mag,
    );

    return Number(new TypedArrayClass(buffer)[0]);
  };
}
