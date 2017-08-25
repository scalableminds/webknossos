// @flow
// This needs to be the very first import
import { createSnapshotable, waitForAllRequests } from "./e2e-setup";
import { mount } from "enzyme";
import test from "ava";
import mockRequire from "mock-require";
import fs from "fs";

import React from "react";

mockRequire("app", {});
const Dashboard = mockRequire.reRequire("../../dashboard/views/dashboard_view").default;

test("Dashboard", async t => {
  const dashboard = mount(<Dashboard userID={null} isAdminView={false} />);
  await waitForAllRequests();
  t.is(dashboard.find(".test-datasetHeadline").length, 1);
  t.snapshot(createSnapshotable(dashboard), { id: "Dashboard-Datasets"});

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
