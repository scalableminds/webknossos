/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// @flow
import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeFlowCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";

test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});

test("datastores()", async t => {
  const datastores = await api.getDatastores();
  writeFlowCheckingFile(datastores, "datastore", "APIDataStore", { isArray: true });
  t.snapshot(datastores, { id: "misc-datastores" });
});

test("activeUser()", async t => {
  const activeUser = await api.getActiveUser();
  writeFlowCheckingFile(activeUser, "user", "APIUser");
  t.snapshot(activeUser, { id: "misc-activeUser" });
});

test("getFeatureToggles()", async t => {
  const features = await api.getFeatureToggles();
  writeFlowCheckingFile(features, "feature-toggles", "APIFeatureToggles");
  t.snapshot(features, { id: "misc-getFeatureToggles" });
});
