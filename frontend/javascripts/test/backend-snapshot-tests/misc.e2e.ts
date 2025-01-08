import * as api from "admin/admin_rest_api";
import test from "ava";
import {
  replaceVolatileValues,
  resetDatabase,
  setCurrToken,
  tokenUserA,
  writeTypeCheckingFile,
} from "test/e2e-setup";
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
  // replaceVolatileValues should not be needed here since the database is freshly reset
  // and the tests are executed serially. However, for unknown reasons the lastActivity
  // property still varies since ava was upgraded from v3 to v4.
  t.snapshot(replaceVolatileValues(activeUser));
});
test("getFeatureToggles()", async (t) => {
  const features = await api.getFeatureToggles();
  writeTypeCheckingFile(features, "feature-toggles", "APIFeatureToggles");
  t.snapshot(features);
});
