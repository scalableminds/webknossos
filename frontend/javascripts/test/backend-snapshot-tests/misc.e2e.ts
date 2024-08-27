import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeTypeCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";
test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});
test("datastores()", async (t) => {
  const datastores = await api.getDatastores();
  writeTypeCheckingFile(datastores, "datastore", "APIDataStore", {
    isArray: true,
  });
  t.snapshot(datastores);
});
test("activeUser()", async (t) => {
  const activeUser = await api.getActiveUser();
  writeTypeCheckingFile(activeUser, "user", "APIUser");
  t.snapshot(activeUser);
});
test("getFeatureToggles()", async (t) => {
  const features = await api.getFeatureToggles();
  writeTypeCheckingFile(features, "feature-toggles", "APIFeatureToggles");
  t.snapshot(features);
});
