import {
  resetDatabase,
  replaceVolatileValues,
  setCurrToken,
  tokenUserA,
  writeTypeCheckingFile,
} from "test/enzyme/e2e-setup";
import type { APIAnnotation } from "types/api_flow_types";
import { APIAnnotationTypeEnum } from "types/api_flow_types";
import { createTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { diffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import {
  getNullableSkeletonTracing,
  getSkeletonDescriptor,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { getServerVolumeTracings } from "oxalis/model/accessors/volumetracing_accessor";
import { sendRequestWithToken, addVersionNumbers } from "oxalis/model/sagas/save_saga";
import * as UpdateActions from "oxalis/model/sagas/update_actions";
import * as api from "admin/admin_rest_api";
import generateDummyTrees from "oxalis/model/helpers/generate_dummy_trees";
import test from "ava";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
const datasetId = {
  name: "confocal-multi_knossos",
  owningOrganization: "Organization_X",
};
process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});
test.before("Reset database", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});
test("getAnnotationInformation()", async (t) => {
  const annotationId = "570ba0092a7c0e980056fe9b";
  const annotation = await api.getAnnotationInformation(annotationId);
  t.is(annotation.id, annotationId);
  writeTypeCheckingFile(annotation, "annotation", "APIAnnotation");
  t.snapshot(annotation, {
    id: "annotations-getAnnotationInformation",
  });
});
test("getAnnotationInformation() for public annotation while logged out", async (t) => {
  setCurrToken("invalidToken");
  const annotationId = "88135c192faeb34c0081c05d";
  const annotation = await api.getAnnotationInformation(annotationId);
  t.is(annotation.id, annotationId);
  t.snapshot(annotation, {
    id: "annotations-getAnnotationInformation-public",
  });
  setCurrToken(tokenUserA);
});
test.serial("getReadableAnnotations()", async (t) => {
  const annotations = await api.getReadableAnnotations(false, 0);
  t.snapshot(replaceVolatileValues(annotations), {
    id: "annotations-listReadable",
  });
});
test.serial("finishAnnotation() and reOpenAnnotation() for task", async (t) => {
  const annotationId = "78135c192faeb34c0081c05d";
  const finishedAnnotation = await api.finishAnnotation(annotationId, APIAnnotationTypeEnum.Task);
  t.is(finishedAnnotation.state, "Finished");
  t.snapshot(replaceVolatileValues(finishedAnnotation), {
    id: "annotations-finishAnnotation",
  });
  const reopenedAnnotation = await api.reOpenAnnotation(annotationId, APIAnnotationTypeEnum.Task);
  t.is(reopenedAnnotation.state, "Active");
  t.snapshot(replaceVolatileValues(reopenedAnnotation), {
    id: "annotations-reOpenAnnotation",
  });
});
test.serial("finishAnnotation() and reOpenAnnotation() for explorational", async (t) => {
  const annotationId = "68135c192faeb34c0081c05d";
  const finishedAnnotation = await api.finishAnnotation(
    annotationId,
    APIAnnotationTypeEnum.Explorational,
  );
  t.is(finishedAnnotation.state, "Finished");
  t.snapshot(replaceVolatileValues(finishedAnnotation), {
    id: "annotations-finishAnnotation-explorational",
  });
  const reopenedAnnotation = await api.reOpenAnnotation(
    annotationId,
    APIAnnotationTypeEnum.Explorational,
  );
  t.is(reopenedAnnotation.state, "Active");
  t.snapshot(replaceVolatileValues(reopenedAnnotation), {
    id: "annotations-reOpenAnnotation-explorational",
  });
});
test.serial("editAnnotation()", async (t) => {
  const annotationId = "68135c192faeb34c0081c05d";
  const originalAnnotation = await api.getAnnotationInformation(annotationId);
  const { name, visibility, description } = originalAnnotation;
  const newName = "new name";
  const newVisibility = "Public";
  const newDescription = "new description";
  await api.editAnnotation(annotationId, APIAnnotationTypeEnum.Explorational, {
    name: newName,
    visibility: newVisibility,
    description: newDescription,
  });
  const editedAnnotation = await api.getAnnotationInformation(annotationId);
  t.is(editedAnnotation.name, newName);
  t.is(editedAnnotation.visibility, newVisibility);
  t.is(editedAnnotation.description, newDescription);
  t.is(editedAnnotation.id, annotationId);
  t.is(editedAnnotation.annotationLayers[0].typ, "Skeleton");
  t.is(editedAnnotation.annotationLayers[0].tracingId, "ae417175-f7bb-4a34-8187-d9c3b50143af");
  t.snapshot(replaceVolatileValues(editedAnnotation), {
    id: "annotations-editAnnotation",
  });
  await api.editAnnotation(annotationId, APIAnnotationTypeEnum.Explorational, {
    name,
    visibility,
    description,
  });
});
test.serial("finishAllAnnotations()", async (t) => {
  const annotationIds = ["78135c192faeb34c0081c05d", "78135c192faeb34c0081c05e"];
  await api.finishAllAnnotations(annotationIds);
  const finishedAnnotations = await Promise.all(
    annotationIds.map((id) => api.getAnnotationInformation(id)),
  );
  t.is(finishedAnnotations.length, 2);
  finishedAnnotations.forEach((annotation) => {
    t.is(annotation.state, "Finished");
  });
  await Promise.all(
    annotationIds.map((id) => api.reOpenAnnotation(id, APIAnnotationTypeEnum.Task)),
  );
});
test.serial("createExplorational() and finishAnnotation()", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
  t.snapshot(replaceVolatileValues(createdExplorational), {
    id: "annotations-createExplorational",
  });
  await api.finishAnnotation(createdExplorational.id, APIAnnotationTypeEnum.Explorational);
  const finishedAnnotation = await api.getAnnotationInformation(createdExplorational.id);
  t.is(finishedAnnotation.state, "Finished");
});
test.serial("getTracingsForAnnotation()", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  writeTypeCheckingFile(tracings[0], "tracing", "ServerSkeletonTracing");
  t.snapshot(replaceVolatileValues(tracings[0]), {
    id: "annotations-tracing",
  });
});
test.serial("getTracingsForAnnotation() for volume", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "volume", false, null);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  writeTypeCheckingFile(tracings[0], "tracing-volume", "ServerVolumeTracing");
  t.snapshot(replaceVolatileValues(tracings[0]), {
    id: "annotations-tracing-volume",
  });
});
test.serial("getTracingsForAnnotation() for hybrid", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "hybrid", false, null);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  writeTypeCheckingFile(tracings, "tracing-hybrid", "ServerTracing", {
    isArray: true,
  });
  // The volatileValues list includes "skeleton" and "volume", because of other requests, so we need to do it like this
  t.snapshot(
    {
      skeleton: replaceVolatileValues(getNullableSkeletonTracing(tracings)),
      volume: replaceVolatileValues(getServerVolumeTracings(tracings)[0]),
    },
    {
      id: "annotations-tracing-hybrid",
    },
  );
});

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'queue' implicitly has an 'any' type.
async function sendUpdateActionsForSkeleton(explorational: APIAnnotation, queue) {
  const skeletonTracing = getSkeletonDescriptor(explorational);
  if (skeletonTracing == null) throw new Error("No skeleton annotation present.");
  return sendRequestWithToken(
    `${explorational.tracingStore.url}/tracings/skeleton/${skeletonTracing.tracingId}/update?token=`,
    {
      method: "POST",
      data: queue,
      compress: false,
    },
  );
}

test.serial("Send update actions and compare resulting tracing", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
  const initialSkeleton = {
    activeNodeId: undefined,
    userBoundingBoxes: [],
  };
  const [saveQueue] = addVersionNumbers(
    createSaveQueueFromUpdateActions(
      [
        [UpdateActions.updateSkeletonTracing(initialSkeleton, [1, 2, 3], null, [0, 1, 2], 1)],
        [UpdateActions.updateSkeletonTracing(initialSkeleton, [2, 3, 4], null, [1, 2, 3], 2)],
      ],
      123456789,
    ),
    0,
  );
  await sendUpdateActionsForSkeleton(createdExplorational, saveQueue);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  t.snapshot(replaceVolatileValues(tracings[0]), {
    id: "annotations-updateActions",
  });
});
test("Send complex update actions and compare resulting tracing", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
  const trees = createTreeMapFromTreeArray(generateDummyTrees(5, 5));
  const treeGroups = [
    {
      groupId: 1,
      name: "Axon 1",
      children: [
        {
          groupId: 3,
          name: "Blah",
          children: [],
        },
        {
          groupId: 4,
          name: "Blah 2",
          children: [],
        },
      ],
    },
  ];
  const createTreesUpdateActions = Array.from(diffTrees({}, trees));
  const updateTreeGroupsUpdateAction = UpdateActions.updateTreeGroups(treeGroups);
  const [saveQueue] = addVersionNumbers(
    createSaveQueueFromUpdateActions(
      [createTreesUpdateActions, [updateTreeGroupsUpdateAction]],
      123456789,
    ),
    0,
  );
  await sendUpdateActionsForSkeleton(createdExplorational, saveQueue);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  t.snapshot(replaceVolatileValues(tracings[0]), {
    id: "annotations-complexUpdateActions",
  });
});
