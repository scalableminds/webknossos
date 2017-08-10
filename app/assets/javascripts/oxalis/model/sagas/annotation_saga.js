// @flow
import { takeEvery, call, select } from "redux-saga/effects";
import Request from "libs/request";

export function* pushTracingNameAsync(): Generator<*, *, *> {
  const tracing = yield select(state => state.tracing);
  const url = `/annotations/${tracing.tracingType}/${tracing.annotationId}/name`;
  yield [
    call(Request.sendJSONReceiveJSON, url, {
      data: { name: tracing.name },
    }),
  ];
}

export function* watchAnnotationAsync(): Generator<*, *, *> {
  yield takeEvery("SET_TRACING_NAME", pushTracingNameAsync);
}
