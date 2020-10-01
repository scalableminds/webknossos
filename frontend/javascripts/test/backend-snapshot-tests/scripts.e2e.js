// @flow
import {
  tokenUserA,
  setCurrToken,
  resetDatabase,
  writeFlowCheckingFile,
} from "test/enzyme/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";

test.before("Reset database", async () => {
  resetDatabase();
});

test.before("Change token", async () => {
  setCurrToken(tokenUserA);
});

test("getScripts()", async t => {
  const scripts = await api.getScripts();
  t.snapshot(scripts, { id: "scripts-getScripts" });
});

test("getScript()", async t => {
  const scripts = await api.getScripts();
  const firstScript = scripts[0];

  const script = await api.getScript(firstScript.id);
  writeFlowCheckingFile(script, "script", "APIScript");
  t.snapshot(script, { id: "scripts-getScript" });
});

test("createScript(), updateScript(), and deleteScript()", async t => {
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
  const createdScriptWithFixedId = Object.assign({}, createdScript, { id: "fixed-script-id" });
  t.snapshot(createdScriptWithFixedId, { id: "scripts-createScript" });

  // Update Script
  const newData = Object.assign({}, createdScript, { name: "MegaScript", owner: activeUser.id });
  // $FlowIssue[incompatible-call] Flow doesn't check that owner was replaced with a string
  const updatedScript = await api.updateScript(createdScript.id, newData);

  const updatedScriptWithFixedId = Object.assign({}, updatedScript, { id: "fixed-script-id" });
  t.snapshot(updatedScriptWithFixedId, { id: "scripts-updatedScript" });

  // Delete Script
  const response = await api.deleteScript(createdScript.id);
  t.snapshot(response, { id: "scripts-deleteScript" });
});
