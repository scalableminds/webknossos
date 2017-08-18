// @flow
import { takeEvery, call, select } from "redux-saga/effects";
import Request from "libs/request";

export function* pushAnnotationUpdateAsync(): Generator<*, *, *> {
  const tracing = yield select(state => state.tracing);
  const url = `/annotations/${tracing.tracingType}/${tracing.annotationId}/edit`;
  yield [
    call(Request.sendJSONReceiveJSON, url, {
      data: { name: tracing.name, isPublic: tracing.isPublic },
    }),
  ];
}

export function* watchAnnotationAsync(): Generator<*, *, *> {
  yield takeEvery("SET_ANNOTATION_NAME", pushAnnotationUpdateAsync);
  yield takeEvery("SET_ANNOTATION_PUBLIC", pushAnnotationUpdateAsync);
}
