import update from "immutability-helper";
import {
  getSkeletonTracing,
  mapGroupsToGenerator,
} from "viewer/model/accessors/skeletontracing_accessor";
import type { IdReservation, SkeletonIdDomain, WebknossosState } from "viewer/store";
import { isConcurrentCollaborationMode } from "../accessors/annotation_accessor";

/*
 * In live collaboration, several users create trees, nodes and tree groups at the same time.
 * Their ids must not collide, so they are taken from ids that were reserved on the server for
 * the current user (see id_reservation_saga.ts). The reservations are consumed synchronously
 * by the reducers so that creating nodes and trees stays synchronous.
 * Outside of live collaboration, ids are still derived from the largest existing id.
 *
 * TODO: If nodes or trees are created faster than the reservations are refilled, the creation
 * is ignored. Decide later whether creation should become async instead.
 */

export function usesReservedSkeletonIds(state: WebknossosState): boolean {
  return isConcurrentCollaborationMode(state);
}

function getExistenceCheck(state: WebknossosState, domain: SkeletonIdDomain) {
  const skeletonTracing = getSkeletonTracing(state.annotation);
  switch (domain) {
    case "Tree":
      return (id: number) => skeletonTracing?.trees.has(id) ?? false;
    case "TreeGroup": {
      const groupIds = new Set(
        mapGroupsToGenerator(skeletonTracing?.treeGroups ?? [], (group) => group.groupId),
      );
      return (id: number) => groupIds.has(id);
    }
    case "Node":
      // Checking all nodes would be too expensive. Node reservations are marked as used
      // instead (see markReservedIdsAsUsed).
      return (_id: number) => false;
  }
}

// Returns the next `count` reserved ids of the domain without consuming them, or null if
// not enough reservations are available. Reservations whose tree or tree group already exists
// are skipped, so that several trees can be created within one reducer step. They are marked
// as used afterwards (see markExistingReservedIdsAsUsed). Node reservations need to be marked
// as used explicitly.
export function peekReservedIds(
  state: WebknossosState,
  domain: SkeletonIdDomain,
  count: number,
): number[] | null {
  const exists = getExistenceCheck(state, domain);
  const ids = [];
  for (const reservation of state.localSkeletonState.idReservations[domain]) {
    if (ids.length >= count) {
      break;
    }
    if (!reservation.used && !exists(reservation.id)) {
      ids.push(reservation.id);
    }
  }
  return ids.length >= count ? ids : null;
}

export function markReservedIdsAsUsed(
  state: WebknossosState,
  domain: SkeletonIdDomain,
  ids: number[],
): WebknossosState {
  if (!usesReservedSkeletonIds(state) || ids.length === 0) {
    return state;
  }
  const idSet = new Set(ids);
  return update(state, {
    localSkeletonState: {
      idReservations: {
        [domain]: {
          $apply: (reservations: IdReservation[]) =>
            reservations.map((reservation) =>
              idSet.has(reservation.id) ? { ...reservation, used: true } : reservation,
            ),
        },
      },
    },
  });
}

// Marks the tree and tree group reservations as used whose ids exist in the skeleton.
export function markExistingReservedIdsAsUsed(state: WebknossosState): WebknossosState {
  let newState = state;
  for (const domain of ["Tree", "TreeGroup"] as const) {
    const exists = getExistenceCheck(state, domain);
    const existingIds = state.localSkeletonState.idReservations[domain]
      .filter((reservation) => !reservation.used && exists(reservation.id))
      .map((reservation) => reservation.id);
    newState = markReservedIdsAsUsed(newState, domain, existingIds);
  }
  return newState;
}

// Returns the id that the next created node will get, or null if no id is available.
export function getNextNodeId(state: WebknossosState): number | null {
  if (usesReservedSkeletonIds(state)) {
    return peekReservedIds(state, "Node", 1)?.[0] ?? null;
  }
  const skeletonTracing = getSkeletonTracing(state.annotation);
  return skeletonTracing != null ? skeletonTracing.cachedMaxNodeId + 1 : null;
}
