/*
 * This saga listens to all dispatched redux actions and ships them (including their properties)
 * to the backend in batches, which forwards them to Loki. It is purely observational and must
 * never disrupt the application: sending is fire-and-forget and failures are swallowed.
 */

import { sendReduxActionLog } from "admin/rest_api";
import Date from "libs/date";
import { TAB_SESSION_ID } from "libs/tab_session_id";
import { buffers } from "redux-saga";
import { actionChannel, call, delay, race, take } from "typed-redux-saga";
import type { Action } from "viewer/model/actions/actions";
import { actionBlacklist } from "viewer/model/helpers/action_logger_middleware";
import type { Saga } from "viewer/model/sagas/effect_generators";
import { select } from "viewer/model/sagas/effect_generators";
import { ensureWkInitialized } from "viewer/model/sagas/ready_sagas";

const FLUSH_INTERVAL_MS = 10000;
const MAX_BATCH_SIZE = 100;
// A single action whose serialized form exceeds this size is logged as type-only to avoid
// bloating a batch (e.g. actions carrying large data payloads).
const MAX_ACTION_SERIALIZED_LENGTH = 10000;

const blacklist = new Set(actionBlacklist);

type ActionLogEntry = { timestamp: number; action: unknown };

// Returns a JSON-safe representation of the action. Falls back to a type-only entry if the
// action is too large or cannot be serialized (e.g. circular references), so that a single
// problematic action never causes the whole batch send to fail.
function sanitizeAction(action: Action): unknown {
  try {
    const serialized = JSON.stringify(action);
    if (serialized == null) {
      return { type: action.type };
    }
    if (serialized.length > MAX_ACTION_SERIALIZED_LENGTH) {
      return { type: action.type, _truncated: true };
    }
    return action;
  } catch (_error) {
    return { type: action.type, _unserializable: true };
  }
}

function collect(buffer: ActionLogEntry[], action: Action): void {
  if (blacklist.has(action.type)) {
    return;
  }
  buffer.push({ timestamp: Date.now(), action: sanitizeAction(action) });
}

export default function* reduxActionLoggingSaga(): Saga<void> {
  yield* call(ensureWkInitialized);

  // Test balloon: only ship action logs for super users for now, to avoid sending too much
  // data over the wire before the volume/usefulness tradeoff has been evaluated.
  const activeUser = yield* select((state) => state.activeUser);
  if (activeUser == null || !activeUser.isSuperUser) {
    return;
  }

  // Use an actionChannel so that no actions are missed while a batch is being sent.
  const channel = yield* actionChannel("*", buffers.expanding<Action>());
  let buffer: ActionLogEntry[] = [];

  while (true) {
    // Block until at least one action arrives, then keep accumulating until the batch is full
    // or the flush interval elapses.
    const firstAction = yield* take(channel);
    collect(buffer, firstAction);

    while (buffer.length < MAX_BATCH_SIZE) {
      const { action } = yield* race({
        action: take(channel),
        timeout: delay(FLUSH_INTERVAL_MS),
      });
      if (action == null) {
        // Flush interval elapsed.
        break;
      }
      collect(buffer, action);
    }

    if (buffer.length > 0) {
      const batch = buffer;
      buffer = [];
      try {
        yield* call(sendReduxActionLog, TAB_SESSION_ID, batch);
      } catch (_error) {
        // Fire-and-forget: dropping the batch is acceptable and must not disrupt the app.
      }
    }
  }
}
