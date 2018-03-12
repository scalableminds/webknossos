/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import * as api from "admin/admin_rest_api";
import { defaultToken, setCurrToken } from "../enzyme/e2e-setup";

test.before("Change token", async () => {
  setCurrToken(defaultToken);
});

test("Load all datastores", async t => {
  const datastores = await api.getDatastores();
  t.snapshot(datastores, { id: "misc-datastores" });
});

test("Load active user", async t => {
  const activeUser = await api.getActiveUser();
  t.snapshot(activeUser, { id: "misc-activeUser" });
});
