// @flow
/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// This needs to be the very first import
import {
  createSnapshotable,
  debugWrapper,
  waitForAllRequests,
  resetDatabase,
} from "test/enzyme/e2e-setup";
import { Provider } from "react-redux";
import { Router } from "react-router-dom";
import React from "react";
// Has to come after e2e-setup import
import createBrowserHistory from "history/createBrowserHistory";
import { load as loadFeatureToggles } from "features";
import { mount } from "enzyme";
import mockRequire from "mock-require";
import test from "ava";

// Those wrappers interfere with global.window and global.document otherwise
mockRequire("libs/window", global.window);
mockRequire("libs/datasource.schema.json", {});

// The following components cannot be rendered by enzyme. Let's mock them
mockRequire("antd/lib/upload", () => <div />);

// Antd makes use of fancy effects, which is why the rendering output is not reliable.
// Mock these components to avoid this issue.
mockRequire("antd/lib/spin", props => <div className="mock-spinner">{props.children}</div>);
mockRequire("antd/lib/button", props => (
  <div className="mock-button" {...props}>
    {props.children}
  </div>
));

const ProjectListView = mockRequire.reRequire("../../admin/project/project_list_view").default;
const Dashboard = mockRequire.reRequire("../../dashboard/dashboard_view").default;
const UserListView = mockRequire.reRequire("../../admin/user/user_list_view").default;
const Store = mockRequire.reRequire("../../oxalis/throttled_store").default;
const { setActiveUserAction } = mockRequire.reRequire("../../oxalis/model/actions/user_actions");
const { getActiveUser } = mockRequire.reRequire("../../admin/admin_rest_api");
// Cannot be rendered for some reason
// const TracingLayoutView = mockRequire.reRequire("../../oxalis/view/tracing_layout_view").default;

const browserHistory = createBrowserHistory();

test.before(async () => {
  const featureTogglePromise = loadFeatureToggles();
  resetDatabase();
  await featureTogglePromise;
});

test.beforeEach(async _ => {
  // There needs to be an active user in the store for the pages to render correctly
  const user = await getActiveUser();
  Store.dispatch(setActiveUserAction(user));
});

test("Dashboard", async t => {
  const dashboard = mount(
    <Provider store={Store}>
      <Router history={browserHistory}>
        <Dashboard userId={null} isAdminView={false} />
      </Router>
    </Provider>,
  );
  await waitForAllRequests(dashboard);

  t.is(dashboard.find(".TestDatasetHeadline").length, 1);
  debugWrapper(dashboard, "Dashboard-1");
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets" });

  dashboard
    .find(".ant-tabs-tab")
    .at(1)
    .simulate("click");
  await waitForAllRequests(dashboard);

  t.is(dashboard.find(".TestAdvancedDatasetView").length, 1);
  debugWrapper(dashboard, "Dashboard-2");
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets-Advanced" });

  // Active tasks tab
  dashboard
    .find(".ant-tabs-tab")
    .at(2)
    .simulate("click");
  await waitForAllRequests(dashboard);

  t.is(dashboard.find(".TestTasksHeadline").length, 1);
  debugWrapper(dashboard, "Dashboard-3");
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Tasks" });

  // Active explorative annotations tab
  dashboard
    .find(".ant-tabs-tab")
    .at(3)
    .simulate("click");
  await waitForAllRequests(dashboard);

  t.is(dashboard.find(".TestExplorativeAnnotationsView").length, 1);
  debugWrapper(dashboard, "Dashboard-4");
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Explorative-Annotations" });
});

test("Users", async t => {
  const userListView = mount(
    <Provider store={Store}>
      <Router history={browserHistory}>
        <UserListView />
      </Router>
    </Provider>,
  );
  await waitForAllRequests(userListView);

  debugWrapper(userListView, "UserListView");
  t.snapshot(createSnapshotable(userListView), { id: "UserListView" });
});

test("Projects", async t => {
  const projectListView = mount(
    <Provider store={Store}>
      <Router history={browserHistory}>
        <ProjectListView />
      </Router>
    </Provider>,
  );
  await waitForAllRequests(projectListView);
  t.is(projectListView.find(".TestProjectListView").length, 1);

  debugWrapper(projectListView, "ProjectListView");
  t.snapshot(createSnapshotable(projectListView), { id: "ProjectListView" });
});
