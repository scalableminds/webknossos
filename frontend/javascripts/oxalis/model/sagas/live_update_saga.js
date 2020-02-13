// @flow

import { type Saga } from "redux-saga";
import Store from "oxalis/store";
import { _delay, take, select } from "oxalis/model/sagas/effect-generators";
import { applyUpdateActionsAction } from "oxalis/model/actions/skeletontracing_actions";
import { doWithToken } from "admin/admin_rest_api";
import { enforceSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";

function onMessage(event) {
  try {
    // $FlowFixMe
    const json = JSON.parse(event.data);
    const { token, value: data } = json;
    console.log("LiveUpdate websocket message (json):", data);

    const currentVersion = enforceSkeletonTracing(Store.getState().tracing).version;

    if (data[0].version > currentVersion) {
      for (const saveEntry of data) {
        Store.dispatch(applyUpdateActionsAction(saveEntry.actions, saveEntry.version, token));
      }
    } else {
      console.log(
        `Message received was for old version ${
          data.version
        }, but we are already at version ${currentVersion}`,
      );
    }
  } catch {
    console.log("LiveUpdate websocket message (non-json):", event.data);
  }
}

// $FlowFixMe
export function* receiveTracingUpdates(): Saga<void> {
  yield* take("WK_READY");

  // const initialAllowUpdate = yield* select(
  //   state => state.tracing.restrictions.allowUpdate && state.tracing.restrictions.allowSave,
  // );
  // if (!initialAllowUpdate) return;

  const tracingStoreUrl = yield* select(state => state.tracing.tracingStore.url);
  const wsUrl = `ws${tracingStoreUrl.slice(tracingStoreUrl.indexOf(":"))}`;
  const wsUrlWithCorrectPort = wsUrl.replace("9000", "9001");

  let datastoreToken = "";
  yield doWithToken(
    token =>
      new Promise(resolve => {
        datastoreToken = token;
        resolve();
      }),
  );

  const updateSocket = new WebSocket(
    `${wsUrlWithCorrectPort}/tracings/skeleton/tracingId/liveUpdate?token=${datastoreToken}`,
  );

  updateSocket.onerror = event => console.log("LiveUpdate websocket error:", event);
  updateSocket.onclose = event => console.log("LiveUpdate websocket closed:", event);
  updateSocket.onmessage = onMessage;

  yield new Promise(resolve => {
    updateSocket.onopen = () => resolve();
  });

  console.log("liveUpdate websocket established.");

  while (updateSocket.readyState === updateSocket.OPEN) {
    updateSocket.send("Heartbeat");
    yield _delay(5000);
  }
}

export default {};
