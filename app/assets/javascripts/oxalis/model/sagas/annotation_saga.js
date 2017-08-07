// @flow
import { takeEvery, call, select } from "redux-saga/effects";
import Request from "libs/request";

export function* pushAnnotationNameAsync(): Generator<*, *, *> {
  const tracing = yield select(state => state.tracing);
  const url = `/annotations/${tracing.tracingType}/${tracing.tracingId}/name`;
  yield [
    call(Request.sendJSONReceiveJSON, url, {
      data: { name: tracing.name },
    }),
  ];
}

export function* pushAnnotationPublicStatusAsync(): Generator<*, *, *> {
  const tracing = yield select(state => state.tracing);
  const url = `/annotations/${tracing.tracingType}/${tracing.tracingId}/name`;
  yield [
    call(Request.sendJSONReceiveJSON, url, {
      data: { isPublic: tracing.isPublic },
    }),
  ];
}

export function* watchAnnotationAsync(): Generator<*, *, *> {
  yield takeEvery("SET_ANNOTATION_NAME", pushAnnotationNameAsync);
  yield takeEvery("SET_ANNOTATION_PUBLIC", pushAnnotationPublicStatusAsync);
}
