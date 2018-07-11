/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// @flow
import test from "ava";
import { tokenUserA, setCurrToken, resetDatabase } from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";

test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});

test("datastores()", async t => {
  const datastores = await api.getDatastores();
  t.snapshot(datastores, { id: "misc-datastores" });
});

test("activeUser()", async t => {
  const activeUser = await api.getActiveUser();
  t.snapshot(activeUser, { id: "misc-activeUser" });
});

test("getFeatureToggles()", async t => {
  const features = await api.getFeatureToggles();
  t.snapshot(features, { id: "misc-getFeatureToggles" });
});
