/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { tokenUser_A, setCurrToken } from "../enzyme/e2e-setup";
import test from "ava";
import * as api from "admin/admin_rest_api";

test.before("Change token", async () => {
  setCurrToken(tokenUser_A);
});

test("Load all datastores", async t => {
  const datastores = await api.getDatastores();
  t.snapshot(datastores, { id: "misc-datastores" });
});

test("Load active user", async t => {
  const activeUser = await api.getActiveUser();
  t.snapshot(activeUser, { id: "misc-activeUser" });
});
