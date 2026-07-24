import {
  getAgglomeratesForSegmentsFromTracingstore,
  getPositionForSegmentInAgglomerate,
} from "admin/rest_api";
import { toBigInt } from "libs/bigint_helpers";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import { isNumberMap, SoftError } from "libs/utils";
import { all, call, put } from "typed-redux-saga";
import type { ServerEditableMapping } from "types/api_types";
import { MappingStatusEnum, type Vector3 } from "viewer/constants";
import { getMagInfo, getMappingInfo } from "viewer/model/accessors/dataset_accessor";
import {
  getActiveSegmentationTracing,
  getActiveSegmentationTracingLayer,
  getActiveUnmappedSegmentId,
  getEditableMappingForVolumeTracingId,
  getSegmentsForLayer,
} from "viewer/model/accessors/volumetracing_accessor";
import type {
  MinCutAgglomerateWithPositionAction,
  ProofreadMergeAction,
} from "viewer/model/actions/proofread_actions";
import { setMappingNameAction } from "viewer/model/actions/settings_actions";
import { setTreesAgglomerateInfoTracingIdAction } from "viewer/model/actions/skeletontracing_actions";
import {
  initializeEditableMappingAction,
  setHasEditableMappingAction,
} from "viewer/model/actions/volumetracing_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { getAgglomeratesForSegmentIds } from "viewer/model/sagas/volume/mapping_saga";
import { api, Store } from "viewer/singletons";
import type { ActiveMappingInfo, Mapping, VolumeTracing } from "viewer/store";
import { getCurrentMag } from "../../../accessors/flycam_accessor";
import type { OperationContext } from "../../operation_context_saga";
import { syncWithBackend } from "./backend_sync_helper_sagas";
import type {
  GatheredInfos,
  IdInfo,
  IdInfoOpt,
  IdInfoWithoutPosition,
  Preparation,
} from "./proofreading_types";

export function* createEditableMapping(ctx?: OperationContext): Saga<string> {
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
  // This needs to happen before initializeEditableMappingAction is dispatched, because the backend wouldn't be
  // able to handle mapping requests that might be triggered right after initializing the mapping.
  yield* call(syncWithBackend, ctx);

  const editableMapping: ServerEditableMapping = {
    baseMappingName: baseMappingName,
    tracingId: volumeTracingId,
    createdTimestamp: Date.now(),
  };
  yield* put(initializeEditableMappingAction(editableMapping));

  yield* put(setTreesAgglomerateInfoTracingIdAction(volumeTracingId));
  // Save, that the agglomerate info of all agglomerate trees was updated.
  yield* call(syncWithBackend, ctx);

  return volumeTracingId;
}

export function* ensureHdf5MappingIsEnabled(layerName: string): Saga<boolean> {
  const mappingInfo = yield* select((state) =>
    getMappingInfo(state.temporaryConfiguration.activeMappingByLayer, layerName),
  );
  const { mappingName, mappingType, mappingStatus } = mappingInfo;
  if (
    mappingName == null ||
    mappingType == null ||
    mappingType === "JSON" ||
    mappingStatus === MappingStatusEnum.DISABLED
  ) {
    Toast.error("An HDF5 mapping needs to be enabled to use the proofreading tool.");
    return false;
  }

  return true;
}

// Looks up `key` (a segment/agglomerate id) in a Mapping (which is either number- or
// BigInt-keyed/valued, depending on whether the dataset is uint32- or uint64-backed) and
// returns the mapped value as a bigint. This avoids the lossy Number()-based
// NumberLikeMapWrapper#getAsNumber for scalar id lookups (see #6921).
export function getMappedIdAsBigInt(mapping: Mapping, key: bigint): bigint | undefined {
  const mapped = isNumberMap(mapping) ? mapping.get(Number(key)) : mapping.get(key);
  return mapped == null ? undefined : BigInt(mapped);
}

export function lookupAgglomerateId(
  activeMapping: ActiveMappingInfo,
  unmappedId: bigint,
  fallback: bigint,
): bigint {
  if (activeMapping.mapping == null) return fallback;
  return getMappedIdAsBigInt(activeMapping.mapping, unmappedId) ?? fallback;
}

export const MISSING_INFORMATION_WARNING =
  "Please use either the data viewports OR the 3D viewport (but not both) for selecting the partners of a proofreading operation.";

export function* prepareSplitOrMerge(
  isTreeProofreading: boolean,
  ctx: OperationContext,
): Saga<Preparation | null> {
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
      mappingName = yield* call(createEditableMapping, ctx);
    } catch (e) {
      console.error(e);
      return null;
    }
  }

  const magInfo = getMagInfo(volumeTracingLayer.mags);
  const currentMag = yield* select((state) => getCurrentMag(state, volumeTracingLayer.name));

  const agglomerateFileMag = isTreeProofreading
    ? // In case of tree proofreading, the finest mag should be used.
      magInfo.getFinestMag()
    : // For non-tree proofreading, the active mag suffices
      currentMag;
  if (agglomerateFileMag == null) {
    return null;
  }
  const agglomerateFileZoomstep = magInfo.getIndexByMag(agglomerateFileMag);

  const getUnmappedDataValue = async (position: Vector3): Promise<bigint> => {
    const { additionalCoordinates } = Store.getState().flycam;
    const rawId = await api.data.getDataValue(
      volumeTracing.tracingId,
      position,
      agglomerateFileZoomstep,
      additionalCoordinates,
    );
    return toBigInt(rawId);
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
  ): Promise<bigint> => {
    const unmappedId = await getUnmappedDataValue(position);
    return mapSegmentId(unmappedId, overrideMapping);
  };

  const mapSegmentId = (segmentId: bigint, overrideMapping: Mapping | null = null): bigint => {
    const mappingToAccess = overrideMapping ?? mapping;
    const mappedId = getMappedIdAsBigInt(mappingToAccess, segmentId);
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

  const getMappedAndUnmapped = function* (position: Vector3) {
    const unmappedId = yield* call(getUnmappedDataValue, position);
    let agglomerateId = getMappedIdAsBigInt(mapping, unmappedId);

    if (agglomerateId == null) {
      const fetchedEntries = yield* call(
        getAgglomeratesForSegmentIds,
        volumeTracing.tracingId,
        volumeTracingLayer,
        mappingName,
        new Set([unmappedId]),
      );
      agglomerateId = getMappedIdAsBigInt(fetchedEntries, unmappedId);
      if (agglomerateId == null) {
        throw new SoftError(
          `Could not map id ${unmappedId} at position ${position}. The mapped partner might not be known yet. Please retry.`,
        );
      }
    }
    return { agglomerateId, unmappedId };
  };

  const activeMapping = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer[volumeTracing.tracingId],
  );

  if (activeMapping.mapping == null) {
    Toast.error("Active mapping is not available, cannot proofread.");
    return null;
  }

  // Getting latest annotation version as it might have changed due to e.g. making the mapping editable.
  const annotationVersion = yield* select((state) => state.annotation.version);

  return {
    agglomerateFileMag,
    getDataValue,
    getMappedAndUnmapped,
    mapSegmentId,
    activeMapping,
    volumeTracing: { ...volumeTracing, mappingName },
    annotationVersion,
  };
}

export function* reloadMappingAndAggloIds(
  tracingId: string,
  unmappedSourceId: bigint,
  unmappedTargetId: bigint,
) {
  const activeMapping = yield* select(
    (store) => store.temporaryConfiguration.activeMappingByLayer[tracingId],
  );

  if (activeMapping.mapping != null) {
    const maybeSourceAgglomerateId = getMappedIdAsBigInt(activeMapping.mapping, unmappedSourceId);
    const maybeTargetAgglomerateId = getMappedIdAsBigInt(activeMapping.mapping, unmappedTargetId);

    if (maybeSourceAgglomerateId != null && maybeTargetAgglomerateId != null) {
      return {
        sourceAgglomerateId: maybeSourceAgglomerateId,
        targetAgglomerateId: maybeTargetAgglomerateId,
        activeMapping,
      };
    }

    // As an additional safety net we look up the IDs again. Actually,
    // this should not happen in production.
    const segmentsToRequest = new Set([unmappedSourceId, unmappedTargetId]);
    const tracingStoreUrl = yield* select((state) => state.annotation.tracingStore.url);
    const annotationVersion = yield* select((state) => state.annotation.version);
    const annotationId = yield* select((state) => state.annotation.annotationId);

    const missingMappingInfo = yield* call(
      getAgglomeratesForSegmentsFromTracingstore,
      tracingStoreUrl,
      tracingId,
      segmentsToRequest,
      annotationId,
      annotationVersion,
    );
    const maybeSourceAgglomerateIdFromServer = getMappedIdAsBigInt(
      missingMappingInfo,
      unmappedSourceId,
    );
    const maybeTargetAgglomerateIdFromServer = getMappedIdAsBigInt(
      missingMappingInfo,
      unmappedTargetId,
    );
    if (maybeSourceAgglomerateIdFromServer == null || maybeTargetAgglomerateIdFromServer == null) {
      throw new SoftError(
        `Could not look up agglomerate id for unmapped segment id ${unmappedSourceId} or ${unmappedTargetId}.`,
      );
    }
    return {
      sourceAgglomerateId: maybeSourceAgglomerateIdFromServer,
      targetAgglomerateId: maybeTargetAgglomerateIdFromServer,
      activeMapping,
    };
  }
}

export function* getAgglomerateInfos(
  getMappedAndUnmapped: (position: Vector3) => Saga<{ agglomerateId: bigint; unmappedId: bigint }>,
  positions: Vector3[],
): Saga<Array<IdInfoWithoutPosition> | null> {
  try {
    const idInfos = yield* all(positions.map((pos) => call(getMappedAndUnmapped, pos)));
    if (idInfos.find((idInfo) => idInfo.agglomerateId === 0n || idInfo.unmappedId === 0n) != null) {
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

export function* getPositionForSegmentId(
  volumeTracing: VolumeTracing,
  segmentId: bigint,
): Saga<Vector3> {
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
    dataset.id,
    volumeTracing.fallbackLayer,
    editableMapping.baseMappingName,
    segmentId,
  );
  return position;
}

export function* gatherInfoForOperation(
  action: ProofreadMergeAction | MinCutAgglomerateWithPositionAction,
  preparation: Preparation,
): Saga<GatheredInfos | null> {
  const { volumeTracing } = preparation;
  const { tracingId: volumeTracingId, activeCellId } = volumeTracing;
  const activeUnmappedSegmentId = yield* select((state) =>
    getActiveUnmappedSegmentId(state, volumeTracing),
  );
  if (activeCellId === 0n) {
    console.warn("[Proofreading] Cannot execute operation because active segment id is 0");
    return null;
  }

  const segments = yield* select((store) => getSegmentsForLayer(store, volumeTracingId));
  const activeSegment = segments.getNullable(activeCellId);
  if (activeSegment == null) {
    console.warn("[Proofreading] Cannot execute operation because no active segment item exists");
    return null;
  }
  const activeSegmentPositionFloat = activeSegment.anchorPosition;
  if (activeSegmentPositionFloat == null) {
    console.warn("[Proofreading] Cannot execute operation because active segment has no position");
    return null;
  }

  const activeSegmentPosition = V3.floor(activeSegmentPositionFloat);

  let sourcePosition: Vector3 | undefined;
  let targetPosition: Vector3 | undefined;

  if (action.position) {
    // The action was triggered via a data viewport (not 3D). In this case,
    // the active segment's position can be used as a source.
    if (activeUnmappedSegmentId != null) {
      // The user has selected a supervoxel in the 3D viewport and then clicked
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
      console.warn(
        "[Proofreading] Cannot execute operation because agglomerate infos couldn't be determined for source and target position.",
      );
      return null;
    }
    const [idInfo1, idInfo2] = idInfos;
    return {
      type: action.type,
      infos: [
        { ...idInfo1, position: sourcePosition },
        { ...idInfo2, position: targetPosition },
      ],
    };
  }

  // The action was triggered in the 3D viewport. In this case, we don't have
  // a mouse position and also the active segment position isn't necessarily
  // a position of the clicked supervoxel.
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

  if (action.type === "PROOFREAD_MERGE") {
    const idInfos: [IdInfo, IdInfoOpt] = [
      {
        agglomerateId: activeCellId,
        unmappedId: activeUnmappedSegmentId,
        position: activeSegmentPosition,
      },
      {
        agglomerateId: action.agglomerateId,
        unmappedId: action.segmentId,
        // Strictly speaking, we do not have a valid position for the target segment
        // here. *After* the merge, the source position would also be valid for
        // the target, but we leave that logic to the caller.
        position: undefined,
      },
    ];

    return {
      type: action.type,
      infos: idInfos,
    };
  }
  // When splitting two segments, we don't really have reliable positions at hand.
  // For the source position, we cannot rely on the active segment position, because
  // the active supervoxel doesn't necessarily match the last click position within
  // the data viewports.
  // For the target position, we also don't have reliable information available.
  [sourcePosition, targetPosition] = yield* all([
    call(getPositionForSegmentId, volumeTracing, activeUnmappedSegmentId),
    call(getPositionForSegmentId, volumeTracing, targetSegmentId),
  ]);

  const idInfos: [IdInfo, IdInfo] = [
    { agglomerateId: activeCellId, unmappedId: activeUnmappedSegmentId, position: sourcePosition },
    { agglomerateId: action.agglomerateId, unmappedId: action.segmentId, position: targetPosition },
  ];

  return {
    type: action.type,
    infos: idInfos,
  };
}
