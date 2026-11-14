import type { RetryOptions } from "admin/api/api_result";
import { reserveIdsForAnnotation } from "admin/rest_api";
import without from "lodash-es/without";
import { actionChannel, call, fork, put, takeEvery } from "typed-redux-saga";
import type { AnnotationIdDomain } from "types/api_types";
import Constants from "viewer/constants";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import type {
  EditableMapping,
  IdReservation,
  SkeletonIdDomain,
  SkeletonTracing,
  VolumeTracing,
  WebknossosState,
} from "viewer/store";
import { enforceSkeletonTracing } from "../accessors/skeletontracing_accessor";
import { getIdReservationsForBoundingBoxes, getTracingById } from "../accessors/tracing_accessor";
import { getIdReservationsForSegmentationLayer } from "../accessors/volumetracing_accessor";
import type { GetNewIdAction, ReservableIdDomain } from "../actions/actions";
import {
  type IdsReplenishedAction,
  type IdsReplenishmentFailedAction,
  idsReplenishedAction,
  idsReplenishmentFailedAction,
  type RequestIdReplenishmentAction,
  requestIdReplenishmentAction,
  setIdReservationsAction,
} from "../actions/actions";
import { peekReservedIds, usesReservedSkeletonIds } from "../reducers/skeleton_id_allocation";
import { getMaximumGroupId, getMaximumTreeId } from "../reducers/skeletontracing_reducer_helpers";
import { getGroupIdSet } from "../reducers/volumetracing_reducer_helpers";
import { type Saga, select, take } from "./effect_generators";

const { IDEAL_ID_BUFFER_SIZE } = Constants;

const RESERVE_IDS_RETRY_OPTIONS: RetryOptions = {
  retries: 2,
  initialDelayMs: import.meta.env.MODE === "test" ? 1 : 500,
};

type SupportedTracing = VolumeTracing | SkeletonTracing;

const SKELETON_ID_DOMAINS: SkeletonIdDomain[] = ["Tree", "Node", "TreeGroup"];

function isSkeletonIdDomain(domain: ReservableIdDomain): domain is SkeletonIdDomain {
  return (SKELETON_ID_DOMAINS as ReservableIdDomain[]).includes(domain);
}

function isSupportedDomain(domain: AnnotationIdDomain): domain is ReservableIdDomain {
  return (
    domain === "SegmentGroup" ||
    domain === "BoundingBox" ||
    isSkeletonIdDomain(domain as ReservableIdDomain)
  );
}

// Nodes are created much more often than other items, so more node ids are held in the buffer.
function getIdealBufferSize(domain: ReservableIdDomain): number {
  if (domain === "Node") return IDEAL_ID_BUFFER_SIZE * 20;
  if (domain === "Tree") return IDEAL_ID_BUFFER_SIZE * 2;
  return IDEAL_ID_BUFFER_SIZE;
}

// SegmentGroup reservations only make sense for volume tracings (segment groups don't exist
// on skeleton tracings). BoundingBox reservations are valid for both, since user bounding boxes
// are mirrored across all tracings of an annotation (see updateUserBoundingBoxes in
// annotation_reducer.ts).
function isTracingSupportedForDomain(
  tracing: SkeletonTracing | VolumeTracing | EditableMapping,
  domain: ReservableIdDomain,
): tracing is SupportedTracing {
  if (domain === "SegmentGroup") {
    return tracing.type === "volume";
  }
  if (isSkeletonIdDomain(domain)) {
    return tracing.type === "skeleton";
  }
  return tracing.type === "volume" || tracing.type === "skeleton";
}

function getExistingIdSet(tracing: SupportedTracing, domain: ReservableIdDomain): Set<number> {
  if (isSkeletonIdDomain(domain)) {
    const skeletonTracing = tracing as SkeletonTracing;
    if (domain === "Tree") return new Set(skeletonTracing.trees.keys());
    if (domain === "TreeGroup") return getGroupIdSet(skeletonTracing.treeGroups);
    // Collecting all node ids would be too expensive. Used node reservations are marked as
    // used when the node is created (see skeleton_id_allocation.ts).
    return new Set();
  }
  if (domain === "SegmentGroup") {
    return getGroupIdSet((tracing as VolumeTracing).segmentGroups);
  }
  return new Set(tracing.userBoundingBoxes.map((bbox) => bbox.id));
}

function getMaxExistingId(tracing: SupportedTracing, domain: ReservableIdDomain): number {
  if (isSkeletonIdDomain(domain)) {
    const skeletonTracing = tracing as SkeletonTracing;
    if (domain === "Tree") return getMaximumTreeId(skeletonTracing.trees);
    if (domain === "TreeGroup") return getMaximumGroupId(skeletonTracing.treeGroups);
    return skeletonTracing.cachedMaxNodeId;
  }
  if (domain === "SegmentGroup") {
    return getMaximumGroupId((tracing as VolumeTracing).segmentGroups);
  }
  return Math.max(0, ...tracing.userBoundingBoxes.map((bbox) => bbox.id));
}

function getReservationsForDomain(
  state: WebknossosState,
  tracingId: string,
  domain: ReservableIdDomain,
): IdReservation[] {
  if (domain === "BoundingBox") {
    return getIdReservationsForBoundingBoxes(state);
  }
  if (isSkeletonIdDomain(domain)) {
    return state.localSkeletonState.idReservations[domain];
  }
  return getIdReservationsForSegmentationLayer(state, tracingId)[domain];
}

export default function* idReservationSaga(): Saga<void> {
  yield* call(ensureWkInitialized);

  const getNewIdActionChannel = yield* actionChannel<GetNewIdAction>("GET_NEW_ID");

  // One replenishmentLoop runs per supported domain. In theory, one could have a
  // replenishmentLoop per supported domain x tracing. This approach would allow parallel
  // replenishment requests for multiple tracings. However, this is probably overkill right now.
  yield* fork(replenishmentLoop, "SegmentGroup");
  yield* fork(replenishmentLoop, "BoundingBox");
  for (const domain of SKELETON_ID_DOMAINS) {
    yield* fork(replenishmentLoop, domain);
  }
  yield* fork(keepSkeletonIdReservationsFilled);

  while (true) {
    const action = (yield* take(getNewIdActionChannel)) as GetNewIdAction;
    yield* call(handleReservationRequest, action);
  }
}

function getUsableReservations(
  tracing: SupportedTracing,
  reservations: IdReservation[],
  domain: ReservableIdDomain,
) {
  /*
   * ID reservations are guaranteed to each user and don't expire as long as the id
   * is not used. However, the invalidation of used ids is not communicated to the
   * back-end atomically. Therefore, it can happen that an ID reservation
   * is used while the invalidation of the id is never communicated to the back-end
   * (e.g., the user reloads the page right after saving).
   * However, we know that nobody else will have used our ID. Only the current user
   * might have done so which is why there shouldn't be any race conditions. Therefore,
   * we can simply compare the maximum known ID against the current reservations and
   * clean up by that.
   */
  const existingIdSet = getExistingIdSet(tracing, domain);

  return reservations.filter(({ used, id }) => !used && !existingIdSet.has(id));
}

function* replenishmentLoop(domain: ReservableIdDomain): Saga<void> {
  const replenishChannel = yield* actionChannel<RequestIdReplenishmentAction>(
    (action: { type: string }) =>
      action.type === "REQUEST_ID_REPLENISHMENT" &&
      (action as RequestIdReplenishmentAction).domain === domain,
  );

  while (true) {
    const action = (yield* take(replenishChannel)) as RequestIdReplenishmentAction;

    const tracing = yield* select((state) => getTracingById(state, action.tracingId));
    if (!isTracingSupportedForDomain(tracing, domain)) {
      continue;
    }

    const reservations = yield* select((state) =>
      getReservationsForDomain(state, action.tracingId, domain),
    );
    const usableReservations = getUsableReservations(tracing, reservations, domain);
    if (usableReservations.length < getIdealBufferSize(domain) / 2) {
      // This will block until new reservations were fetched.
      try {
        yield* call(fetchNewReservations, action.tracingId, domain);
      } catch (error) {
        yield* put(idsReplenishmentFailedAction(action.tracingId, domain, error));
      }
    } else {
      // Buffer is already sufficient (e.g., a previous replenishment already ran);
      // no fetch needed but still signal completion so any waiter can proceed.
      yield* put(idsReplenishedAction(action.tracingId, domain));
    }
  }
}

function* handleReservationRequest(action: GetNewIdAction): Saga<void> {
  const { domain, tracingId } = action;

  if (!isSupportedDomain(domain)) {
    const error = new Error(`getNewId is not implemented for domain "${domain}", yet.`);
    console.warn(error.message);
    action.errorCallback(error);
    return;
  }

  const tracing = yield* select((state) => getTracingById(state, tracingId));
  if (!isTracingSupportedForDomain(tracing, domain)) {
    const error = new Error(
      `Domain "${domain}" is not supported for tracing type "${tracing.type}".`,
    );
    console.warn(error.message);
    action.errorCallback(error);
    return;
  }

  const reservations = yield* select((state) => getReservationsForDomain(state, tracingId, domain));
  const usableReservations = getUsableReservations(tracing, reservations, domain);

  if (usableReservations.length > 0) {
    // Mark the first usable reservation as used, preserving all other entries (including
    // already-used ones) so they can be included in idsToRelease in the next replenishment.
    yield* put(
      setIdReservationsAction(
        tracingId,
        domain,
        reservations.map((reservation) =>
          reservation.id === usableReservations[0].id
            ? { ...reservation, used: true }
            : reservation,
        ),
      ),
    );
    // ...and pass it to the callback.
    action.callback(usableReservations[0].id);

    if (usableReservations.length - 1 < getIdealBufferSize(domain) / 2) {
      // Trigger pre-fetching without blocking — the replenishment loop handles it.
      yield* put(requestIdReplenishmentAction(tracingId, domain));
    }

    return;
  }

  // No usable IDs: request replenishment and wait for it to complete before recursing.
  const replenishResultChannel = yield* actionChannel<
    IdsReplenishedAction | IdsReplenishmentFailedAction
  >(
    (a: { type: string }) =>
      (a.type === "IDS_REPLENISHED" || a.type === "IDS_REPLENISHMENT_FAILED") &&
      (a as IdsReplenishedAction).tracingId === tracingId &&
      (a as IdsReplenishedAction).domain === domain,
  );
  yield* put(requestIdReplenishmentAction(tracingId, domain));
  const result = (yield* take(replenishResultChannel)) as
    | IdsReplenishedAction
    | IdsReplenishmentFailedAction;
  replenishResultChannel.close();

  if (result.type === "IDS_REPLENISHMENT_FAILED") {
    action.errorCallback(result.error);
    return;
  }

  // Recurse to re-evaluate the now-replenished reservations, filtering against
  // known IDs again in case time has passed since the fetch.
  yield* call(handleReservationRequest, action);
}

function* fetchNewReservations(tracingId: string, domain: ReservableIdDomain): Saga<void> {
  const tracing = yield* select((state) => getTracingById(state, tracingId));

  if (!isTracingSupportedForDomain(tracing, domain)) {
    return;
  }

  const unfilteredReservations = yield* select((state) =>
    getReservationsForDomain(state, tracingId, domain),
  );
  const usableReservations = getUsableReservations(tracing, unfilteredReservations, domain);
  const numberOfIdsToReserve = Math.max(1, getIdealBufferSize(domain) - usableReservations.length);

  const collaborationMode = yield* select((state) => state.annotation.collaborationMode);
  let newIds: number[] = [];
  let releasedIds: number[] = [];
  releasedIds = without(
    unfilteredReservations.map(({ id }) => id),
    ...usableReservations.map(({ id }) => id),
  );

  if (collaborationMode === "Concurrent") {
    const annotationId = yield* select((state) => state.annotation.annotationId);
    const result = yield* call(
      reserveIdsForAnnotation,
      annotationId,
      tracingId,
      domain,
      numberOfIdsToReserve,
      releasedIds,
      {},
      RESERVE_IDS_RETRY_OPTIONS,
    );
    if (!result.ok) {
      // The caller turns this into an IDS_REPLENISHMENT_FAILED action.
      throw result.error.cause;
    }
    newIds = result.value;
  } else {
    const maxExistingId = getMaxExistingId(tracing, domain);
    const maxReservationId =
      unfilteredReservations.length > 0 ? Math.max(...unfilteredReservations.map((r) => r.id)) : 0;
    const startId = Math.max(maxExistingId, maxReservationId) + 1;
    newIds = Array.from({ length: numberOfIdsToReserve }, (_, i) => startId + i);
  }

  // Re-read fresh state: the async call above may have suspended this saga long enough for
  // another request to mark some reservations as used in the meantime.
  const freshTracing = yield* select((state) => getTracingById(state, tracingId));
  const freshUnfilteredReservations = isTracingSupportedForDomain(freshTracing, domain)
    ? yield* select((state) => getReservationsForDomain(state, tracingId, domain))
    : [];
  const freshUsableReservations = isTracingSupportedForDomain(freshTracing, domain)
    ? getUsableReservations(freshTracing, freshUnfilteredReservations, domain)
    : [];
  // Preserve IDs that were marked used during the async call (not already sent in releasedIds),
  // so they can be included in idsToRelease on the next replenishment.
  const usedDuringCall = freshUnfilteredReservations.filter(
    ({ used, id }) => used && !releasedIds.includes(id),
  );

  yield* put(
    setIdReservationsAction(tracingId, domain, [
      ...usedDuringCall,
      ...freshUsableReservations,
      ...newIds.map((id) => ({ id, used: false })),
    ]),
  );
  yield* put(idsReplenishedAction(tracingId, domain));
}

function* getSkeletonTracingIdInLiveCollab(): Saga<string | null> {
  const skeletonTracing = yield* select((state) => state.annotation.skeleton);
  const usesReservedIds = yield* select(usesReservedSkeletonIds);
  return skeletonTracing != null && usesReservedIds ? skeletonTracing.tracingId : null;
}

// In live collaboration, the skeleton reducers take the ids of new trees, nodes and tree groups
// synchronously from the reservations (see skeleton_id_allocation.ts). Therefore, the
// reservations are refilled in the background whenever they run low.
function* keepSkeletonIdReservationsFilled(): Saga<void> {
  const requestReplenishmentIfNecessary = function* () {
    const tracingId = yield* call(getSkeletonTracingIdInLiveCollab);
    if (tracingId == null) return;
    for (const domain of SKELETON_ID_DOMAINS) {
      const tracing = yield* select((state) => getTracingById(state, tracingId));
      if (!isTracingSupportedForDomain(tracing, domain)) continue;
      const reservations = yield* select((state) =>
        getReservationsForDomain(state, tracingId, domain),
      );
      if (
        getUsableReservations(tracing, reservations, domain).length <
        getIdealBufferSize(domain) / 2
      ) {
        yield* put(requestIdReplenishmentAction(tracingId, domain));
      }
    }
  };
  yield* call(requestReplenishmentIfNecessary);
  yield* takeEvery(
    [
      "SET_COLLABORATION_MODE",
      "CREATE_NODE",
      "CREATE_TREE",
      "DELETE_NODE",
      "DELETE_EDGE",
      "ADD_TREES_AND_GROUPS",
      "SET_ID_RESERVATIONS",
    ],
    requestReplenishmentIfNecessary,
  );
}

// Ensures that enough ids are reserved for the given number of new items. Unlike the
// background replenishment, this reserves exactly as many ids as needed (e.g., one per node
// of an agglomerate tree). Does nothing outside of live collaboration.
export function* ensureSkeletonIdReservations(
  neededIds: Partial<Record<SkeletonIdDomain, number>>,
): Saga<void> {
  const tracingId = yield* call(getSkeletonTracingIdInLiveCollab);
  if (tracingId == null) return;
  const annotationId = yield* select((state) => state.annotation.annotationId);
  for (const domain of SKELETON_ID_DOMAINS) {
    const neededCount = neededIds[domain] ?? 0;
    if (neededCount === 0) continue;
    const tracing = yield* select((state) => getTracingById(state, tracingId));
    if (!isTracingSupportedForDomain(tracing, domain)) continue;
    const reservations = yield* select((state) =>
      getReservationsForDomain(state, tracingId, domain),
    );
    const missingCount = neededCount - getUsableReservations(tracing, reservations, domain).length;
    if (missingCount <= 0) continue;
    const result = yield* call(
      reserveIdsForAnnotation,
      annotationId,
      tracingId,
      domain,
      missingCount,
      [],
      {},
      RESERVE_IDS_RETRY_OPTIONS,
    );
    if (!result.ok) {
      throw result.error.cause;
    }
    // Re-read the reservations, because they may have changed during the request.
    const freshReservations = yield* select((state) =>
      getReservationsForDomain(state, tracingId, domain),
    );
    yield* put(
      setIdReservationsAction(tracingId, domain, [
        ...freshReservations,
        ...result.value.map((id) => ({ id, used: false })),
      ]),
    );
  }
}

// Returns `count` new ids for the domain and marks them as used. In live collaboration, they
// are reserved ids. Otherwise, they are derived from the largest existing id.
export function* takeSkeletonIds(domain: SkeletonIdDomain, count: number): Saga<number[]> {
  if (count === 0) return [];
  const tracingId = yield* call(getSkeletonTracingIdInLiveCollab);
  if (tracingId == null) {
    const skeletonTracing = yield* select((state) => enforceSkeletonTracing(state.annotation));
    const startId = getMaxExistingId(skeletonTracing, domain) + 1;
    return Array.from({ length: count }, (_, i) => startId + i);
  }
  yield* call(ensureSkeletonIdReservations, { [domain]: count });
  const ids = yield* select((state) => peekReservedIds(state, domain, count));
  if (ids == null) {
    throw new Error(`Could not reserve ${count} ids for domain ${domain}.`);
  }
  const idSet = new Set(ids);
  const reservations = yield* select((state) => getReservationsForDomain(state, tracingId, domain));
  yield* put(
    setIdReservationsAction(
      tracingId,
      domain,
      reservations.map((reservation) =>
        idSet.has(reservation.id) ? { ...reservation, used: true } : reservation,
      ),
    ),
  );
  return ids;
}
