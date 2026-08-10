import { buffers, type Channel } from "redux-saga";
import { actionChannel, call, delay, flush, put, race } from "typed-redux-saga";
import { isAnnotationEditableByNonOwners } from "viewer/model/accessors/annotation_accessor";
import { hasTracing } from "viewer/model/accessors/tracing_accessor";
import type { Action } from "viewer/model/actions/actions";
import type { EnsureHasNewestVersionAction } from "viewer/model/actions/save_actions";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select, take } from "viewer/model/sagas/effect_generators";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";
import type { WebknossosState } from "viewer/store";
import { getOrCreateOperationContext } from "../operation_context_saga";
import { waitFor } from "../saga_helpers";
import { performRebasingIfNecessary } from "./rebasing/rebasing_sagas";

/*
 * This module polls the server for newer versions of the current annotation and triggers a rebase
 * if newer versions exist (see rebasing_sagas.ts). Polling can also be requested on demand via the
 * ENSURE_HAS_NEWEST_VERSION action.
 */

export const VERSION_POLL_INTERVAL_COLLAB = process.env.IS_TESTING ? 500 : 10 * 1000;
const VERSION_POLL_INTERVAL_READ_ONLY = process.env.IS_TESTING ? 250 : 5 * 1000;
const VERSION_POLL_INTERVAL_SINGLE_EDITOR = process.env.IS_TESTING ? 1 * 1000 : 30 * 1000;

const REBASING_BUSY_BLOCK_REASON = "Syncing Annotation";

export function* watchForNewerAnnotationVersion(): Saga<void> {
  yield* call(ensureWkInitialized);

  const channel = yield* actionChannel<EnsureHasNewestVersionAction>(
    ["ENSURE_HAS_NEWEST_VERSION"],
    // If multiple actions are sent to this buffer (without consumption in between),
    // we want to flush them all at once. This is achieved by using an expanding buffer
    // and flushing all events and calling their callbacks every time an ensureHasNewestVersion
    // action is resolved.
    buffers.expanding<EnsureHasNewestVersionAction>(1),
  );
  while (true) {
    const interval = yield* call(getPollInterval);
    let { ensureHasNewestVersion: untypedEnsureHasNewestVersion } = yield* race({
      sleep: delay(interval),
      ensureHasNewestVersion: take(channel),
    });
    const ensureHasNewestVersion = untypedEnsureHasNewestVersion as
      | EnsureHasNewestVersionAction
      | undefined;
    const needsCheckForUpdatesOnServer = yield* select(needsPollAnnotationUpdates);
    if (needsCheckForUpdatesOnServer === "no") {
      // We don't need to poll for the newest version (because we can safely assume that
      // we already know about it).
      yield* call(fulfillAllEnsureHasNewestVersionActions, ensureHasNewestVersion, channel);
      continue;
    } else if (needsCheckForUpdatesOnServer === "later") {
      yield* maybeRequeuePollAndWait(ensureHasNewestVersion);
      continue;
    }

    // Now, let's initiate the actual rebasing. For that, we acquire the operation context
    // to block user actions from interfering with rebasing.
    const ctx = yield* getOrCreateOperationContext(
      {
        id: "REBASE",
        description: REBASING_BUSY_BLOCK_REASON,
        behaviorWhenDisallowed: "ignore",
      },
      ensureHasNewestVersion?.operationContext ?? null,
    );
    if (ctx == null) {
      yield* maybeRequeuePollAndWait(ensureHasNewestVersion);
      continue;
    }
    const { successful, shouldTerminate } = yield* ctx.execute(function* () {
      return yield* call(performRebasingIfNecessary);
    });

    if (shouldTerminate) {
      // A hard error was thrown. Terminate this saga.
      break;
    }
    if (successful) {
      yield* call(fulfillAllEnsureHasNewestVersionActions, ensureHasNewestVersion, channel);
    } else {
      // The user was already notified about the current annotation being outdated.
      // There is not much else we can do now. Sleep for 5 minutes.
      yield* delay(5 * 60 * 1000);
    }
  }
}

function* getPollInterval(): Saga<number> {
  const allowSave = yield* select((state) => state.annotation.restrictions.allowSave);
  if (!allowSave) {
    // The current user may not edit/save the annotation.
    return VERSION_POLL_INTERVAL_READ_ONLY;
  }

  const othersMayEdit = yield* select((state) => isAnnotationEditableByNonOwners(state.annotation));
  if (othersMayEdit) {
    // Other users may edit the annotation.
    return VERSION_POLL_INTERVAL_COLLAB;
  }
  // The current user is the only one who can edit the annotation.
  return VERSION_POLL_INTERVAL_SINGLE_EDITOR;
}

function needsPollAnnotationUpdates(state: WebknossosState): "yes" | "no" | "later" {
  // We usually want to poll for new annotation versions. We merely avoid this
  // in the following cases:

  // If the version restore view is open, newer versions should not be fetched
  // as this could mess up the current state.
  // Similarly, we should not poll for updates when a rebase is in progress.
  const { isRestoringVersion, showVersionRestore } = state.uiInformation;
  const isVersionRestoreActive = showVersionRestore && !isRestoringVersion;
  const { isRebasingOrForwarding } = state.save.rebaseRelevantServerAnnotationState;
  if (isVersionRestoreActive || isRebasingOrForwarding) {
    return "later";
  }

  if (state.save.isSavingDisabled) {
    // When saving is disabled, the user is free to edit the annotation however they like.
    // If they had a mutex before, that will be released.
    // Therefore, other users may edit the annotation at the same time.
    // We must not poll for updates, because we cannot incorporate all possible update actions
    // while having local changes.
    return "no";
  }

  // If the current user may edit the annotation while the collab mode is not Concurrent,
  // we don't need to fetch newer versions (because there shouldn't be any since nobody else
  // should be allowed to push a newer version). This is the case when the current user
  // is either the owner or a collaborator with the mutex.
  const { isUpdatingCurrentlyAllowed } = state.annotation;
  const { collaborationMode } = state.annotation;
  const mayEditInNonConcurrentMode =
    isUpdatingCurrentlyAllowed && collaborationMode !== "Concurrent";
  if (mayEditInNonConcurrentMode) {
    // WK should already show the newest version of the annotation.
    // However, there is a rare chance of two problematic scenarios currently:
    // - the current user opened the annotation twice (we don't guard against this in OwnerOnly mode, yet)
    // - there was a race condition where the current user C loads version X, another user U pushes
    //   version X+1 and U releases the mutex, only then C acquires the mutex. Now, C doesn't know about
    //   X+1.
    // The worst case is that the users gets a 409 error during saving (thus, losing 30 seconds of work).
    // We can improve this in the future by always polling once all update actions are supported in rebasing
    // (see #9052)
    return "no";
  }

  // If there are no tracings, we don't need need to poll for updates
  if (!hasTracing(state.annotation)) {
    return "no";
  }
  // In all other cases, poll
  return "yes";
}

function* maybeRequeuePollAndWait(
  ensureHasNewestVersion: EnsureHasNewestVersionAction | undefined,
): Saga<void> {
  // We need to postpone the poll operation (because the version restore is open).
  if (ensureHasNewestVersion != null) {
    // The ensureHasNewestVersion action was already dequeued from the channel.
    // Put it back by dispatching it again.
    yield* put(ensureHasNewestVersion);
    // Now, wait in a throttled manner until needsPollAnnotationUpdates becomes "yes".
    yield* waitFor((state) => needsPollAnnotationUpdates(state) === "yes");
  }
}

function* fulfillAllEnsureHasNewestVersionActions(
  ensureHasNewestVersion: Action | undefined,
  channel: Channel<EnsureHasNewestVersionAction>,
): Saga<void> {
  // drain all accumulated actions at once
  const pendingActions: EnsureHasNewestVersionAction[] = yield* flush(channel);

  // include the first action we already took from the race
  const actionsToProcess = ensureHasNewestVersion
    ? [ensureHasNewestVersion, ...pendingActions]
    : pendingActions;

  for (const action of actionsToProcess) {
    (action as EnsureHasNewestVersionAction).callback();
  }
}
