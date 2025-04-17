import { tokenUserA, setUserAuthToken, resetDatabase, writeTypeCheckingFile } from "test/e2e-setup";
import * as api from "admin/admin_rest_api";
import { describe, it, beforeAll, expect } from "vitest";

beforeAll(async () => {
  // Reset database and change token
  resetDatabase();
  setUserAuthToken(tokenUserA);
});

describe("Scripts API (E2E)", () => {
  it("getScripts()", async () => {
    const scripts = await api.getScripts();
    expect(scripts).toMatchSnapshot();
  });

  it("getScript()", async () => {
    const scripts = await api.getScripts();
    const firstScript = scripts[0];
    const script = await api.getScript(firstScript.id);

    writeTypeCheckingFile(script, "script", "APIScript");

    expect(script).toMatchSnapshot();
  });

  it("createScript(), updateScript(), and deleteScript()", async () => {
    const activeUser = await api.getActiveUser();
    const data = {
      id: "will-be-ignored-anyway",
      name: "MergerMode",
      owner: activeUser.id,
      gist: "https://gist.github.com/heikowissler/d5ff5d490ab381af9405c9078096c723",
    };

    // Create New Script
    const createdScript = await api.createScript(data);

    // Since the id will change after re-runs, we fix it here for easy
    // snapshotting
    const createdScriptWithFixedId = Object.assign({}, createdScript, {
      id: "fixed-script-id",
    });
    expect(createdScriptWithFixedId).toMatchSnapshot();

    // Update Script
    const newData = Object.assign({}, createdScript, {
      name: "MegaScript",
      owner: activeUser.id,
    });

    const updatedScript = await api.updateScript(createdScript.id, newData);
    const updatedScriptWithFixedId = Object.assign({}, updatedScript, {
      id: "fixed-script-id",
    });
    expect(updatedScriptWithFixedId).toMatchSnapshot();

    // Delete Script
    const response = await api.deleteScript(createdScript.id);
    expect(response).toMatchSnapshot();
  });
});
