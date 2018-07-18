/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import test from "ava";
import { resetDatabase, replaceVolatileValues } from "../enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import { APITracingTypeEnum } from "admin/api_flow_types";

test.before("Reset database", async () => {
  resetDatabase();
});

test("getAnnotationInformation()", async t => {
  const annotationId = "570b9ff12a7c0e980056fe8f";
  const annotation = await api.getAnnotationInformation(
    annotationId,
    APITracingTypeEnum.Explorational,
  );
  t.is(annotation.id, annotationId);
  t.snapshot(annotation, { id: "annotations-getAnnotationInformation" });
});

test.serial("finishAnnotation() and reOpenAnnotation() for task", async t => {
  const annotationId = "78135c192faeb34c0081c05d";
  const finishedAnnotation = await api.finishAnnotation(annotationId, APITracingTypeEnum.Task);
  t.is(finishedAnnotation.state, "Finished");
  t.snapshot(finishedAnnotation, { id: "annotations-finishAnnotation" });

  const reopenedAnnotation = await api.reOpenAnnotation(annotationId, APITracingTypeEnum.Task);
  t.is(reopenedAnnotation.state, "Active");

  t.snapshot(reopenedAnnotation, { id: "annotations-reOpenAnnotation" });
});

test.serial("finishAnnotation() and reOpenAnnotation() for explorational", async t => {
  const annotationId = "68135c192faeb34c0081c05d";
  const finishedAnnotation = await api.finishAnnotation(
    annotationId,
    APITracingTypeEnum.Explorational,
  );
  t.is(finishedAnnotation.state, "Finished");
  t.snapshot(finishedAnnotation, { id: "annotations-finishAnnotation-explorational" });

  const reopenedAnnotation = await api.reOpenAnnotation(
    annotationId,
    APITracingTypeEnum.Explorational,
  );
  t.is(reopenedAnnotation.state, "Active");

  t.snapshot(reopenedAnnotation, { id: "annotations-reOpenAnnotation-explorational" });
});

test.serial("editAnnotation()", async t => {
  const annotationId = "68135c192faeb34c0081c05d";
  const originalAnnotation = await api.getAnnotationInformation(
    annotationId,
    APITracingTypeEnum.Explorational,
  );
  const { name, isPublic, description } = originalAnnotation;

  const newName = "new name";
  const newIsPublic = !isPublic;
  const newDescription = "new description";

  await api.editAnnotation(annotationId, APITracingTypeEnum.Explorational, {
    name: newName,
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

test.serial("finishAllAnnotations()", async t => {
  const annotationIds = ["78135c192faeb34c0081c05d", "78135c192faeb34c0081c05e"];

  await api.finishAllAnnotations(annotationIds);

  const finishedAnnotations = await Promise.all(
    annotationIds.map(id => api.getAnnotationInformation(id, APITracingTypeEnum.Explorational)),
  );

  t.is(finishedAnnotations.length, 2);
  finishedAnnotations.forEach(annotation => {
    t.is(annotation.state, "Finished");
  });

  await Promise.all(annotationIds.map(id => api.reOpenAnnotation(id, APITracingTypeEnum.Task)));
});

test.serial("createExplorational() and finishAnnotation()", async t => {
  const dataSetName = "confocal-multi_knossos";
  const createdExplorational = await api.createExplorational(dataSetName, "skeleton", false);

  t.snapshot(replaceVolatileValues(createdExplorational), {
    id: "annotations-createExplorational",
  });

  await api.finishAnnotation(createdExplorational.id, APITracingTypeEnum.Explorational);

  const finishedAnnotation = await api.getAnnotationInformation(
    createdExplorational.id,
    APITracingTypeEnum.Explorational,
  );
  t.is(finishedAnnotation.state, "Finished");
});
