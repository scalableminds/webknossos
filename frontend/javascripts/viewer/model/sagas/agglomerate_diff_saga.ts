import {
  getAgglomerateDiffToReferenceAsSkeletonTracing,
  getUnmappedSegmentIdAtPosition,
} from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import Toast, { type Message } from "libs/toast";
import { buffers, type Channel, channel } from "redux-saga";
import { actionChannel, fork, put, take } from "typed-redux-saga";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import {
  getAgglomerateDiffKey,
  getAgglomerateDiffOverlay,
  getAgglomerateKey,
} from "viewer/model/accessors/agglomerate_diff_accessor";
import { getIsRebasingOrForwarding } from "viewer/model/accessors/annotation_accessor";
import { getDataLayers, getLayerByName, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  finishLoadingAgglomerateDiffAction,
  type LoadedAgglomerateDiff,
  removeAgglomerateDiffsAction,
  startLoadingAgglomerateDiffAction,
} from "viewer/model/actions/agglomerate_diff_actions";
import { ensureLayerMappingsAreLoadedAction } from "viewer/model/actions/dataset_actions";
import { parseProtoTracing } from "viewer/model/helpers/proto_helpers";
import { call, type Saga, select } from "viewer/model/sagas/effect_generators";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import type { AgglomerateDiffDescriptor, WebknossosState } from "viewer/store";

/*
 * The differences of the agglomerate skeletons to the reference agglomerate views are derived
 * state: Whenever the agglomerate skeletons or the reference views change (no matter whether
 * by the user, undo, a collaborator, proofreading or loading the annotation), the diffs are
 * reconciled with them. They are only kept locally (see AgglomerateDiffOverlay) and never saved.
 *
 * Only agglomerate skeletons that were loaded from an agglomerate file are compared. Agglomerate
 * skeletons of an editable mapping (proofreading) don't get a diff.
 */

// Number of diffs that are requested in parallel
const MAX_PARALLEL_DIFF_REQUESTS = 4;
// Set by the server on the trees it returns
const REFERENCE_AGGLOMERATE_ID_METADATA_KEY = "referenceAgglomerateId";

// The segment of the agglomerate whose reference agglomerate is compared, given as its id or position
export type AgglomerateSegment = { id: bigint } | { positionInLayer: Vector3 };
type DiffRequest = { descriptor: AgglomerateDiffDescriptor; segment: AgglomerateSegment };

export function getReferenceMappingName(state: WebknossosState, layerName: string): string | null {
  return (
    getSkeletonTracing(state.annotation)?.agglomerateDiffReferences.find(
      (ref) => ref.layerName === layerName,
    )?.referenceMappingName ?? null
  );
}

// Returns the diffs that should be shown for the current annotation, keyed by getAgglomerateDiffKey,
// and the layers whose agglomerate files are not known, yet.
function getDesiredDiffs(state: WebknossosState): {
  desiredDiffs: Map<string, DiffRequest>;
  layersWithUnknownAgglomerateFiles: string[];
} {
  const desiredDiffs = new Map<string, DiffRequest>();
  const layersWithUnknownAgglomerateFiles: string[] = [];
  const skeletonTracing = getSkeletonTracing(state.annotation);
  if (skeletonTracing == null) return { desiredDiffs, layersWithUnknownAgglomerateFiles };
  const { segmentIdByAgglomerate } = getAgglomerateDiffOverlay(state);

  for (const { layerName, referenceMappingName } of skeletonTracing.agglomerateDiffReferences) {
    const layer = getDataLayers(state.dataset).find((l) => l.name === layerName);
    if (layer == null || layer.category !== "segmentation") continue;
    if (layer.agglomerates == null) {
      layersWithUnknownAgglomerateFiles.push(layerName);
      continue;
    }
    // Agglomerate skeletons don't know their layer, so the layer is determined by its agglomerate files
    const agglomerateFiles = new Set(layer.agglomerates);
    for (const tree of skeletonTracing.trees.values()) {
      const info = tree.agglomerateInfo;
      if (
        tree.type !== TreeTypeEnum.AGGLOMERATE ||
        info?.mappingName == null ||
        info.tracingId != null ||
        info.mappingName === referenceMappingName ||
        !agglomerateFiles.has(info.mappingName)
      ) {
        continue;
      }
      const descriptor = {
        layerName,
        mappingName: info.mappingName,
        agglomerateId: info.agglomerateId,
        referenceMappingName,
      };
      const segmentId =
        segmentIdByAgglomerate[getAgglomerateKey(layerName, info.mappingName, info.agglomerateId)];
      // Agglomerate skeleton nodes are placed at segment positions of the agglomerate file
      const firstNode = tree.nodes.values().next().value;
      if (segmentId == null && firstNode == null) continue;
      desiredDiffs.set(getAgglomerateDiffKey(descriptor), {
        descriptor,
        segment:
          segmentId != null
            ? { id: segmentId }
            : { positionInLayer: firstNode!.untransformedPosition },
      });
    }
  }
  return { desiredDiffs, layersWithUnknownAgglomerateFiles };
}

function handleDiffLoadingError(e: { messages: Array<Message> } | Error) {
  if (!(e instanceof Error) && e.messages != null) {
    Toast.messages(e.messages);
  } else {
    Toast.error(`Could not load the agglomerate diff: ${(e as Error).message}`);
  }
  console.error(e);
  ErrorHandling.notify(e as Error);
}

/*
 * Requests the trees that show the added and removed edges of the given agglomerate compared to
 * the reference agglomerate that contains the given segment of the agglomerate. The agglomerate
 * skeleton doesn't need to be loaded, so that both can be requested in parallel.
 * Errors are shown to the user and null is returned instead, so that this saga can be forked.
 */
export function* fetchAgglomerateDiff(
  descriptor: AgglomerateDiffDescriptor,
  segment: AgglomerateSegment,
): Saga<LoadedAgglomerateDiff | null> {
  const { layerName, mappingName, agglomerateId, referenceMappingName } = descriptor;
  const dataset = yield* select((state) => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);
  // If there is a fallbackLayer, request the agglomerate for that instead of the tracing segmentation layer
  const effectiveLayerName =
    layerInfo.category === "segmentation" && layerInfo.fallbackLayer != null
      ? layerInfo.fallbackLayer
      : layerName;

  try {
    const segmentId =
      "id" in segment
        ? segment.id
        : yield* call(
            getUnmappedSegmentIdAtPosition,
            dataset.dataStore.url,
            dataset,
            effectiveLayerName,
            layerInfo.elementClass,
            segment.positionInLayer,
            getMagInfo(layerInfo.mags).getFinestMag(),
          );
    const protoBuffer = yield* call(
      getAgglomerateDiffToReferenceAsSkeletonTracing,
      dataset.dataStore.url,
      dataset,
      effectiveLayerName,
      mappingName,
      agglomerateId,
      referenceMappingName,
      segmentId,
    );
    const parsedTracing = parseProtoTracing(protoBuffer, "skeleton");
    if (!("trees" in parsedTracing)) {
      throw new Error("Skeleton tracing doesn't contain trees");
    }
    // The server returns one tree per connected component of added or removed edges
    const trees = parsedTracing.trees.filter((tree) => tree.nodes.length > 0);
    const referenceAgglomerateId =
      trees[0]?.metadata.find((entry) => entry.key === REFERENCE_AGGLOMERATE_ID_METADATA_KEY)
        ?.stringValue ?? null;
    return {
      segmentId,
      referenceAgglomerateId:
        referenceAgglomerateId != null ? BigInt(referenceAgglomerateId) : null,
      trees,
    };
  } catch (e) {
    // @ts-expect-error
    handleDiffLoadingError(e);
    return null;
  }
}

function* loadRequestedDiffs(requestChannel: Channel<DiffRequest>): Saga<never> {
  while (true) {
    const { descriptor, segment } = yield* take(requestChannel);
    const diff = yield* call(fetchAgglomerateDiff, descriptor, segment);
    yield* put(finishLoadingAgglomerateDiffAction(descriptor, diff));
  }
}

function* reconcileAgglomerateDiffs(
  requestChannel: Channel<DiffRequest>,
  layersWithRequestedAgglomerateFiles: Set<string>,
): Saga<void> {
  const { desiredDiffs, layersWithUnknownAgglomerateFiles } = yield* select(getDesiredDiffs);
  for (const layerName of layersWithUnknownAgglomerateFiles) {
    if (layersWithRequestedAgglomerateFiles.has(layerName)) continue;
    layersWithRequestedAgglomerateFiles.add(layerName);
    yield* put(ensureLayerMappingsAreLoadedAction(layerName));
  }

  const { diffs } = yield* select(getAgglomerateDiffOverlay);
  // Diffs that are still loading are removed once they are loaded. This way, a diff that is
  // requested before its agglomerate skeleton is added (see skeletontracing_saga) is kept.
  const obsoleteKeys = Object.keys(diffs).filter(
    (key) => !desiredDiffs.has(key) && diffs[key].status !== "loading",
  );
  if (obsoleteKeys.length > 0) {
    yield* put(removeAgglomerateDiffsAction(obsoleteKeys));
  }
  // Failed diffs are not requested again until they are obsolete
  for (const [key, request] of desiredDiffs) {
    if (diffs[key] != null) continue;
    yield* put(startLoadingAgglomerateDiffAction(request.descriptor));
    yield* put(requestChannel, request);
  }
}

function getReconcileInputs(state: WebknossosState) {
  const skeletonTracing = getSkeletonTracing(state.annotation);
  const overlay = getAgglomerateDiffOverlay(state);
  return [
    skeletonTracing?.trees,
    skeletonTracing?.agglomerateDiffReferences,
    state.dataset.dataSource.dataLayers,
    overlay.diffs,
    overlay.segmentIdByAgglomerate,
  ];
}

export default function* watchAgglomerateDiffs(): Saga<void> {
  // Every action could change the inputs of the reconciliation, but only the latest one matters
  const actions = yield* actionChannel("*", buffers.sliding<Action>(1));
  yield* call(ensureWkInitialized);

  const requestChannel = channel<DiffRequest>(buffers.expanding());
  for (let i = 0; i < MAX_PARALLEL_DIFF_REQUESTS; i++) {
    yield* fork(loadRequestedDiffs, requestChannel);
  }

  const layersWithRequestedAgglomerateFiles = new Set<string>();
  let previousInputs: ReturnType<typeof getReconcileInputs> | null = null;
  while (true) {
    // While rebasing in live collaboration, the annotation is temporarily rewound, so that
    // agglomerate skeletons might be missing.
    const isRebasing = yield* select(getIsRebasingOrForwarding);
    const inputs = yield* select(getReconcileInputs);
    if (
      !isRebasing &&
      (previousInputs == null || inputs.some((input, idx) => input !== previousInputs![idx]))
    ) {
      previousInputs = inputs;
      yield* call(reconcileAgglomerateDiffs, requestChannel, layersWithRequestedAgglomerateFiles);
    }
    yield* take(actions);
  }
}
