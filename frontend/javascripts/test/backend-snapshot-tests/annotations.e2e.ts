import {
  resetDatabase,
  replaceVolatileValues,
  setCurrToken,
  tokenUserA,
  writeTypeCheckingFile,
} from "test/e2e-setup";
import type { APIAnnotation } from "types/api_flow_types";
import { AnnotationLayerType, APIAnnotationTypeEnum } from "types/api_flow_types";
import { createTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { diffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import { getNullableSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getServerVolumeTracings } from "oxalis/model/accessors/volumetracing_accessor";
import { sendRequestWithToken, addVersionNumbers } from "oxalis/model/sagas/save_saga";
import * as UpdateActions from "oxalis/model/sagas/update_actions";
import * as api from "admin/admin_rest_api";
import generateDummyTrees from "oxalis/model/helpers/generate_dummy_trees";
import test from "ava";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import type { SaveQueueEntry } from "oxalis/store";

const datasetId = "59e9cfbdba632ac2ab8b23b3";

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});
test.before("Reset database", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});
test("getAnnotationInformation()", async (t) => {
  const annotationId = "570ba0092a7c0e980056fe9b";
  const annotation = await api.getMaybeOutdatedAnnotationInformation(annotationId);
  t.is(annotation.id, annotationId);
  writeTypeCheckingFile(annotation, "annotation", "APIAnnotation");
  t.snapshot(annotation);
});
test("getAnnotationInformation() for public annotation while logged out", async (t) => {
  setCurrToken("invalidToken");
  const annotationId = "88135c192faeb34c0081c05d";
  const annotation = await api.getMaybeOutdatedAnnotationInformation(annotationId);
  t.is(annotation.id, annotationId);
  t.snapshot(annotation);
  setCurrToken(tokenUserA);
});
test.serial("getReadableAnnotations()", async (t) => {
  const annotations = await api.getReadableAnnotations(false, 0);
  t.snapshot(replaceVolatileValues(annotations));
});
test.serial("finishAnnotation() and reOpenAnnotation() for task", async (t) => {
  const annotationId = "78135c192faeb34c0081c05d";
  const finishedAnnotation = await api.finishAnnotation(annotationId, APIAnnotationTypeEnum.Task);
  t.is(finishedAnnotation.state, "Finished");
  t.snapshot(replaceVolatileValues(finishedAnnotation));
  const reopenedAnnotation = await api.reOpenAnnotation(annotationId, APIAnnotationTypeEnum.Task);
  t.is(reopenedAnnotation.state, "Active");
  t.snapshot(replaceVolatileValues(reopenedAnnotation));
});
test.serial("finishAnnotation() and reOpenAnnotation() for explorational", async (t) => {
  const annotationId = "68135c192faeb34c0081c05d";
  const finishedAnnotation = await api.finishAnnotation(
    annotationId,
    APIAnnotationTypeEnum.Explorational,
  );
  t.is(finishedAnnotation.state, "Finished");
  t.snapshot(replaceVolatileValues(finishedAnnotation));
  const reopenedAnnotation = await api.reOpenAnnotation(
    annotationId,
    APIAnnotationTypeEnum.Explorational,
  );
  t.is(reopenedAnnotation.state, "Active");
  t.snapshot(replaceVolatileValues(reopenedAnnotation));
});
test.serial("editAnnotation()", async (t) => {
  const annotationId = "68135c192faeb34c0081c05d";
  const originalAnnotation = await api.getMaybeOutdatedAnnotationInformation(annotationId);
  const { visibility } = originalAnnotation;
  const newName = "new name";
  const newVisibility = "Public";
  await api.editAnnotation(annotationId, APIAnnotationTypeEnum.Explorational, {
    visibility: newVisibility,
    name: newName,
  });
  const editedAnnotation = await api.getMaybeOutdatedAnnotationInformation(annotationId);
  t.is(editedAnnotation.name, newName);
  t.is(editedAnnotation.visibility, newVisibility);
  t.is(editedAnnotation.id, annotationId);
  t.is(editedAnnotation.annotationLayers[0].typ, AnnotationLayerType.Skeleton);
  t.is(editedAnnotation.annotationLayers[0].tracingId, "ae417175-f7bb-4a34-8187-d9c3b50143af");
  t.snapshot(replaceVolatileValues(editedAnnotation));
  await api.editAnnotation(annotationId, APIAnnotationTypeEnum.Explorational, {
    visibility,
  });
});
test.serial("finishAllAnnotations()", async (t) => {
  const annotationIds = ["78135c192faeb34c0081c05d", "78135c192faeb34c0081c05e"];
  await api.finishAllAnnotations(annotationIds);
  const finishedAnnotations = await Promise.all(
    annotationIds.map((id) => api.getMaybeOutdatedAnnotationInformation(id)),
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
  t.snapshot(replaceVolatileValues(createdExplorational));
  await api.finishAnnotation(createdExplorational.id, APIAnnotationTypeEnum.Explorational);
  const finishedAnnotation = await api.getMaybeOutdatedAnnotationInformation(
    createdExplorational.id,
  );
  t.is(finishedAnnotation.state, "Finished");
});
test.serial("getTracingsForAnnotation()", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  writeTypeCheckingFile(tracings[0], "tracing", "ServerSkeletonTracing");
  t.snapshot(replaceVolatileValues(tracings[0]));
});
test.serial("getTracingsForAnnotation() for volume", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "volume", false, null);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  writeTypeCheckingFile(tracings[0], "tracing-volume", "ServerVolumeTracing");
  t.snapshot(replaceVolatileValues(tracings[0]));
});
test.serial("getTracingsForAnnotation() for hybrid", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "hybrid", false, null);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  writeTypeCheckingFile(tracings, "tracing-hybrid", "ServerTracing", {
    isArray: true,
  });
  // The volatileValues list includes "skeleton" and "volume", because of other requests, so we need to do it like this
  t.snapshot({
    skeleton: replaceVolatileValues(getNullableSkeletonTracing(tracings)),
    volume: replaceVolatileValues(getServerVolumeTracings(tracings)[0]),
  });
});

async function sendUpdateActions(explorational: APIAnnotation, queue: SaveQueueEntry[]) {
  return sendRequestWithToken(
    `${explorational.tracingStore.url}/tracings/annotation/${explorational.id}/update?token=`,
    {
      method: "POST",
      data: queue,
      compress: false,
    },
  );
}

// TODOp: Add tests for new update actions added in this pr (including updateAnnotationMetadata as this part of testing was removed editAnnotation() test case)

test.serial("Send update actions and compare resulting tracing", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
  const tracingId = createdExplorational.annotationLayers[0].tracingId;
  const initialSkeleton = {
    activeNodeId: undefined,
    userBoundingBoxes: [],
    tracingId,
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
  await sendUpdateActions(createdExplorational, saveQueue);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  t.snapshot(replaceVolatileValues(tracings[0]));
});
test("Send complex update actions and compare resulting tracing", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
  const { tracingId } = createdExplorational.annotationLayers[0];
  const trees = createTreeMapFromTreeArray(generateDummyTrees(5, 6));
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
  const createTreesUpdateActions = Array.from(diffTrees(tracingId, {}, trees));
  const updateTreeGroupsUpdateAction = UpdateActions.updateTreeGroups(treeGroups, tracingId);
  const [saveQueue] = addVersionNumbers(
    createSaveQueueFromUpdateActions(
      [createTreesUpdateActions, [updateTreeGroupsUpdateAction]],
      123456789,
    ),
    0,
  );
  await sendUpdateActions(createdExplorational, saveQueue);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  writeTypeCheckingFile(tracings[0], "tracing", "ServerSkeletonTracing");
  t.snapshot(replaceVolatileValues(tracings[0]));
});

test("Update Metadata for Skeleton Tracing", async (t) => {
  const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
  const { tracingId } = createdExplorational.annotationLayers[0];
  const trees = createTreeMapFromTreeArray(generateDummyTrees(5, 6));
  const createTreesUpdateActions = Array.from(diffTrees(tracingId, {}, trees));
  const metadata = [
    {
      key: "city",
      stringValue: "springfield",
    },
    {
      key: "zip",
      numberValue: 12345,
    },
    {
      key: "tags",
      stringListValue: ["tagA", "tagB"],
    },
  ];
  trees[1] = {
    ...trees[1],
    metadata,
  };

  const updateTreeAction = UpdateActions.updateTree(trees[1], tracingId);
  const [saveQueue] = addVersionNumbers(
    createSaveQueueFromUpdateActions([createTreesUpdateActions, [updateTreeAction]], 123456789),
    0,
  );

  await sendUpdateActions(createdExplorational, saveQueue);
  const tracings = await api.getTracingsForAnnotation(createdExplorational);
  t.snapshot(replaceVolatileValues(tracings[0]));
});
