import _ from "lodash";
import { resetDatabase, replaceVolatileValues, writeTypeCheckingFile } from "test/e2e-setup";
import {
  getTask,
  getTasks,
  peekNextTasks,
  getAnnotationsForTask,
  transferTask,
  deleteTask,
  requestTask,
  createTasks,
  updateTask,
} from "admin/api/tasks";
import { describe, test, beforeAll, expect } from "vitest";
import type { Vector3 } from "oxalis/constants";

describe("Task API  (E2E)", () => {
  beforeAll(async () => {
    resetDatabase();
  });

  test("getTasks()", async () => {
    const allTasks = (await getTasks({})).filter(
      (task) => task.projectName !== "Test_Project3(for_annotation_mutations)",
    );

    writeTypeCheckingFile(allTasks, "task", "APITask", {
      isArray: true,
    });

    expect(allTasks).toMatchSnapshot();

    const complexQueriedTasks = await getTasks({
      taskType: "570b9f4c2a7c0e4c008da6ee",
    });

    expect(complexQueriedTasks.length).toBe(2);
    expect(complexQueriedTasks.map((task) => task.id).sort()).toEqual(
      ["58135c192faeb34c0081c058", "581367a82faeb37a008a5352"].sort(),
    );
    expect(complexQueriedTasks).toMatchSnapshot();
  });

  test("peekNextTasks()", async () => {
    const peekedTasks = await peekNextTasks();
    expect(peekedTasks).toMatchSnapshot();
  });

  test("getTask()", async () => {
    const task = await getTask("58135c192faeb34c0081c058");
    expect(task).toMatchSnapshot();
  });

  test("getAnnotationsForTask()", async () => {
    const annotations = await getAnnotationsForTask("581367a82faeb37a008a5352");
    expect(annotations.length).toBe(1);
    expect(annotations).toMatchSnapshot();
  });

  test("updateTask()", async () => {
    const taskBase = await getTask("58135c192faeb34c0081c058");

    const task = _.omitBy(
      {
        ...taskBase,
        taskTypeId: taskBase.type.id,
        boundingBox: taskBase.boundingBox ? taskBase.boundingBoxVec6 : null,
        scriptId: taskBase.script ? taskBase.script.id : null,
        pendingInstances: taskBase.status.pending,
      },
      _.isNull,
    );

    // @ts-expect-error ts-migrate(2533) FIXME: Object is possibly 'null' or 'undefined'.
    const newTask = { ...task, pendingInstances: task.pendingInstances + 10 };
    // @ts-expect-error ts-migrate(2533) FIXME: Object is possibly 'null' or 'undefined'.
    const updatedTask = await updateTask(task.id, newTask);
    expect(updatedTask.status.pending).toEqual(newTask.pendingInstances);
    expect(updatedTask).toMatchSnapshot();

    // Reset task to original state
    // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | number | string[] | API... Remove this comment to see the full error message
    const revertedTask = await updateTask(task.id, task);
    // @ts-expect-error ts-migrate(2533) FIXME: Object is possibly 'null' or 'undefined'.
    expect(revertedTask.status.pending).toBe(task.status.pending);
  });

  test("transferTask()", async () => {
    const taskAnnotationId = "58135c402faeb34e0081c068";
    const userId = "570b9f4d2a7c0e4d008da6ef";
    const newUserId = "670b9f4d2a7c0e4d008da6ef";

    const transferredAnnotation = await transferTask(taskAnnotationId, newUserId);
    expect(transferredAnnotation.owner?.id).toBe(newUserId);

    const revertedTask = await transferTask(transferredAnnotation.id, userId);
    expect(revertedTask.owner?.id).toBe(userId);
  });

  const newTask = {
    boundingBox: null,
    datasetName: "confocal-multi_knossos",
    datasetDirectoryName: "confocal-multi_knossos",
    datasetId: "59e9cfbdba632ac2ab8b23b3",
    editPosition: [1, 2, 3] as Vector3,
    editRotation: [4, 5, 6] as Vector3,
    neededExperience: {
      domain: "abc",
      value: 1,
    },
    projectName: "Test_Project4",
    scriptId: null,
    pendingInstances: 3,
    taskTypeId: "570b9f4c2a7c0e4c008da6ee",
  };

  test("createTasks() and deleteTask()", async () => {
    const createTaskResponse = await createTasks([newTask]);
    const createdTaskWrappers = createTaskResponse.tasks;

    expect(createdTaskWrappers.length).toBe(1);
    const createdTaskWrapper = createdTaskWrappers[0];

    if (createdTaskWrapper.success != null) {
      const createdTask = createdTaskWrapper.success;
      expect(replaceVolatileValues(createdTask)).toMatchSnapshot();
      await deleteTask(createdTask.id);
    } else {
      expect.fail("Task creation failed.");
    }
  });

  test("requestTask()", async () => {
    const createTaskResponse = await createTasks([newTask]);
    const createdTaskWrappers = createTaskResponse.tasks;

    expect(createdTaskWrappers.length).toBe(1);

    const createdTaskWrapper = createdTaskWrappers[0];
    const newTaskAnnotation = await requestTask();

    writeTypeCheckingFile(newTaskAnnotation, "annotation-with-task", "APIAnnotationWithTask");

    expect(replaceVolatileValues(newTaskAnnotation)).toMatchSnapshot();

    if (createdTaskWrapper.success != null) {
      await deleteTask(createdTaskWrapper.success.id);
    } else {
      expect.fail("Task creation failed.");
    }
  });
});
