/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import Request from "libs/request";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

// test("getAnnotationsForTask(taskId: string)", async t => {
//   const aProject = (await api.getProjects())[0];
//   console.log(aProject);
//   // const tasks = await api.getTasks({ project: aProject.name });
//   const tasks = await api.getTasks({ project: "Test_Project" });
//   // Test_Project
//   const aTask = tasks[0];
//   console.log(aTask);
//   // const annotations = await api.getAnnotationsForTask(aTask.id);

//   // t.snapshot(annotations, { id: "tasks-getAnnotationsForTask(taskId: string)" });
// });

// test("deleteTask(taskId: string)", async t => {
//   const users = await api.deleteTask((taskId: string));
//   t.snapshot(users, { id: "tasks-deleteTask(taskId: string)" });
// });

// test("getTasks(queryObject: QueryObjectType )", async t => {
//   const users = await api.getTasks((queryObject: QueryObjectType));
//   t.snapshot(users, { id: "tasks-getTasks(queryObject: QueryObjectType )" });
// });

// test("createTasks(tasks: Array<NewTaskType> )", async t => {
//   const users = await api.createTasks((tasks: Array<NewTaskType>));
//   t.snapshot(users, { id: "tasks-createTasks(tasks: Array<NewTaskType> )" });
// });

// test("createTaskFromNML(task: NewTaskType )", async t => {
//   const users = await api.createTaskFromNML((task: NewTaskType));
//   t.snapshot(users, { id: "tasks-createTaskFromNML(task: NewTaskType )" });
// });

// test("getTask(taskId: string)", async t => {
//   const users = await api.getTask((taskId: string));
//   t.snapshot(users, { id: "tasks-getTask(taskId: string)" });
// });

// test("updateTask(taskId: string, task: NewTaskType)", async t => {
//   const users = await api.updateTask((taskId: string), (task: NewTaskType));
//   t.snapshot(users, { id: "tasks-updateTask(taskId: string, task: NewTaskType)" });
// });
