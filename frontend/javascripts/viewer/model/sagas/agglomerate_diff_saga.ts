import { getAgglomerateDiffToReference, getUnmappedSegmentIdAtPosition } from "admin/rest_api";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import type { Channel } from "redux-saga";
import { buffers } from "redux-saga";
import { actionChannel, fork, put, take } from "typed-redux-saga";
import { TreeTypeEnum, type Vector3 } from "viewer/constants";
import {
  getAgglomerateDiffKey,
  getAgglomerateDiffOverlay,
  getClickedPositionInLayer,
  getLayerNameOfAgglomerateSkeleton,
  getUsableAgglomerateDiffReference,
  isComparedToAgglomerateDiffReference,
  isDiffOfPosition,
  needsAgglomerateFilesForDiffs,
} from "viewer/model/accessors/agglomerate_diff_accessor";
import { getIsRebasingOrForwarding } from "viewer/model/accessors/annotation_accessor";
import { getDataLayers, getLayerByName, getMagInfo } from "viewer/model/accessors/dataset_accessor";
import { getSkeletonTracing } from "viewer/model/accessors/skeletontracing_accessor";
import { getReadableNameForLayerName } from "viewer/model/accessors/volumetracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import {
  failLoadingAgglomerateDiffAction,
  finishLoadingAgglomerateDiffAction,
  type RequestAgglomerateDiffAction,
  removeAgglomerateDiffsAction,
  requestAgglomerateDiffAction,
  syncAgglomerateDiffsWithSourceTreesAction,
} from "viewer/model/actions/agglomerate_diff_actions";
import { ensureLayerMappingsAreLoadedAction } from "viewer/model/actions/dataset_actions";
import {
  parseProtoAgglomerateGraphDiff,
  type ServerAgglomerateGraphDiff,
} from "viewer/model/helpers/proto_helpers";
import { call, type Saga, select } from "viewer/model/sagas/effect_generators";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import type { AgglomerateDiff, AgglomerateDiffDescriptor, WebknossosState } from "viewer/store";

/*
 * The differences of the agglomerate skeletons to the reference mappings are derived
 * state: Whenever the agglomerate skeletons or the reference mappings change (no matter whether
 * by the user, undo, a collaborator, proofreading or loading the annotation), the diffs are
 * reconciled with them. They are only kept locally (see AgglomerateDiffOverlay) and never saved.
 *
 * Only agglomerate skeletons that were loaded from an agglomerate file are compared. Agglomerate
 * skeletons of an editable mapping (proofreading) don't get a diff.
 *
 * All diffs are loaded by this saga (see requestAgglomerateDiffAction), so that no diff can
 * remain loading when the sagas are restarted.
 */

// Number of diffs that are requested in parallel
const MAX_PARALLEL_DIFF_REQUESTS = 4;

type DesiredDiff = {
  descriptor: AgglomerateDiffDescriptor;
  // The agglomerate is compared to the reference agglomerate that contains the segment at this position
  positionInLayer: Vector3;
  sourceTree: { treeId: number; isVisible: boolean };
};

// Returns the diffs that should be shown for the current annotation, keyed by getAgglomerateDiffKey,
// and the layers whose agglomerate files are not known, yet.
function getDesiredDiffs(state: WebknossosState): {
  desiredDiffs: Map<string, DesiredDiff>;
  layersWithUnknownAgglomerateFiles: string[];
} {
  const desiredDiffs = new Map<string, DesiredDiff>();
  const layersWithUnknownAgglomerateFiles: string[] = [];
  const skeletonTracing = getSkeletonTracing(state.annotation);
  if (skeletonTracing == null) return { desiredDiffs, layersWithUnknownAgglomerateFiles };

  for (const layer of getDataLayers(state.dataset)) {
    if (layer.category !== "segmentation") continue;
    const layerName = layer.name;
    if (needsAgglomerateFilesForDiffs(state, layerName)) {
      layersWithUnknownAgglomerateFiles.push(layerName);
      continue;
    }
    const referenceMappingName = getUsableAgglomerateDiffReference(state, layerName);
    if (referenceMappingName == null || layer.agglomerates == null) continue;
    for (const tree of skeletonTracing.trees.values()) {
      const info = tree.agglomerateInfo;
      if (
        tree.type !== TreeTypeEnum.AGGLOMERATE ||
        info?.mappingName == null ||
        info.tracingId != null ||
        !isComparedToAgglomerateDiffReference(
          layer.agglomerates,
          info.mappingName,
          referenceMappingName,
        )
      ) {
        continue;
      }
      // Agglomerate skeletons that were loaded before their layer was stored with them are assigned
      // to all layers that have their agglomerate file.
      const layerNameOfTree = getLayerNameOfAgglomerateSkeleton(tree);
      if (layerNameOfTree != null && layerNameOfTree !== layerName) continue;
      const descriptor = {
        layerName,
        mappingName: info.mappingName,
        agglomerateId: info.agglomerateId,
        referenceMappingName,
      };
      // Agglomerate skeletons that were not loaded by clicking on a segment are compared at their
      // first node. Agglomerate skeleton nodes are placed at segment positions of the agglomerate file.
      const positionInLayer =
        getClickedPositionInLayer(tree) ?? tree.nodes.values().next().value?.untransformedPosition;
      if (positionInLayer == null) continue;
      // The key doesn't contain the tree id. If several agglomerate skeletons of the same agglomerate
      // exist (e.g., from an imported NML), only the last one is compared and dimmed. Loading an
      // agglomerate skeleton that already exists is refused, so this is rare.
      desiredDiffs.set(getAgglomerateDiffKey(descriptor), {
        descriptor,
        positionInLayer: positionInLayer.map(Math.floor) as Vector3,
        sourceTree: { treeId: tree.treeId, isVisible: tree.isVisible },
      });
    }
  }
  return { desiredDiffs, layersWithUnknownAgglomerateFiles };
}

type DiffLoadingError = { message: string; isExpected: boolean };

function getDiffLoadingError(e: unknown): DiffLoadingError {
  if (e instanceof Error) return { message: e.message, isExpected: false };
  // Failed requests are rejected with the messages and status of the response (see handleError)
  const { messages, status } = (e ?? {}) as {
    messages?: Array<{ error?: string; chain?: string }>;
    status?: number;
  };
  const error = messages?.find((message) => message.error != null)?.error;
  // The chain contains the cause, e.g., that the agglomerate is too large
  const chain = messages
    ?.find((message) => message.chain != null)
    ?.chain?.replace(/^\[Server Time [^\]]*\] /, "");
  return {
    message: [error, chain].filter((part) => part != null).join(" ") || "Unknown error",
    // E.g., a missing agglomerate file or a too large agglomerate
    isExpected: status != null && status >= 400 && status < 500,
  };
}

/*
 * Requests the added and removed edges of the given agglomerate compared to the reference
 * agglomerate that contains the segment at the given position (which belongs to the agglomerate).
 */
function* fetchAgglomerateDiff(
  descriptor: AgglomerateDiffDescriptor,
  positionInLayer: Vector3,
): Saga<{ diff: ServerAgglomerateGraphDiff } | { error: DiffLoadingError }> {
  const { layerName, mappingName, agglomerateId, referenceMappingName } = descriptor;
  const dataset = yield* select((state) => state.dataset);
  const layerInfo = getLayerByName(dataset, layerName);
  // If there is a fallbackLayer, request the agglomerate for that instead of the tracing segmentation layer
  const effectiveLayerName =
    layerInfo.category === "segmentation" && layerInfo.fallbackLayer != null
      ? layerInfo.fallbackLayer
      : layerName;

  try {
    const segmentId = yield* call(
      getUnmappedSegmentIdAtPosition,
      dataset.dataStore.url,
      dataset,
      effectiveLayerName,
      layerInfo.elementClass,
      positionInLayer,
      // The magnifications of the fallback layer might differ from the ones of the annotation layer
      getMagInfo(
        (layerInfo.category === "segmentation" ? layerInfo.fallbackLayerInfo?.mags : null) ??
          layerInfo.mags,
      ).getFinestMag(),
    );
    const protoBuffer = yield* call(
      getAgglomerateDiffToReference,
      dataset.dataStore.url,
      dataset,
      effectiveLayerName,
      mappingName,
      agglomerateId,
      referenceMappingName,
      segmentId,
    );
    return { diff: parseProtoAgglomerateGraphDiff(protoBuffer) };
  } catch (e) {
    console.error(e);
    const error = getDiffLoadingError(e);
    if (!error.isExpected) {
      ErrorHandling.notify(e instanceof Error ? e : new Error(error.message));
    }
    return { error };
  }
}

// Shows a single toast per layer, no matter how many diffs failed. The reasons are listed in
// the layer settings (see AgglomerateDiffReferenceView).
function* showDiffLoadingErrorToast(layerName: string, errorMessage: string): Saga<void> {
  const failedCount = yield* select(
    (state) =>
      Object.values(getAgglomerateDiffOverlay(state).diffs).filter(
        (diff) => diff.layerName === layerName && diff.status === "failed",
      ).length,
  );
  const readableLayerName = yield* select((state) =>
    getReadableNameForLayerName(state.dataset, state.annotation, layerName),
  );
  const agglomerateSkeletons =
    failedCount === 1 ? "1 agglomerate skeleton" : `${failedCount} agglomerate skeletons`;
  Toast.error(
    `Could not compare ${agglomerateSkeletons} of layer ${readableLayerName} to the reference mapping. The reasons are listed in the layer settings.`,
    { key: `agglomerate-diff-error-${layerName}` },
    errorMessage,
  );
}

function* loadRequestedDiffs(requests: Channel<RequestAgglomerateDiffAction>): Saga<never> {
  while (true) {
    const { descriptor, positionInLayer } = yield* take(requests);
    const key = getAgglomerateDiffKey(descriptor);
    // Whether the diff has the status and was neither removed nor requested again for another position
    const hasStatus = (status: AgglomerateDiff["status"]) => (state: WebknossosState) => {
      const diff = getAgglomerateDiffOverlay(state).diffs[key];
      return diff?.status === status && isDiffOfPosition(diff, positionInLayer);
    };
    // Skip the request if the diff became obsolete while it was queued
    if (!(yield* select(hasStatus("loading")))) continue;
    const result = yield* call(fetchAgglomerateDiff, descriptor, positionInLayer);
    if ("diff" in result) {
      yield* put(finishLoadingAgglomerateDiffAction(descriptor, positionInLayer, result.diff));
    } else {
      yield* put(
        failLoadingAgglomerateDiffAction(descriptor, positionInLayer, result.error.message),
      );
      // The failure is ignored if the diff became obsolete during the request
      if (yield* select(hasStatus("failed"))) {
        yield* call(showDiffLoadingErrorToast, descriptor.layerName, result.error.message);
      }
    }
  }
}

function* reconcileAgglomerateDiffs(layersWithRequestedAgglomerateFiles: Set<string>): Saga<void> {
  const { desiredDiffs, layersWithUnknownAgglomerateFiles } = yield* select(getDesiredDiffs);
  for (const layerName of layersWithUnknownAgglomerateFiles) {
    if (layersWithRequestedAgglomerateFiles.has(layerName)) continue;
    layersWithRequestedAgglomerateFiles.add(layerName);
    yield* put(ensureLayerMappingsAreLoadedAction(layerName));
  }

  const { diffs } = yield* select(getAgglomerateDiffOverlay);
  // A diff is obsolete if it's not desired anymore or if it compares the reference agglomerate at
  // another position (e.g., if the clicked position of the agglomerate skeleton was edited). A diff
  // that is requested before its agglomerate skeleton is added (see skeletontracing_saga) is kept
  // until then.
  const obsoleteKeys = new Set(
    Object.keys(diffs).filter((key) => {
      const desiredDiff = desiredDiffs.get(key);
      return desiredDiff == null
        ? !diffs[key].awaitsAgglomerateSkeleton
        : !isDiffOfPosition(diffs[key], desiredDiff.positionInLayer);
    }),
  );
  if (obsoleteKeys.size > 0) {
    yield* put(removeAgglomerateDiffsAction([...obsoleteKeys]));
  }

  const sourceTreeByKey: Record<string, { treeId: number; isVisible: boolean }> = {};
  for (const [key, { sourceTree }] of desiredDiffs) {
    const diff = obsoleteKeys.has(key) ? null : diffs[key];
    if (
      diff != null &&
      (diff.sourceTreeId !== sourceTree.treeId ||
        diff.isSourceTreeVisible !== sourceTree.isVisible ||
        diff.awaitsAgglomerateSkeleton)
    ) {
      sourceTreeByKey[key] = sourceTree;
    }
  }
  if (Object.keys(sourceTreeByKey).length > 0) {
    yield* put(syncAgglomerateDiffsWithSourceTreesAction(sourceTreeByKey));
  }

  // Failed diffs are not requested again until they are obsolete
  for (const [key, { descriptor, positionInLayer }] of desiredDiffs) {
    if (diffs[key] != null && !obsoleteKeys.has(key)) continue;
    yield* put(requestAgglomerateDiffAction(descriptor, positionInLayer, false));
  }
}

// Waits until the given diff is not loading anymore. Returns whether it was loaded successfully.
export function* waitForAgglomerateDiff(key: string): Saga<boolean> {
  while (true) {
    const diff = yield* select((state) => getAgglomerateDiffOverlay(state).diffs[key]);
    if (diff?.status !== "loading") return diff?.status === "loaded";
    yield* take([
      "FINISH_LOADING_AGGLOMERATE_DIFF",
      "FAIL_LOADING_AGGLOMERATE_DIFF",
      "REMOVE_AGGLOMERATE_DIFFS",
      // Resets the overlay (see skeletontracing_reducer)
      "INITIALIZE_SKELETONTRACING",
    ]);
  }
}

function getReconcileInputs(state: WebknossosState) {
  const skeletonTracing = getSkeletonTracing(state.annotation);
  return [
    skeletonTracing?.trees,
    state.datasetConfiguration.layers,
    state.temporaryConfiguration.activeMappingByLayer,
    state.dataset.dataSource.dataLayers,
    getAgglomerateDiffOverlay(state).diffs,
  ];
}

export default function* watchAgglomerateDiffs(): Saga<void> {
  // If the sagas were restarted, the requests of loading diffs and the loading of agglomerate
  // skeletons were cancelled, so these diffs are removed (and requested again if still needed).
  const orphanedKeys = yield* select((state) =>
    Object.entries(getAgglomerateDiffOverlay(state).diffs)
      .filter(([_key, diff]) => diff.status === "loading" || diff.awaitsAgglomerateSkeleton)
      .map(([key]) => key),
  );
  if (orphanedKeys.length > 0) {
    yield* put(removeAgglomerateDiffsAction(orphanedKeys));
  }

  const requests = yield* actionChannel(
    "REQUEST_AGGLOMERATE_DIFF",
    buffers.expanding<RequestAgglomerateDiffAction>(),
  );
  // Every action could change the inputs of the reconciliation, but only the latest one matters
  const actions = yield* actionChannel("*", buffers.sliding<Action>(1));
  yield* call(ensureWkInitialized);

  for (let i = 0; i < MAX_PARALLEL_DIFF_REQUESTS; i++) {
    yield* fork(loadRequestedDiffs, requests);
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
      yield* call(reconcileAgglomerateDiffs, layersWithRequestedAgglomerateFiles);
    }
    yield* take(actions);
  }
}
