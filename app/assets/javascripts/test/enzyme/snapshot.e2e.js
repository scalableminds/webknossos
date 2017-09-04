// @flow
/* eslint-disable import/first */
// This needs to be the very first import
import { createSnapshotable, waitForAllRequests, wait } from "./e2e-setup";
import { mount } from "enzyme";
import test from "ava";
import mockRequire from "mock-require";
import React from "react";
// const ControlModeEnum = require("../../oxalis/constants").ControlModeEnum;

// The upload component cannot be rendered by enzyme for some reason
mockRequire("antd/lib/upload", () => <div />);
mockRequire("c3", () => {});
mockRequire("react-c3js", () => <div />);
mockRequire("app", {});
mockRequire("brace", {});
mockRequire("brace/mode/javascript", {});
mockRequire("brace/mode/json", {});
mockRequire("brace/theme/clouds", {});
mockRequire("bootstrap-multiselect", {});

const ProjectListView = mockRequire.reRequire("admin/admin").ProjectListView;
const Dashboard = mockRequire.reRequire("../../dashboard/views/dashboard_view").default;
const UserListView = mockRequire.reRequire("../../admin/views/user/user_list_view").default;
// const TracingLayoutView = mockRequire.reRequire("../../oxalis/view/tracing_layout_view").default;

test("Dashboard", async t => {
  const dashboard = mount(<Dashboard userID={null} isAdminView={false} />);
  await waitForAllRequests();
  t.is(dashboard.find(".test-datasetHeadline").length, 1);
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets" });

  dashboard
    .find(".test-showAdvancedView")
    .at(0)
    .simulate("click");
  await waitForAllRequests();
  t.is(dashboard.find(".test-AdvancedDatasetView").length, 1);
  // antd waits for 500ms to make fancy effects
  await wait(500);
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets-Advanced" });

  // Active tasks tab
  dashboard
    .find(".ant-tabs-tab")
    .at(1)
    .simulate("click");
  await waitForAllRequests();
  t.is(dashboard.find(".test-tasksHeadline").length, 1);
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Tasks" });

  // Active explorative annotations tab
  dashboard
    .find(".ant-tabs-tab")
    .at(2)
    .simulate("click");
  await waitForAllRequests();
  t.is(dashboard.find(".test-explorative-annotations-view").length, 1);
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Explorative-Annotations" });
});

test("Users", async t => {
  const userListView = mount(<UserListView />);
  await waitForAllRequests();
  t.is(userListView.find(".test-UserListView").length, 1);
  t.snapshot(createSnapshotable(userListView), { id: "UserListView" });
});

test("Projects", async t => {
  const projectListView = mount(<ProjectListView />);
  await waitForAllRequests();
  t.is(projectListView.find(".test-ProjectListView").length, 1);
  t.snapshot(createSnapshotable(projectListView), { id: "ProjectListView" });
});
