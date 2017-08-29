// @flow
// This needs to be the very first import
import { createSnapshotable, waitForAllRequests, wait } from "./e2e-setup";
import { mount } from "enzyme";
import test from "ava";
import mockRequire from "mock-require";
import fs from "fs";
import React from "react";
// const ControlModeEnum = require("../../oxalis/constants").ControlModeEnum;

// The upload component cannot be rendered by enzyme for some reason
mockRequire("antd/lib/upload", () => <div />);
mockRequire("app", {});

const Dashboard = mockRequire.reRequire("../../dashboard/views/dashboard_view").default;
const UserListView = mockRequire.reRequire("../../admin/views/user/user_list_view").default;
// const TracingLayoutView = mockRequire.reRequire("../../oxalis/view/tracing_layout_view").default;

// import Store from "oxalis/store";
// const Store = mockRequire.reRequire("../../oxalis/store").default;
// const rootSaga = mockRequire.reRequire("oxalis/model/sagas/root_saga").default;


test("Dashboard", async t => {
  const dashboard = mount(<Dashboard userID={null} isAdminView={false} />);
  await waitForAllRequests();
  t.is(dashboard.find(".test-datasetHeadline").length, 1);
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets"});

  dashboard.find(".test-showAdvancedView").at(0).simulate("click");
  await waitForAllRequests();
  t.is(dashboard.find(".test-AdvancedDatasetView").length, 1);
  // antd waits for 500ms to make fancy effects
  await wait(500);
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets-Advanced"});

  // Active tasks tab
  dashboard.find(".ant-tabs-tab").at(1).simulate("click");
  await waitForAllRequests();
  t.is(dashboard.find(".test-tasksHeadline").length, 1);
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Tasks"});

  // Active explorative annotations tab
  dashboard.find(".ant-tabs-tab").at(2).simulate("click");
  await waitForAllRequests();
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Explorative-Annotations"});
  t.is(dashboard.find(".test-explorative-annotations-view").length, 1);
});

test("User", async t => {
  const userListView = mount(<UserListView />);
  await waitForAllRequests();
  t.snapshot(createSnapshotable(userListView), { id: "UserListView"});
  t.is(userListView.find(".test-UserListView").length, 1);
});

// test("TracingLayoutView", async t => {
//   const type = "TRACE";
//   const id = "59a0447c5400008f26b5b0ef";

//   const tracingLayoutView = mount(<TracingLayoutView
//     initialTracingType={type}
//     initialTracingId={id}
//     initialControlmode={ControlModeEnum.TRACE}
//   />);
//   await waitForAllRequests();
//   t.snapshot(createSnapshotable(tracingLayoutView), { id: "TracingLayoutView"});
//   t.is(tracingLayoutView.find(".test-TracingLayoutView").length, 1);
// })
