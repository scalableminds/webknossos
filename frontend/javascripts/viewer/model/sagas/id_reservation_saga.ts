import { reserveIdsForAnnotation } from "admin/rest_api";
import { sleep } from "libs/utils";
import without from "lodash-es/without";
import { actionChannel, call, fork, put } from "typed-redux-saga";
import Constants from "viewer/constants";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import type { LocalSegmentationState, VolumeTracing } from "viewer/store";
import { getTracingById } from "../accessors/tracing_accessor";
import type { GetNewIdAction } from "../actions/actions";
import {
  type IdsReplenishedAction,
  type IdsReplenishmentFailedAction,
  idsReplenishedAction,
  idsReplenishmentFailedAction,
  type RequestIdReplenishmentAction,
  requestIdReplenishmentAction,
  setIdReservationsAction,
} from "../actions/actions";
import { getMaximumGroupId } from "../reducers/skeletontracing_reducer_helpers";
import { getGroupIdSet } from "../reducers/volumetracing_reducer_helpers";
import { type Saga, select, take } from "./effect_generators";
import { getIdReservationsForSegmentationLayer } from "../accessors/volumetracing_accessor";

const { IDEAL_ID_BUFFER_SIZE } = Constants;

const RESERVE_IDS_MAX_RETRIES = 3;
const RETRY_DELAY_MULTIPLIER = import.meta.env.MODE === "test" ? 0.1 : 2;

export default function* idReservationSaga(): Saga<void> {
  yield* call(ensureWkInitialized);

  const getNewIdActionChannel = yield* actionChannel<GetNewIdAction>("GET_NEW_ID");

  // Currently, there is one replenishmentLoop per supported domain type (which is only
  // SegmentGroup, currently). In theory, one could have a replenishmentLoop per
  // supported domain x tracing. This approach would allow parallel replenishment requests
  // for multiple tracings. However, this is probably overkill right now.
  yield* fork(replenishmentLoop, "SegmentGroup");

  while (true) {
    const action = (yield* take(getNewIdActionChannel)) as GetNewIdAction;
    yield* call(handleReservationRequest, action);
  }
}

function getUsableReservations(
  tracing: VolumeTracing,
  idReservations: LocalSegmentationState["idReservations"],
  domain: "SegmentGroup",
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
  const unfilteredReservations = idReservations[domain];
  const existingIdSet = getGroupIdSet(tracing.segmentGroups);

  return unfilteredReservations.filter(({ used, id }) => !used && !existingIdSet.has(id));
}

function* replenishmentLoop(domain: "SegmentGroup"): Saga<void> {
  const replenishChannel = yield* actionChannel<RequestIdReplenishmentAction>(
    (action: { type: string }) =>
      action.type === "REQUEST_ID_REPLENISHMENT" &&
      (action as RequestIdReplenishmentAction).domain === domain,
  );

  while (true) {
    const action = (yield* take(replenishChannel)) as RequestIdReplenishmentAction;

    const tracing = yield* select((state) => getTracingById(state, action.tracingId));
    if (tracing.type !== "volume") {
      continue;
    }

    const idReservations = yield* select((state) =>
      getIdReservationsForSegmentationLayer(state, action.tracingId),
    );
    const usableReservations = getUsableReservations(tracing, idReservations, domain);
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
  const tracing = yield* select((state) => getTracingById(state, tracingId));

  if (tracing.type !== "volume" || domain !== "SegmentGroup") {
    console.warn(
      "Ignored getNewId action because it's not implemented for non-volume tracings and non-segment domains, yet.",
    );
    return;
  }

  const idReservations = yield* select((state) =>
    getIdReservationsForSegmentationLayer(state, action.tracingId),
  );
  const usableReservations = getUsableReservations(tracing, idReservations, domain);

  if (usableReservations.length > 0) {
    const allReservations = idReservations[domain];
    // Mark the first usable reservation as used, preserving all other entries (including
    // already-used ones) so they can be included in idsToRelease in the next replenishment.
    yield* put(
      setIdReservationsAction(
        tracingId,
        domain,
        allReservations.map((reservation) =>
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

function* fetchNewReservations(tracingId: string, domain: "SegmentGroup"): Saga<void> {
  const tracing = yield* select((state) => getTracingById(state, tracingId));

  if (tracing.type !== "volume") {
    return;
  }

  const idReservations = yield* select((state) =>
    getIdReservationsForSegmentationLayer(state, tracingId),
  );
  const unfilteredReservations = idReservations[domain];
  const usableReservations = getUsableReservations(tracing, idReservations, domain);
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
    const maxGroupId = getMaximumGroupId(tracing.segmentGroups);
    const maxReservationId =
      unfilteredReservations.length > 0 ? Math.max(...unfilteredReservations.map((r) => r.id)) : 0;
    const startId = Math.max(maxGroupId, maxReservationId) + 1;
    newIds = Array.from({ length: numberOfIdsToReserve }, (_, i) => startId + i);
  }

  // Re-read fresh state: the async call above may have suspended this saga long enough for
  // another request to mark some reservations as used in the meantime.
  const freshTracing = yield* select((state) => getTracingById(state, tracingId));
  const freshIdReservations = yield* select((state) =>
    getIdReservationsForSegmentationLayer(state, tracingId),
  );
  const freshUnfilteredReservations =
    freshTracing.type === "volume" ? freshIdReservations[domain] : [];
  const freshUsableReservations =
    freshTracing.type === "volume"
      ? getUsableReservations(freshTracing, freshIdReservations, domain)
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
