// @flow
import { takeEvery, call, select } from "redux-saga/effects";
import Request from "libs/request";

export function* pushAnnotationUpdateAsync(): Generator<*, *, *> {
  const tracing = yield select(state => state.tracing);
<<<<<<< HEAD
  const url = `/annotations/${tracing.tracingType}/${tracing.annotationId}/name`;
||||||| merged common ancestors
  const url = `/annotations/${tracing.tracingType}/${tracing.tracingId}/name`;
=======
  const url = `/annotations/${tracing.tracingType}/${tracing.tracingId}/edit`;
>>>>>>> master
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
