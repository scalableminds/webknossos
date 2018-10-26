/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// @flow
import test from "ava";
import {
  resetDatabase,
  replaceVolatileValues,
  setCurrToken,
  tokenUserA,
  writeFlowCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import { APITracingTypeEnum } from "admin/api_flow_types";
import { sendRequestWithToken, addVersionNumbers } from "oxalis/model/sagas/save_saga";
import * as UpdateActions from "oxalis/model/sagas/update_actions";
import generateDummyTrees from "oxalis/model/helpers/generate_dummy_trees";
import { diffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import { createTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";

const dataSetId = { name: "confocal-multi_knossos", owningOrganization: "Organization_X" };

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});

test.before("Reset database", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});

test("getAnnotationInformation()", async t => {
  const annotationId = "570b9ff12a7c0e980056fe8f";
  const annotation = await api.getAnnotationInformation(
    annotationId,
    APITracingTypeEnum.Explorational,
  );
  t.is(annotation.id, annotationId);
  writeFlowCheckingFile(annotation, "annotation", "APIAnnotation");
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
  const createdExplorational = await api.createExplorational(dataSetId, "skeleton", false);

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

test("getTracingForAnnotations()", async t => {
  const createdExplorational = await api.createExplorational(dataSetId, "skeleton", false);

  const tracing = await api.getTracingForAnnotations(createdExplorational);
  writeFlowCheckingFile(tracing, "tracing", "HybridServerTracing");
  t.snapshot(replaceVolatileValues(tracing.skeleton), {
    id: "annotations-tracing",
  });
});

async function sendUpdateActions(explorational, queue) {
  const skeletonTracingId = explorational.tracing.skeleton;
  if (skeletonTracingId == null) throw new Error("No skeleton tracing present.");
  return sendRequestWithToken(
    `${explorational.tracingStore.url}/tracings/skeleton/${skeletonTracingId}/update?token=`,
    {
      method: "POST",
      headers: { "X-Date": "123456789" },
      data: queue,
      compress: false,
    },
  );
}

test("Send update actions and compare resulting tracing", async t => {
  const createdExplorational = await api.createExplorational(dataSetId, "skeleton", false);

  const initialSkeleton = { activeNodeId: undefined, userBoundingBox: undefined };
  const saveQueue = addVersionNumbers(
    createSaveQueueFromUpdateActions(
      [
        UpdateActions.updateSkeletonTracing(initialSkeleton, [1, 2, 3], [0, 1, 2], 1),
        UpdateActions.updateSkeletonTracing(initialSkeleton, [2, 3, 4], [1, 2, 3], 2),
      ],
      123456789,
    ),
    0,
  );
  await sendUpdateActions(createdExplorational, saveQueue);
  const tracing = await api.getTracingForAnnotations(createdExplorational);
  t.snapshot(replaceVolatileValues(tracing.skeleton), {
    id: "annotations-updateActions",
  });
});

test("Send complex update actions and compare resulting tracing", async t => {
  const createdExplorational = await api.createExplorational(dataSetId, "skeleton", false);

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

  const saveQueue = addVersionNumbers(
    createSaveQueueFromUpdateActions(
      [createTreesUpdateActions, updateTreeGroupsUpdateAction],
      123456789,
    ),
    0,
  );

  await sendUpdateActions(createdExplorational, saveQueue);
  const tracing = await api.getTracingForAnnotations(createdExplorational);
  t.snapshot(replaceVolatileValues(tracing.skeleton), {
    id: "annotations-complexUpdateActions",
  });
});
