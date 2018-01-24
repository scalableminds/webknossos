/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import Request from "libs/request";
import _ from "lodash";
import * as api from "admin/admin_rest_api";

test("Load all datastores", async t => {
  const datastores = await api.getDatastores();
  t.snapshot(datastores, { id: "misc-datastores" });
});

test("Load active user", async t => {
  const activeUser = await api.getActiveUser();
  t.snapshot(activeUser, { id: "misc-activeUser" });
});
