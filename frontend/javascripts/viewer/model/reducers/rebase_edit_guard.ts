/*
 * Reducer wrapper that blocks user edits while the annotation is rebasing/forwarding.
 *
 * Reasoning: In concurrent (live) collaboration, the save saga periodically does a git like
 * rebasing / forwarding mechanism of the tracing states. During this window the user must not
 * change save relevant state of the tracings or else these updates will be lost and never sent to the server.
 *
 * To prevent this, `withRebaseEditGuard` wraps the root reducer and drops save-relevant editing
 * actions while a rebase/forwarding is active. Actions the rebase itself replays are excluded from this.
 * (see REBASE_REPLAY_ACTIONS).
 */
import { getIsRebasingOrForwarding } from "viewer/model/accessors/annotation_accessor";
import type { Action } from "viewer/model/actions/actions";
import { SkeletonTracingSaveRelevantActions } from "viewer/model/actions/skeletontracing_actions";
import { VolumeTracingSaveRelevantActions } from "viewer/model/actions/volumetracing_actions";
import type { WebknossosState } from "viewer/store";

type Reducer = (state: WebknossosState, action: Action) => WebknossosState;

// Actions that the rebase machinery dispatches itself while isRebasingOrForwarding is true
// (see save_saga.tsx `tryToIncorporateActions`). They live in the save-relevant action lists
// (because a user editing them should be diffed to the save queue), so they would be caught by
// the guard below — but they must keep being applied during a rebase to replay the incoming
// server changes. They are therefore removed from ACTIONS_DROPPED_DURING_REBASE below.
const REBASE_REPLAY_ACTIONS: ReadonlySet<Action["type"]> = new Set<Action["type"]>([
  // Mapping (re-)activation replayed from the server during a rebase.
  "SET_MAPPING",
  "SET_MAPPING_DATA",
  "SET_MAPPING_ENABLED",
  "FINISH_MAPPING_INITIALIZATION",
  "SET_HAS_EDITABLE_MAPPING",
  "SET_MAPPING_IS_LOCKED",
  // Tracing (re-)initialization.
  "INITIALIZE_SKELETONTRACING",
  "INITIALIZE_ANNOTATION_WITH_TRACINGS",
]);

// User editing actions whose effects would be diffed into the save queue. While a rebase or
// forwarding is in progress, the diffing saga ignores such changes (mayAddToSaveQueue === false)
// and afterwards FINISHED_REBASING resets the diff baseline to the current store. As a result,
// an edit made during that window would be applied to the store but never saved (silent data
// loss). We therefore drop these actions entirely while isRebasingOrForwarding is true to stay
// in sync with the server and not diverge from it.
//
// This is intentionally derived from the save-relevant action lists so that tools added in the
// future (e.g. skeleton/volume editing enabled in live collaboration) are covered automatically.
// Note that camera/view actions (FlycamActions, ViewModeSaveRelevantActions) are NOT part of
// these lists, so the viewport stays freely movable during a rebase.
export const ACTIONS_DROPPED_DURING_REBASE: ReadonlySet<Action["type"]> = new Set<Action["type"]>(
  // The save-relevant action lists are inferred as string[], so cast to the action-type union.
  (
    [...SkeletonTracingSaveRelevantActions, ...VolumeTracingSaveRelevantActions] as Action["type"][]
  ).filter((actionType) => !REBASE_REPLAY_ACTIONS.has(actionType)),
);

// Wraps the root reducer to drop user editing actions while a rebase/forwarding is active.
// See ACTIONS_DROPPED_DURING_REBASE above for the reasoning.
export function withRebaseEditGuard(innerReducer: Reducer): Reducer {
  return (state, action) => {
    if (
      state != null &&
      getIsRebasingOrForwarding(state) &&
      ACTIONS_DROPPED_DURING_REBASE.has(action.type)
    ) {
      return state;
    }
    return innerReducer(state, action);
  };
}
