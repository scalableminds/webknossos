// biome-ignore assist/source/organizeImports: test setup and mocking needs to be loaded first
import { resetDatabase, setUserAuthToken, tokenUserA, writeTypeCheckingFile } from "test/e2e-setup";
import {
  createScript,
  deleteScript,
  getActiveUser,
  getScript,
  getScripts,
  updateScript,
} from "admin/rest_api";
import { beforeAll, describe, expect, it } from "vitest";

describe("Scripts API (E2E)", () => {
  beforeAll(async () => {
    // Reset database and change token
    resetDatabase();
    setUserAuthToken(tokenUserA);
  });

  it("getScripts()", async ({ expect }) => {
    const scripts = await getScripts();
    expect(scripts).toMatchSnapshot();
  });

  it("getScript()", async ({ expect }) => {
    const scripts = await getScripts();
    const firstScript = scripts[0];
    const script = await getScript(firstScript.id);

    writeTypeCheckingFile(script, "script", "APIScript");

    expect(script).toMatchSnapshot();
  });

  it("createScript(), updateScript(), and deleteScript()", async () => {
    const activeUser = await getActiveUser();
    const data = {
      id: "will-be-ignored-anyway",
      name: "MergerMode",
      owner: activeUser.id,
      gist: "https://gist.github.com/heikowissler/d5ff5d490ab381af9405c9078096c723",
    };

    // Create New Script
    const createdScript = await createScript(data);

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

    const updatedScript = await updateScript(createdScript.id, newData);
    const updatedScriptWithFixedId = Object.assign({}, updatedScript, {
      id: "fixed-script-id",
    });
    expect(updatedScriptWithFixedId).toMatchSnapshot();

    // Delete Script
    const response = await deleteScript(createdScript.id);
    expect(response).toMatchSnapshot();
  });
});
