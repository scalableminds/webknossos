import { reserveIdsForAnnotation } from "admin/rest_api";
import { actionChannel, call, put, take } from "typed-redux-saga";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import type { VolumeTracing } from "viewer/store";
import { getTracingById } from "../accessors/tracing_accessor";
import type { GetNewIdAction } from "../actions/actions";
import { setIdReservationsAction } from "../actions/volumetracing_actions";
import { getMaximumGroupId } from "../reducers/skeletontracing_reducer_helpers";
import { type Saga, select } from "./effect-generators";
import without from "lodash-es/without";

/*
 * todop:
 * - handle non collab case
 */

const IDEAL_ID_BUFFER_SIZE = 5; // todo: maybe 10?

export default function* idReservationSaga(): Saga<void> {
  yield* call(ensureWkInitialized);

  const getNewIdActionChannel = yield* actionChannel<GetNewIdAction>("GET_NEW_ID");

  while (true) {
    const action = yield* take(getNewIdActionChannel);
    yield* call(handleReservationRequest, action);
  }
}

function getUsableReservations(tracing: VolumeTracing, domain: "SegmentGroup") {
  /*
   * ID reservations are guaranteed to each user and don't expire as long as the id
   * is not used. However, the invalidation of used ids is done lazily and not in an
   * atomic manner by the front-end. Therefore, it can happen that an ID reservation
   * is used while the invalidation of the id is never communicated to the back-end
   * (e.g., the user reloads the page right after saving).
   * However, we know that nobody else will have used our ID. Only the current user
   * might have done so which is why there shouldn't be any race conditions. Therefore,
   * we can simply compare the maximum known ID against the current reservations and
   * clean up by that.
   */
  const unfilteredReservations = tracing.idReservations[domain];
  const maximumGroupId = getMaximumGroupId(tracing.segmentGroups);

  return unfilteredReservations.filter(({ used, id }) => !used && id > maximumGroupId);
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

  const usableReservations = getUsableReservations(tracing, domain);

  if (usableReservations.length > 0) {
    // Mark the first reservation as used...
    yield* put(
      setIdReservationsAction(
        tracingId,
        domain,
        usableReservations.map((reservation, index) =>
          index === 0 ? { ...reservation, used: true } : reservation,
        ),
      ),
    );
    // ...and pass it to the callback.
    action.callback(usableReservations[0].id);

    if (usableReservations.length < IDEAL_ID_BUFFER_SIZE / 2) {
      yield* call(fetchNewReservations, action);
    }

    return;
  }

  yield* call(fetchNewReservations, action);

  // Simply call the current saga recursively to re-access the new reservations.
  // This ensures that the filtering against the maximum known ID is done again
  // now that some time has passed after the back-end replied with reservations.
  yield* call(handleReservationRequest, action);
}

function* fetchNewReservations(action: GetNewIdAction) {
  const { domain, tracingId } = action;

  // todop: DRY
  const tracing = yield* select((state) => getTracingById(state, tracingId));

  if (tracing.type !== "volume" || domain !== "SegmentGroup") {
    console.warn(
      "Ignored getNewId action because it's not implemented for non-volume tracings and non-segment domains, yet.",
    );
    return;
  }
  // todop end

  const unfilteredReservations = tracing.idReservations[domain];
  const usableReservations = getUsableReservations(tracing, domain);

  const annotationId = yield* select((state) => state.annotation.annotationId);
  const idsToRelease: number[] = without(
    unfilteredReservations.map(({ id }) => id),
    ...usableReservations.map(({ id }) => id),
  );

  const newIds = yield* call(
    reserveIdsForAnnotation,
    annotationId,
    tracingId,
    domain,
    IDEAL_ID_BUFFER_SIZE - usableReservations.length,
    idsToRelease,
  );
  yield* put(
    setIdReservationsAction(tracingId, domain, [
      ...usableReservations,
      ...newIds.map((id) => ({ id, used: false })),
    ]),
  );
}
