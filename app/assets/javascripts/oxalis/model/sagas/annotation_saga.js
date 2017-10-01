// @flow
import { takeEvery, call, select } from "redux-saga/effects";
import Request from "libs/request";

export function* pushAnnotationUpdateAsync(): Generator<*, *, *> {
  const tracing = yield select(state => state.tracing);
  const url = `/annotations/${tracing.tracingType}/${tracing.tracingId}/edit`;
  yield [
    call(Request.sendJSONReceiveJSON, url, {
      data: { name: tracing.name, isPublic: tracing.isPublic, description: tracing.description },
    }),
  ];
}

export function* watchAnnotationAsync(): Generator<*, *, *> {
  yield takeEvery("SET_ANNOTATION_NAME", pushAnnotationUpdateAsync);
  yield takeEvery("SET_ANNOTATION_PUBLIC", pushAnnotationUpdateAsync);
  yield takeEvery("SET_ANNOTATION_DESCRIPTION", pushAnnotationUpdateAsync);
}
