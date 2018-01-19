// @flow
import { takeEvery, call, select } from "redux-saga/effects";
import { editAnnotation } from "admin/admin_rest_api";

export function* pushAnnotationUpdateAsync(): Generator<*, *, *> {
  const tracing = yield select(state => state.tracing);
  yield [
    call(editAnnotation, tracing.annotationId, tracing.tracingType, {
      name: tracing.name,
      isPublic: tracing.isPublic,
      description: tracing.description,
    }),
  ];
}

export function* watchAnnotationAsync(): Generator<*, *, *> {
  yield takeEvery("SET_ANNOTATION_NAME", pushAnnotationUpdateAsync);
  yield takeEvery("SET_ANNOTATION_PUBLIC", pushAnnotationUpdateAsync);
  yield takeEvery("SET_ANNOTATION_DESCRIPTION", pushAnnotationUpdateAsync);
}
