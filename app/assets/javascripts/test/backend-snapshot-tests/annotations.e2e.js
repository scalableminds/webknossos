/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import test from "ava";
import "../enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import _ from "lodash";
import { APITracingTypeEnum } from "admin/api_flow_types";

test("getAnnotationInformation()", async t => {
  const annotationId = "570b9ff12a7c0e980056fe8f";
  const annotation = await api.getAnnotationInformation(annotationId, "skeleton");
  t.is(annotation.id, annotationId);
  t.snapshot(annotation, { id: "annotations-getAnnotationInformation" });
});

// needs datastore
// test.serial("createExplorational() and deleteAnnotation()", async t => {
//   const dataSetName = "confocal-multi_knossos";
//   const createdExplorational = await api.createExplorational(dataSetName, "skeleton", false);
//   t.is(createdExplorational.dataSetName, dataSetName);
//   t.snapshot(createdExplorational, { id: "annotations-createExplorational" });

//   const deletedAnnotation = await api.deleteAnnotation(
//     createdExplorational.id,
//     APITracingTypeEnum.Explorational,
//   );
// });
// export async function resetAnnotation(
//   annotationId: string,
//   annotationType: APITracingType,
// ): Promise<APIAnnotationType> {
//   return Request.receiveJSON(`/api/annotations/${annotationType}/${annotationId}/reset`);
// }
// export async function copyAnnotationToUserAccount(
//   annotationId: string,
//   tracingType: string,
// ): Promise<APIAnnotationType> {
//   const url = `/api/annotations/${tracingType}/${annotationId}/duplicate`;
//   return Request.receiveJSON(url);
// }

// test finish explorational

test("finishAnnotation() and reOpenAnnotation()", async t => {
  const annotationId = "58135c402faeb34e0081c068";
  const finishedAnnotation = await api.finishAnnotation(annotationId, APITracingTypeEnum.Task);
  t.is(finishedAnnotation.state, "Finished");
  t.snapshot(finishedAnnotation, { id: "annotations-finishAnnotation" });

  const reopenedAnnotation = await api.reOpenAnnotation(annotationId, APITracingTypeEnum.Task);
  t.is(reopenedAnnotation.state, "Active");
  // $FlowFixMe: Make tracingTime deterministic
  reopenedAnnotation.task.tracingTime = 100;
  // reopenedAnnotation.tracingTime = 100;

  t.snapshot(reopenedAnnotation, { id: "annotations-reOpenAnnotation" });
});

test("editAnnotation()", async t => {
  const annotationId = "58135c192faeb34c0081c05d";
  const originalAnnotation = await api.getAnnotationInformation(
    annotationId,
    APITracingTypeEnum.Explorational,
  );
  const { name, isPublic, description } = originalAnnotation;

  const newName = "new name";
  const newIsPublic = !isPublic;
  const newDescription = "new description";

  await api.editAnnotation(annotationId, APITracingTypeEnum.Explorational, {
    name: "new name",
    isPublic: newIsPublic,
    description: newDescription,
  });
  const editedAnnotation = await api.getAnnotationInformation(
    annotationId,
    APITracingTypeEnum.Explorational,
  );

  t.is(editedAnnotation.name, newName);
  t.is(editedAnnotation.isPublic, newIsPublic);
  t.is(editedAnnotation.description, newDescription);
  t.snapshot(editedAnnotation, { id: "annotations-editAnnotation" });

  await api.editAnnotation(annotationId, APITracingTypeEnum.Explorational, {
    name,
    isPublic,
    description,
  });
});

// export async function finishAllAnnotations(
//   selectedAnnotationIds: Array<string>,
// ): Promise<{ messages: Array<MessageType> }> {
//   return Request.sendJSONReceiveJSON("/api/annotations/Explorational/finish", {
//     data: {
//       annotations: selectedAnnotationIds,
//     },
//   });
// }
