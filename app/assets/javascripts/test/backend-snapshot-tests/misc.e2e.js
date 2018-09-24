/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
// @flow
import test from "ava";
import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeFlowCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";

test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});

test("datastores()", async t => {
  const datastores = await api.getDatastores();
  writeFlowCheckingFile(datastores, "datastore", "APIDataStoreType", { isArray: true });
  t.snapshot(datastores, { id: "misc-datastores" });
});

test("activeUser()", async t => {
  const activeUser = await api.getActiveUser();
  writeFlowCheckingFile(activeUser, "user", "APIUserType");
  t.snapshot(activeUser, { id: "misc-activeUser" });
});

test("getFeatureToggles()", async t => {
  const features = await api.getFeatureToggles();
  writeFlowCheckingFile(features, "feature-toggles", "APIFeatureToggles");
  t.snapshot(features, { id: "misc-getFeatureToggles" });
});
