// @flow

import { type Saga } from "redux-saga";
import Store from "oxalis/store";
import { _delay, take, select } from "oxalis/model/sagas/effect-generators";
import { createTreeAction, createNodeAction } from "oxalis/model/actions/skeletontracing_actions";

function onMessage(event) {
  try {
    const data = JSON.parse(event.data);
    console.log("LiveUpdate websocket message (json):", data);

    const currentVersion = Store.getState().tracing.version;

    if (data.version > currentVersion) {
      for (const ua of data.actions) {
        if (ua.name === "createTree") {
          Store.dispatch(createTreeAction());
        } else if (ua.name === "createNode") {
          const { position, rotation, viewport, resolution, treeId } = ua.value;
          Store.dispatch(createNodeAction(position, rotation, viewport, resolution, treeId));
        }
      }
    } else {
      console.log(
        `Message received was for old version ${
          data.version
        }, but we are already at version ${currentVersion}`,
      );
    }
  } catch {
    console.log(`LiveUpdate websocket message (non-json): ${event.data}`);
  }
}

export function* receiveTracingUpdates(): Saga<void> {
  yield* take("WK_READY");

  const initialAllowUpdate = yield* select(
    state => state.tracing.restrictions.allowUpdate && state.tracing.restrictions.allowSave,
  );
  if (!initialAllowUpdate) return;

  const tracingStoreUrl = yield* select(state => state.tracing.tracingStore.url);
  const wsUrl = `ws${tracingStoreUrl.slice(tracingStoreUrl.indexOf(":"))}`;
  const wsUrlWithCorrectPort = wsUrl.replace("9000", "9001");

  const updateSocket = new WebSocket(
    `${wsUrlWithCorrectPort}/tracings/skeleton/tracingId/liveUpdate`,
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
