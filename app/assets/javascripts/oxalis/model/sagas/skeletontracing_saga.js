import { call, spawn } from "redux-saga/effects";
import Request from "libs/request";

let version = 0;

function* pushAnnotation(action, payload) {
  const APICall = Request.sendJSONReceiveJSON(
    `/annotations/${this.tracingType}/${this.tracingId}?version=${(this.version + 1)}`, {
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
  yield spawn(pushAnnotation, "PUSH_SKELETONTRACING_ANNOTATION");
}

