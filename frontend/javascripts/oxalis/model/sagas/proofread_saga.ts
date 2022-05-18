import type { Saga } from "oxalis/model/sagas/effect-generators";
import { takeEvery, put, call } from "typed-redux-saga";
import { select, take } from "oxalis/model/sagas/effect-generators";
import { AnnotationToolEnum, MappingStatusEnum } from "oxalis/constants";
import Toast from "libs/toast";
import type {
  DeleteEdgeAction,
  MergeTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import {
  initializeEditableMappingAction,
  setMappingisEditableAction,
} from "oxalis/model/actions/volumetracing_actions";
import {
  enforceSkeletonTracing,
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
import { getMappingInfo, getResolutionInfo } from "oxalis/model/accessors/dataset_accessor";
import { makeMappingEditable } from "admin/admin_rest_api";
import { setMappingAction, setMappingNameAction } from "oxalis/model/actions/settings_actions";

export default function* proofreadMapping(): Saga<any> {
  yield* take("INITIALIZE_SKELETONTRACING");
  yield* take("WK_READY");
  yield* takeEvery(["DELETE_EDGE", "MERGE_TREES"], splitOrMergeAgglomerate);
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
  const agglomerateFileMag = resolutionInfo.getHighestResolution();
  const agglomerateFileZoomstep = resolutionInfo.getHighestResolutionIndex();
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
}
