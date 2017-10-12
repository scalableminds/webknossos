// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */

// This needs to be the very first import
import { createSnapshotable, debugWrapper, waitForAllRequests } from "./e2e-setup";
import { mount } from "enzyme";
import test from "ava";
import mockRequire from "mock-require";
import React from "react";

mockRequire("app", {
  currentUser: {
    email: "scmboy@scalableminds.com",
    teams: [{ role: { name: "admin" } }],
  },
});

// The following components cannot be rendered by enzyme. Let's mock them
mockRequire("antd/lib/upload", () => <div />);
mockRequire("c3", () => {});
mockRequire("react-c3js", () => <div />);
mockRequire("brace", {});
mockRequire("brace/mode/javascript", {});
mockRequire("brace/mode/json", {});
mockRequire("brace/theme/clouds", {});
mockRequire("bootstrap-multiselect", {});

// Antd makes use of fancy effects, which is why the rendering output is not reliable.
// Mock these components to avoid this issue.
mockRequire("antd/lib/spin", props => <div className="mock-spinner">{props.children}</div>);
mockRequire("antd/lib/button", props => (
  <div className="mock-button" {...props}>
    {props.children}
  </div>
));

const ProjectListView = mockRequire.reRequire("admin/admin").ProjectListView;
const Dashboard = mockRequire.reRequire("../../dashboard/views/dashboard_view").default;
const UserListView = mockRequire.reRequire("../../admin/views/user/user_list_view").default;
// Cannot be rendered for some reason
// const TracingLayoutView = mockRequire.reRequire("../../oxalis/view/tracing_layout_view").default;

test("Dashboard", async t => {
  const dashboard = mount(<Dashboard userId={null} isAdminView={false} />);
  await waitForAllRequests();
  t.is(dashboard.find(".TestDatasetHeadline").length, 1);

  debugWrapper(dashboard, "Dashboard-1");
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets" });

  dashboard
    .find(".ant-tabs-tab")
    .at(1)
    .simulate("click");
  await waitForAllRequests();

  t.is(dashboard.find(".TestAdvancedDatasetView").length, 1);
  debugWrapper(dashboard, "Dashboard-2");
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets-Advanced" });

  // Active tasks tab
  dashboard
    .find(".ant-tabs-tab")
    .at(2)
    .simulate("click");
  await waitForAllRequests();
  t.is(dashboard.find(".TestTasksHeadline").length, 1);
  debugWrapper(dashboard, "Dashboard-3");
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Tasks" });

  // Active explorative annotations tab
  dashboard
    .find(".ant-tabs-tab")
    .at(3)
    .simulate("click");
  await waitForAllRequests();
  t.is(dashboard.find(".TestExplorativeAnnotationsView").length, 1);
  debugWrapper(dashboard, "Dashboard-4");
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Explorative-Annotations" });
});

test("Users", async t => {
  const userListView = mount(<UserListView />);
  await waitForAllRequests();

  debugWrapper(userListView, "UserListView");
  t.snapshot(createSnapshotable(userListView), { id: "UserListView" });
});

test("Projects", async t => {
  const projectListView = mount(<ProjectListView />);
  await waitForAllRequests();
  t.is(projectListView.find(".TestProjectListView").length, 1);

  debugWrapper(projectListView, "ProjectListView");
  t.snapshot(createSnapshotable(projectListView), { id: "ProjectListView" });
});
