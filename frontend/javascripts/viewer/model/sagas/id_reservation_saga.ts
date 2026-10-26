import { reserveIdsForAnnotation } from "admin/rest_api";
import { sleep } from "libs/utils";
import without from "lodash-es/without";
import { actionChannel, call, fork, put } from "typed-redux-saga";
import type { AnnotationIdDomain } from "types/api_types";
import Constants from "viewer/constants";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import type { IdReservation, SkeletonTracing, VolumeTracing, WebknossosState } from "viewer/store";
import {
  getIdReservationsForBookmarks,
  getIdReservationsForBoundingBoxes,
  getTracingById,
} from "../accessors/tracing_accessor";
import { getIdReservationsForSegmentationLayer } from "../accessors/volumetracing_accessor";
import {
  ANNOTATION_SCOPED_TRACING_ID,
  type GetNewIdAction,
  type IdsReplenishedAction,
  type IdsReplenishmentFailedAction,
  idsReplenishedAction,
  idsReplenishmentFailedAction,
  type RequestIdReplenishmentAction,
  type ReservableIdDomain,
  requestIdReplenishmentAction,
  setIdReservationsAction,
} from "../actions/actions";
import { getMaximumGroupId } from "../reducers/skeletontracing_reducer_helpers";
import { getGroupIdSet } from "../reducers/volumetracing_reducer_helpers";
import { type Saga, select, take } from "./effect_generators";

const { IDEAL_ID_BUFFER_SIZE } = Constants;

const RESERVE_IDS_MAX_RETRIES = 3;
const RETRY_DELAY_MULTIPLIER = import.meta.env.MODE === "test" ? 0.1 : 2;

type SupportedTracing = VolumeTracing | SkeletonTracing;

function isSupportedDomain(domain: AnnotationIdDomain): domain is ReservableIdDomain {
  return domain === "SegmentGroup" || domain === "BoundingBox" || domain === "Bookmark";
}

// Bookmarks belong to the annotation instead of a tracing, so their reservations use
// ANNOTATION_SCOPED_TRACING_ID in place of a tracing id.
// SegmentGroup reservations only make sense for volume tracings (segment groups don't exist
// on skeleton tracings). BoundingBox reservations are valid for both, since user bounding boxes
// are mirrored across all tracings of an annotation (see updateUserBoundingBoxes in
// annotation_reducer.ts).
function isScopeSupportedForDomain(
  state: WebknossosState,
  tracingId: string,
  domain: ReservableIdDomain,
): boolean {
  if (domain === "Bookmark") {
    return tracingId === ANNOTATION_SCOPED_TRACING_ID;
  }
  const tracing = getTracingById(state, tracingId);
  if (domain === "SegmentGroup") {
    return tracing.type === "volume";
  }
  return tracing.type === "volume" || tracing.type === "skeleton";
}

function getExistingIds(
  state: WebknossosState,
  tracingId: string,
  domain: ReservableIdDomain,
): number[] {
  if (domain === "Bookmark") {
    return state.annotation.bookmarks.map((bookmark) => bookmark.id);
  }
  const tracing = getTracingById(state, tracingId) as SupportedTracing;
  if (domain === "SegmentGroup") {
    return Array.from(getGroupIdSet((tracing as VolumeTracing).segmentGroups));
  }
  return tracing.userBoundingBoxes.map((bbox) => bbox.id);
}

function getMaxExistingId(
  state: WebknossosState,
  tracingId: string,
  domain: ReservableIdDomain,
): number {
  if (domain === "SegmentGroup") {
    const tracing = getTracingById(state, tracingId) as VolumeTracing;
    return getMaximumGroupId(tracing.segmentGroups);
  }
  return Math.max(0, ...getExistingIds(state, tracingId, domain));
}

function getReservationsForDomain(
  state: WebknossosState,
  tracingId: string,
  domain: ReservableIdDomain,
): IdReservation[] {
  if (domain === "BoundingBox") {
    return getIdReservationsForBoundingBoxes(state);
  }
  if (domain === "Bookmark") {
    return getIdReservationsForBookmarks(state);
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
  yield* fork(replenishmentLoop, "Bookmark");

  while (true) {
    const action = (yield* take(getNewIdActionChannel)) as GetNewIdAction;
    yield* call(handleReservationRequest, action);
  }
}

function getUsableReservations(
  state: WebknossosState,
  tracingId: string,
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
  const existingIdSet = new Set(getExistingIds(state, tracingId, domain));

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

    const isSupported = yield* select((state) =>
      isScopeSupportedForDomain(state, action.tracingId, domain),
    );
    if (!isSupported) {
      continue;
    }

    const usableReservations = yield* select((state) =>
      getUsableReservations(
        state,
        action.tracingId,
        getReservationsForDomain(state, action.tracingId, domain),
        domain,
      ),
    );
    if (usableReservations.length < IDEAL_ID_BUFFER_SIZE / 2) {
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

  const isSupported = yield* select((state) => isScopeSupportedForDomain(state, tracingId, domain));
  if (!isSupported) {
    const error = new Error(`Domain "${domain}" is not supported for "${tracingId}".`);
    console.warn(error.message);
    action.errorCallback(error);
    return;
  }

  const reservations = yield* select((state) => getReservationsForDomain(state, tracingId, domain));
  const usableReservations = yield* select((state) =>
    getUsableReservations(state, tracingId, reservations, domain),
  );

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

    if (usableReservations.length - 1 < IDEAL_ID_BUFFER_SIZE / 2) {
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
  const isSupported = yield* select((state) => isScopeSupportedForDomain(state, tracingId, domain));
  if (!isSupported) {
    return;
  }

  const unfilteredReservations = yield* select((state) =>
    getReservationsForDomain(state, tracingId, domain),
  );
  const usableReservations = yield* select((state) =>
    getUsableReservations(state, tracingId, unfilteredReservations, domain),
  );
  const numberOfIdsToReserve = Math.max(1, IDEAL_ID_BUFFER_SIZE - usableReservations.length);

  const collaborationMode = yield* select((state) => state.annotation.collaborationMode);
  let newIds: number[] = [];
  let releasedIds: number[] = [];
  releasedIds = without(
    unfilteredReservations.map(({ id }) => id),
    ...usableReservations.map(({ id }) => id),
  );

  if (collaborationMode === "Concurrent") {
    const annotationId = yield* select((state) => state.annotation.annotationId);
    for (let attempt = 0; attempt < RESERVE_IDS_MAX_RETRIES; attempt++) {
      try {
        newIds = yield* call(
          reserveIdsForAnnotation,
          annotationId,
          tracingId,
          domain,
          numberOfIdsToReserve,
          releasedIds,
        );
        break;
      } catch (error) {
        if (attempt === RESERVE_IDS_MAX_RETRIES - 1) throw error;
        yield* call(sleep, RETRY_DELAY_MULTIPLIER * 2 ** attempt);
      }
    }
  } else {
    const maxExistingId = yield* select((state) => getMaxExistingId(state, tracingId, domain));
    const maxReservationId =
      unfilteredReservations.length > 0 ? Math.max(...unfilteredReservations.map((r) => r.id)) : 0;
    const startId = Math.max(maxExistingId, maxReservationId) + 1;
    newIds = Array.from({ length: numberOfIdsToReserve }, (_, i) => startId + i);
  }

  // Re-read fresh state: the async call above may have suspended this saga long enough for
  // another request to mark some reservations as used in the meantime.
  const isStillSupported = yield* select((state) =>
    isScopeSupportedForDomain(state, tracingId, domain),
  );
  const freshUnfilteredReservations = isStillSupported
    ? yield* select((state) => getReservationsForDomain(state, tracingId, domain))
    : [];
  const freshUsableReservations = isStillSupported
    ? yield* select((state) =>
        getUsableReservations(state, tracingId, freshUnfilteredReservations, domain),
      )
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
