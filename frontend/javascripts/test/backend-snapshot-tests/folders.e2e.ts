import * as foldersApi from "admin/api/folders";
import test from "ava";
import Request from "libs/request";
import _ from "lodash";
import {
  replaceVolatileValues,
  resetDatabase,
  setCurrToken,
  tokenUserA,
  tokenUserC,
  writeTypeCheckingFile,
} from "test/e2e-setup";
import { APIMetadataEnum } from "types/api_flow_types";
test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});
test("getFolderTree", async (t) => {
  const folderTree = _.sortBy(
    await foldersApi.getFolderTree(),
    (folderWithParent) => folderWithParent.name,
  );

  writeTypeCheckingFile(folderTree, "folderTree", "FlatFolderTreeItem", {
    isArray: true,
  });
  t.snapshot(folderTree);
});
const organizationXRootFolderId = "570b9f4e4bb848d0885ea917";
test("getFolder", async (t) => {
  const folder = await foldersApi.getFolder(organizationXRootFolderId);

  writeTypeCheckingFile(folder, "folder", "Folder");
  t.snapshot(folder);
});
test("updateFolder", async (t) => {
  const newName = "renamed organization x root folder";
  const updatedFolder = await foldersApi.updateFolder({
    id: organizationXRootFolderId,
    allowedTeams: [],
    name: newName,
    metadata: [],
  });
  t.is(updatedFolder.name, newName);

  t.snapshot(updatedFolder);
});
test("createFolder", async (t) => {
  const newName = "a newly created folder!";
  const folder = await foldersApi.createFolder(organizationXRootFolderId, newName);
  t.is(folder.name, newName);

  t.snapshot(replaceVolatileValues(folder));
});
test("addAllowedTeamToFolder", async (t) => {
  const subFolderId = "570b9f4e4bb848d08880712a";
  const anotherSubFolderId = "570b9f4e4bb848d08880712b";
  const teamId = "570b9f4b2a7c0e3b008da6ec";

  await Request.receiveJSON(`/api/folders/${subFolderId}`);

  const updatedFolderWithTeam = await foldersApi.updateFolder({
    id: subFolderId,
    allowedTeams: [teamId],
    name: "A subfolder!",
    metadata: [{ type: APIMetadataEnum.STRING, key: "foo", value: "bar" }],
  });

  t.snapshot(updatedFolderWithTeam);

  setCurrToken(tokenUserC);
  /*
   * user c does not have elevated permissions, but is a member of the team
   * we expect that they can see the subfolder we add the team to, but not the other.
   */

  const subFolderSeenByUserC = await foldersApi.getFolder(subFolderId);

  t.snapshot(subFolderSeenByUserC);

  await t.throwsAsync(async () => {
    try {
      await Request.receiveJSON(`/api/folders/${anotherSubFolderId}`);
    } catch {
      throw new Error("request failed");
    }
  });
});
