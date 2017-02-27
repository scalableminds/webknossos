import { call, spawn, take } from "redux-saga/effects";
import Request from "libs/request";

function centerActiveNode() {
  // pass
}

function* pushAnnotation(action, payload) {
  const APICall = Request.sendJSONReceiveJSON(
    `/annotations/${this.tracingType}/${this.tracingId}?version=${(version + 1)}`, {
      method: "PUT",
      data: [{
        action,
        value: payload,
      }],
    },
  );

  yield call(APICall);
}

export function* watchSkeletonTracingAsync() {
  yield [
    take("SET_ACTIVE_TREE", centerActiveNode),
    take("SET_ACTIVE_NODE", centerActiveNode),
    take("DELETE_NODE", centerActiveNode),
  ];
}

