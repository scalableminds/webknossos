import _ from "lodash";
import { resetDatabase, replaceVolatileValues, writeTypeCheckingFile } from "test/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";
test.before("Reset database", async () => {
  resetDatabase();
});
test("getTasks()", async (t) => {
  const allTasks = (await api.getTasks({})).filter(
    (task) => task.projectName !== "Test_Project3(for_annotation_mutations)",
  );
  writeTypeCheckingFile(allTasks, "task", "APITask", {
    isArray: true,
  });
  t.snapshot(allTasks);
  const complexQueriedTasks = await api.getTasks({
    taskType: "570b9f4c2a7c0e4c008da6ee",
  });
  t.is(complexQueriedTasks.length, 2);
  t.deepEqual(
    complexQueriedTasks.map((task) => task.id).sort(),
    ["58135c192faeb34c0081c058", "581367a82faeb37a008a5352"].sort(),
  );
  t.snapshot(complexQueriedTasks);
});
test("peekNextTasks()", async (t) => {
  const peekedTasks = await api.peekNextTasks();
  t.snapshot(peekedTasks);
});
test("getTask()", async (t) => {
  const task = await api.getTask("58135c192faeb34c0081c058");
  t.snapshot(task);
});
test("getAnnotationsForTask()", async (t) => {
  const annotations = await api.getAnnotationsForTask("581367a82faeb37a008a5352");
  t.is(annotations.length, 1);
  t.snapshot(annotations);
});
test.serial("updateTask()", async (t) => {
  const taskBase = await api.getTask("58135c192faeb34c0081c058");

  const task = _.omitBy(
    Object.assign({}, taskBase, {
      taskTypeId: taskBase.type.id,
      boundingBox: taskBase.boundingBox ? taskBase.boundingBoxVec6 : null,
      scriptId: taskBase.script ? taskBase.script.id : null,
      pendingInstances: taskBase.status.pending,
    }),
    _.isNull,
  );

  // @ts-expect-error ts-migrate(2533) FIXME: Object is possibly 'null' or 'undefined'.
  const newTask = { ...task, pendingInstances: task.pendingInstances + 10 };
  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | number | string[] | API... Remove this comment to see the full error message
  const updatedTask = await api.updateTask(task.id, newTask);
  t.deepEqual(updatedTask.status.pending, newTask.pendingInstances);
  t.snapshot(updatedTask);
  // Reset task to original state
  // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'string | number | string[] | API... Remove this comment to see the full error message
  const revertedTask = await api.updateTask(task.id, task);
  // @ts-expect-error ts-migrate(2533) FIXME: Object is possibly 'null' or 'undefined'.
  t.is(revertedTask.status.pending, task.status.pending);
});
test.serial("transferTask()", async (t) => {
  const taskAnnotationId = "58135c402faeb34e0081c068";
  const userId = "570b9f4d2a7c0e4d008da6ef";
  const newUserId = "670b9f4d2a7c0e4d008da6ef";
  const transferredAnnotation = await api.transferTask(taskAnnotationId, newUserId);
  t.is(transferredAnnotation.owner?.id, newUserId);
  const revertedTask = await api.transferTask(transferredAnnotation.id, userId);
  t.is(revertedTask.owner?.id, userId);
});
const newTask = {
  boundingBox: null,
  dataSet: "confocal-multi_knossos",
  editPosition: [1, 2, 3],
  editRotation: [4, 5, 6],
  neededExperience: {
    domain: "abc",
    value: 1,
  },
  projectName: "Test_Project4",
  scriptId: null,
  pendingInstances: 3,
  taskTypeId: "570b9f4c2a7c0e4c008da6ee",
};
test.serial("createTasks() and deleteTask()", async (t) => {
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ boundingBox: null; dataSet: string; editPo... Remove this comment to see the full error message
  const createTaskResponse = await api.createTasks([newTask]);
  const createdTaskWrappers = createTaskResponse.tasks;
  t.is(createdTaskWrappers.length, 1);
  const createdTaskWrapper = createdTaskWrappers[0];

  if (createdTaskWrapper.success != null) {
    const createdTask = createdTaskWrapper.success;
    t.snapshot(replaceVolatileValues(createdTask));
    await api.deleteTask(createdTask.id);
  } else {
    t.fail("Task creation failed.");
  }

  t.true(true);
});
test.serial("requestTask()", async (t) => {
  // @ts-expect-error ts-migrate(2322) FIXME: Type '{ boundingBox: null; dataSet: string; editPo... Remove this comment to see the full error message
  const createTaskResponse = await api.createTasks([newTask]);
  const createdTaskWrappers = createTaskResponse.tasks;
  t.is(createdTaskWrappers.length, 1);
  const createdTaskWrapper = createdTaskWrappers[0];
  const newTaskAnnotation = await api.requestTask();
  writeTypeCheckingFile(newTaskAnnotation, "annotation-with-task", "APIAnnotationWithTask");
  t.snapshot(replaceVolatileValues(newTaskAnnotation));

  if (createdTaskWrapper.success != null) {
    await api.deleteTask(createdTaskWrapper.success.id);
  } else {
    t.fail("Task creation failed.");
  }

  t.true(true);
}); // test.serial("createTaskFromNML")
