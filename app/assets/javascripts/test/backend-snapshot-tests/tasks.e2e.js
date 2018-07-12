/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { resetDatabase, omitVolatileFields } from "../enzyme/e2e-setup";
import test from "ava";
import * as api from "admin/admin_rest_api";
import _ from "lodash";

test.before("Reset database", async () => {
  resetDatabase();
});

test("getTasks()", async t => {
  const allTasks = (await api.getTasks({})).filter(
    task => task.projectName !== "Test_Project3(for_annotation_mutations)",
  );
  allTasks.forEach(task => {
    // $FlowFixMe: Make tracingTime deterministic
    task.tracingTime = 100;
  });
  t.snapshot(allTasks, { id: "tasks-getTasks" });

  const complexQueriedTasks = await api.getTasks({
    taskType: "570b9f4c2a7c0e4c008da6ee",
  });

  t.is(complexQueriedTasks.length, 2);
  complexQueriedTasks.forEach(task => {
    // $FlowFixMe: Make tracingTime deterministic
    task.tracingTime = 100;
  });
  t.deepEqual(
    complexQueriedTasks.map(task => task.id).sort(),
    ["58135c192faeb34c0081c058", "581367a82faeb37a008a5352"].sort(),
  );

  t.snapshot(complexQueriedTasks, { id: "tasks-getTasks-complex-query" });
});

test("peekNextTasks()", async t => {
  const peekedTasks = await api.peekNextTasks();
  t.snapshot(peekedTasks, { id: "tasks-peekNextTasks" });
});

test("getTask()", async t => {
  const task = await api.getTask("58135c192faeb34c0081c058");
  t.snapshot(task, { id: "tasks-getTask" });
});

test("getAnnotationsForTask()", async t => {
  const annotations = await api.getAnnotationsForTask("581367a82faeb37a008a5352");
  t.is(annotations.length, 1);
  t.snapshot(annotations, { id: "tasks-getAnnotationsForTask" });
});

test.serial("updateTask()", async t => {
  const taskBase = await api.getTask("58135c192faeb34c0081c058");
  const task = _.omitBy(
    Object.assign({}, taskBase, {
      taskTypeId: taskBase.type.id,
      boundingBox: taskBase.boundingBox ? taskBase.boundingBoxVec6 : null,
      scriptId: taskBase.script ? taskBase.script.id : null,
      openInstances: taskBase.status.open,
    }),
    _.isNull,
  );

  const newTask = {
    ...task,
    openInstances: task.openInstances + 10,
  };

  const updatedTask = await api.updateTask(task.id, newTask);

  t.deepEqual(updatedTask.status.open, newTask.openInstances);
  t.snapshot(updatedTask, { id: "tasks-updatedTask" });
});

test.serial("transferTask()", async t => {
  const taskAnnotationId = "58135c402faeb34e0081c068";
  const userId = "570b9f4d2a7c0e4d008da6ef";
  const newUserId = "670b9f4d2a7c0e4d008da6ef";
  const transferredAnnotation = await api.transferTask(taskAnnotationId, newUserId);
  t.is(transferredAnnotation.user && transferredAnnotation.user.id, newUserId);

  const revertedTask = await api.transferTask(transferredAnnotation.id, userId);
  t.is(revertedTask.user && revertedTask.user.id, userId);
});

const newTask = {
  boundingBox: null,
  dataSet: "confocal-multi_knossos",
  editPosition: [0, 0, 0],
  editRotation: [0, 0, 0],
  neededExperience: {
    domain: "abc",
    value: 1,
  },
  projectName: "Test_Project",
  scriptId: null,
  openInstances: 3,
  teamName: "570b9f4b2a7c0e3b008da6ec",
  taskTypeId: "570b9f4c2a7c0e4c008da6ee",
};

test.serial("createTasks() and deleteTask()", async t => {
  const createdTaskWrapper = (await api.createTasks([newTask]))[0];

  t.is(createdTaskWrapper.status, 200);
  const createdTask = createdTaskWrapper.success;

  t.snapshot(omitVolatileFields(createdTask), { id: "task-createTasks" });

  await api.deleteTask(createdTask.id);

  t.true(true);
});

test.serial("requestTask()", async t => {
  const createdTaskWrapper = (await api.createTasks([newTask]))[0];
  const newTaskAnnotation = await api.requestTask();

  t.snapshot(omitVolatileFields(newTaskAnnotation), { id: "task-requestTask" });

  await api.deleteTask(createdTaskWrapper.success.id);

  t.true(true);
});

// test.serial("createTaskFromNML")
