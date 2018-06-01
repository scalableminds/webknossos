/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { tokenUserA, setCurrToken } from "../enzyme/e2e-setup";
import test from "ava";
import * as api from "admin/admin_rest_api";
import _ from "lodash";

test("getTasks()", async t => {
  const tasks = await api.getTasks({});
  t.snapshot(tasks, { id: "tasks-getTasks" });
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
  const annotation = await api.getAnnotationsForTask("58135c192faeb34c0081c058");
  t.snapshot(annotation, { id: "tasks-getAnnotationsForTask" });
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

  const newEditPosition = [1, 2, 3];
  const newTask = {
    ...task,
    editPosition: newEditPosition,
  };

  console.log("task", task);
  console.log("newTask", newTask);
  const updatedTask = await api.updateTask(task.id, newTask);
  console.log("updatedTask", updatedTask);

  // fails to update the editPosition?
  t.deepEqual(updatedTask.editPosition, newEditPosition);

  t.snapshot(updatedTask, { id: "tasks-updatedTask" });

  const revertedTask = await api.updateTask(updatedTask.id, task);
  t.deepEqual(task, revertedTask);
});

test.serial("createTasks() and deleteTask()", async t => {
  // Fails with:
  // 2018-06-01 15:30:00,508 - [DEBUG] models.binary.WKStoreHandlingStrategy - Called to save SkeletonTracings. Base: confocal-multi_knossos Datastore: DataStoreInfo(localhost,http://localhost:9000,WebKnossosStore,None)
  // 2018-06-01 15:30:00,532 - [DEBUG] com.scalableminds.util.rpc.RPCRequest - Sending WS request to http://localhost:9000/data/tracings/skeleton/saveMultiple (ID: 0). RequestBody: '
  // ￁
  // confocal-multi_knossos; (08@H￡ￒﾩￜﾻ,"$  '
  // 2018-06-01 15:30:00,564 - [ERROR] com.scalableminds.util.rpc.RPCRequest - Unsuccessful WS request to http://localhost:9000/data/tracings/skeleton/saveMultiple (ID: 0).Status: 404. Response:

  // <!DOCTYPE html>
  // <html lang="en">
  //     <head>
  //         <title>Action not found</title>
  //         <link
  const newTask = {
    dataSet: "confocal-multi_knossos",
    editPosition: [0, 0, 0],
    editRotation: [0, 0, 0],
    neededExperience: {
      domain: "abc",
      value: 1,
    },
    projectName: "Test_Project",
    openInstances: 3,
    teamName: "570b9f4b2a7c0e3b008da6ec",
    taskTypeId: "570b9f4c2a7c0e4c008da6ee",
  };
  const createdTasks = await api.createTasks([newTask]);
  console.log("createdTasks", createdTasks);
  t.snapshot(createdTasks, { id: "task-createTasks" });

  // todo: taskcreationresponsetype should include an id!
  await api.deleteTask(createdTasks[0].id);
  t.true(true);
});

test.serial("requestTask() and transferTask()", async t => {
  // Fails with:
  // {
  //    messages: [
  //      {
  //        error: 'Failed to use annotation base as template.',
  //      },
  //      {
  //        chain: ' <~ Failed to create tracing from base <~ Could not convert to usable DataSource',
  //      },
  //    ],
  //    status: 400,
  //  }
  const newTaskAnnotation = await api.requestTask();
  t.snapshot(newTaskAnnotation, { id: "task-requestTask" });

  const currentTaskOwnerId = newTaskAnnotation.user.id;
  const userCId = "770b9f4d2a7c0e4d008da6ef";
  const transferredTask = await api.transferTask(newTaskAnnotation.id, userCId);
  t.is(transferredTask.user && transferredTask.user.id, userCId);

  const revertedTask = await api.transferTask(transferredTask.d, currentTaskOwnerId);
  t.is(revertedTask.user && revertedTask.user.id, currentTaskOwnerId);
});

// export async function deleteTask(taskId: string): Promise<void> {
//   return Request.receiveJSON(`/api/tasks/${taskId}`, {
//     method: "DELETE",
//   });
// }

// // TODO fix return types
// export async function createTaskFromNML(
//   task: NewTaskType,
// ): Promise<Array<TaskCreationResponseType>> {
//   return Request.sendMultipartFormReceiveJSON("/api/tasks/createFromFile", {
//     data: {
//       nmlFile: task.nmlFile,
//       formJSON: JSON.stringify(task),
//     },
//   });
// }

// export async function finishTask(annotationId: string): Promise<APIAnnotationType> {
//   return Request.receiveJSON(`/api/annotations/Task/${annotationId}/finish`);
// }
