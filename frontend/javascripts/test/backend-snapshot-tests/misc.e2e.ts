import {
  tokenUserA,
  setUserAuthToken,
  replaceVolatileValues,
  resetDatabase,
  writeTypeCheckingFile,
} from "test/e2e-setup";
import * as api from "admin/admin_rest_api";
import { describe, it, beforeAll } from "vitest";

describe("Misc APIs (E2E) ", () => {
  beforeAll(async () => {
    // Reset database and change token
    resetDatabase();
    setUserAuthToken(tokenUserA);
  });

  it("datastores()", async ({ expect }) => {
    const datastores = await api.getDatastores();

    writeTypeCheckingFile(datastores, "datastore", "APIDataStore", {
      isArray: true,
    });

    expect(datastores).toMatchSnapshot();
  });

  it("activeUser()", async ({ expect }) => {
    const activeUser = await api.getActiveUser();

    writeTypeCheckingFile(activeUser, "user", "APIUser");
    // replaceVolatileValues should not be needed here since the database is freshly reset
    // and the tests are executed serially. However, for unknown reasons the lastActivity
    // property still varies since ava was upgraded from v3 to v4.

    expect(replaceVolatileValues(activeUser)).toMatchSnapshot();
  });

  it("getFeatureToggles()", async ({ expect }) => {
    const features = await api.getFeatureToggles();

    writeTypeCheckingFile(features, "feature-toggles", "APIFeatureToggles");

    expect(features).toMatchSnapshot();
  });
});
