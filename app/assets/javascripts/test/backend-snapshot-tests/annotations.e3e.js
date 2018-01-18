/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import Request from "libs/request";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

// test("finishAnnotation and reOpenAnnotation", async t => {
//   const annotationId = "570ba0092a7c0e980056fe9b";
//   const finished = await api.finishAnnotation(annotationId);
//   t.snapshot(finished, { id: "annotations-finishAnnotation" });

//   const reopened = await api.reOpenAnnotation(annotationId);
//   t.snapshot(reopened, { id: "annotations-reOpenAnnotation" });
// });

// test("resetAnnotation(annotationId: string)", async t => {
//   const annotationId = "570ba0092a7c0e980056fe9b";
//   const resetted = await api.resetAnnotation(annotationId);
//   t.snapshot(resetted, { id: "annotations-resetAnnotation" });
// });

// test("deleteAnnotation(annotationId: string)", async t => {
//   const deleted = await api.deleteAnnotation((annotationId: string));
//   t.snapshot(deleted, { id: "annotations-deleteAnnotation" });
// });

// test("copyAnnotationToUserAccount(annotationId: string, tracingType: string)", async t => {
//   const copied = await api.copyAnnotationToUserAccount(
//     (annotationId: string),
//     (tracingType: string),
//   );
//   t.snapshot(copied, { id: "annotations-copyAnnotationToUserAccount" });
// });

// test("getAnnotationInformation(annotationId: string, tracingType: string)", async t => {
//   const annotationInformation = await api.getAnnotationInformation(
//     "570ba0092a7c0e980056fe9b",
//     "Explorational",
//   );
//   t.snapshot(annotationInformation, { id: "annotations-getAnnotationInformation" });
// });
