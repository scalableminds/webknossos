import {
  resetDatabase,
  replaceVolatileValues,
  setUserAuthToken,
  tokenUserA,
  writeTypeCheckingFile,
} from "test/e2e-setup";
import type { APIAnnotation } from "types/api_flow_types";
import { AnnotationLayerEnum, APIAnnotationTypeEnum } from "types/api_flow_types";
import { createTreeMapFromTreeArray } from "oxalis/model/reducers/skeletontracing_reducer_helpers";
import { diffTrees } from "oxalis/model/sagas/skeletontracing_saga";
import { getNullableSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getServerVolumeTracings } from "oxalis/model/accessors/volumetracing_accessor";
import { sendRequestWithToken, addVersionNumbers } from "oxalis/model/sagas/save_saga";
import * as UpdateActions from "oxalis/model/sagas/update_actions";
import * as api from "admin/admin_rest_api";
import generateDummyTrees from "oxalis/model/helpers/generate_dummy_trees";
import { describe, it, beforeAll, expect } from "vitest";
import { createSaveQueueFromUpdateActions } from "../helpers/saveHelpers";
import type { SaveQueueEntry } from "oxalis/store";

const datasetId = "59e9cfbdba632ac2ab8b23b3";

process.on("unhandledRejection", (err, promise) => {
  console.error("Unhandled rejection (promise: ", promise, ", reason: ", err, ").");
});

describe("Annotation API (E2E)", () => {
  // Reset database
  beforeAll(async () => {
    resetDatabase();
    setUserAuthToken(tokenUserA);
  });

  it("getAnnotationInformation()", async () => {
    const annotationId = "570ba0092a7c0e980056fe9b";
    const annotation = await api.getUnversionedAnnotationInformation(annotationId);
    expect(annotation.id).toBe(annotationId);

    writeTypeCheckingFile(annotation, "annotation", "APIAnnotation");

    expect(annotation).toMatchSnapshot();
  });

  it("getAnnotationInformation() for public annotation while logged out", async () => {
    setUserAuthToken("invalidToken");
    const annotationId = "88135c192faeb34c0081c05d";
    const annotation = await api.getUnversionedAnnotationInformation(annotationId);

    expect(annotation.id).toBe(annotationId);
    expect(annotation).toMatchSnapshot();
    setUserAuthToken(tokenUserA);
  });

  it("getReadableAnnotations()", async () => {
    const annotations = await api.getReadableAnnotations(false, 0);
    expect(replaceVolatileValues(annotations)).toMatchSnapshot();
  });

  it("finishAnnotation() and reOpenAnnotation() for task", async () => {
    const annotationId = "78135c192faeb34c0081c05d";
    const finishedAnnotation = await api.finishAnnotation(annotationId, APIAnnotationTypeEnum.Task);

    expect(finishedAnnotation.state).toBe("Finished");
    expect(replaceVolatileValues(finishedAnnotation)).toMatchSnapshot();

    const reopenedAnnotation = await api.reOpenAnnotation(annotationId, APIAnnotationTypeEnum.Task);
    expect(reopenedAnnotation.state).toBe("Active");
    expect(replaceVolatileValues(reopenedAnnotation)).toMatchSnapshot();
  });

  it("finishAnnotation() and reOpenAnnotation() for explorational", async () => {
    const annotationId = "68135c192faeb34c0081c05d";
    const finishedAnnotation = await api.finishAnnotation(
      annotationId,
      APIAnnotationTypeEnum.Explorational,
    );
    expect(finishedAnnotation.state).toBe("Finished");
    expect(replaceVolatileValues(finishedAnnotation)).toMatchSnapshot();

    const reopenedAnnotation = await api.reOpenAnnotation(
      annotationId,
      APIAnnotationTypeEnum.Explorational,
    );
    expect(reopenedAnnotation.state).toBe("Active");
    expect(replaceVolatileValues(reopenedAnnotation)).toMatchSnapshot();
  });

  it("editAnnotation()", async () => {
    const annotationId = "68135c192faeb34c0081c05d";
    const originalAnnotation = await api.getUnversionedAnnotationInformation(annotationId);
    const { visibility } = originalAnnotation;
    const newName = "new name";
    const newVisibility = "Public";
    await api.editAnnotation(annotationId, APIAnnotationTypeEnum.Explorational, {
      visibility: newVisibility,
      name: newName,
    });
    const editedAnnotation = await api.getUnversionedAnnotationInformation(annotationId);
    expect(editedAnnotation.name).toBe(newName);
    expect(editedAnnotation.visibility).toBe(newVisibility);
    expect(editedAnnotation.id).toBe(annotationId);
    expect(editedAnnotation.annotationLayers[0].typ).toBe(AnnotationLayerEnum.Skeleton);
    expect(editedAnnotation.annotationLayers[0].tracingId).toBe(
      "ae417175-f7bb-4a34-8187-d9c3b50143af",
    );
    expect(replaceVolatileValues(editedAnnotation)).toMatchSnapshot();

    await api.editAnnotation(annotationId, APIAnnotationTypeEnum.Explorational, {
      visibility,
    });
  });

  it("finishAllAnnotations()", async () => {
    const annotationIds = ["78135c192faeb34c0081c05d", "78135c192faeb34c0081c05e"];
    await api.finishAllAnnotations(annotationIds);

    const finishedAnnotations = await Promise.all(
      annotationIds.map((id) => api.getUnversionedAnnotationInformation(id)),
    );
    expect(finishedAnnotations.length).toBe(2);

    finishedAnnotations.forEach((annotation) => {
      expect(annotation.state).toBe("Finished");
    });
    await Promise.all(
      annotationIds.map((id) => api.reOpenAnnotation(id, APIAnnotationTypeEnum.Task)),
    );
  });

  it("createExplorational() and finishAnnotation()", async () => {
    const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
    expect(replaceVolatileValues(createdExplorational)).toMatchSnapshot();

    await api.finishAnnotation(createdExplorational.id, APIAnnotationTypeEnum.Explorational);
    const finishedAnnotation = await api.getUnversionedAnnotationInformation(
      createdExplorational.id,
    );
    expect(finishedAnnotation.state).toBe("Finished");
  });

  it("getTracingsForAnnotation()", async () => {
    const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
    const tracings = await api.getTracingsForAnnotation(createdExplorational);

    writeTypeCheckingFile(tracings[0], "tracing", "ServerSkeletonTracing");

    expect(replaceVolatileValues(tracings[0])).toMatchSnapshot();
  });

  it("getTracingsForAnnotation() for volume", async () => {
    const createdExplorational = await api.createExplorational(datasetId, "volume", false, null);
    const tracings = await api.getTracingsForAnnotation(createdExplorational);

    writeTypeCheckingFile(tracings[0], "tracing-volume", "ServerVolumeTracing");

    expect(replaceVolatileValues(tracings[0])).toMatchSnapshot();
  });

  it("getTracingsForAnnotation() for hybrid", async () => {
    const createdExplorational = await api.createExplorational(datasetId, "hybrid", false, null);
    const tracings = await api.getTracingsForAnnotation(createdExplorational);

    writeTypeCheckingFile(tracings, "tracing-hybrid", "ServerTracing", {
      isArray: true,
    });

    // The volatileValues list includes "skeleton" and "volume", because of other requests, so we need to do it like this
    expect({
      skeleton: replaceVolatileValues(getNullableSkeletonTracing(tracings)),
      volume: replaceVolatileValues(getServerVolumeTracings(tracings)[0]),
    }).toMatchSnapshot();
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

  it("Send update actions and compare resulting tracing", async () => {
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
    expect(replaceVolatileValues(tracings[0])).toMatchSnapshot();
  });

  it("Send complex update actions and compare resulting tracing", async () => {
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

    expect(replaceVolatileValues(tracings[0])).toMatchSnapshot();
  });

  it("Update Metadata for Skeleton Tracing", async () => {
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
    expect(replaceVolatileValues(tracings[0])).toMatchSnapshot();
  });

  it("Send update actions for updating metadata", async () => {
    const createdExplorational = await api.createExplorational(datasetId, "skeleton", false, null);
    const newDescription = "new description";
    const [saveQueue] = addVersionNumbers(
      createSaveQueueFromUpdateActions(
        [[UpdateActions.updateMetadataOfAnnotation(newDescription)]],
        123456789,
      ),
      0,
    );
    await sendUpdateActions(createdExplorational, saveQueue);

    const annotation = await api.getAnnotationProto(
      createdExplorational.tracingStore.url,
      createdExplorational.id,
    );
    expect(annotation.description).toBe(newDescription);
  });
});
