import _ from "lodash";
import {
  tokenUserA,
  tokenUserC,
  setCurrToken,
  resetDatabase,
  replaceVolatileValues,
  writeTypeCheckingFile,
} from "test/enzyme/e2e-setup";
import Request from "libs/request";
import * as foldersApi from "admin/api/folders";
import test from "ava";
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
  t.snapshot(folderTree, {
    id: "folders-getFolderTree()",
  });
});
const organizationXRootFolderId = "570b9f4e4bb848d0885ea917";
test("getFolder", async (t) => {
  const folder = await foldersApi.getFolder(organizationXRootFolderId);

  writeTypeCheckingFile(folder, "folder", "Folder");
  t.snapshot(folder, {
    id: "folders-getFolder()",
  });
});
test("updateFolder", async (t) => {
  const newName = "renamed organization x root folder";
  const updatedFolder = await foldersApi.updateFolder({
    id: organizationXRootFolderId,
    allowedTeams: [],
    name: newName,
  });
  t.is(updatedFolder.name, newName);

  t.snapshot(updatedFolder, {
    id: "folders-updatedFolder()",
  });
});
test("createFolder", async (t) => {
  const newName = "a newly created folder!";
  const folder = await foldersApi.createFolder(organizationXRootFolderId, newName);
  t.is(folder.name, newName);

  t.snapshot(replaceVolatileValues(folder), {
    id: "folders-createFolder()",
  });
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
  });

  t.snapshot(updatedFolderWithTeam, {
    id: "folders-updatedWithTeam",
  });

  setCurrToken(tokenUserC);
  /*
   * user c does not have elevated permissions, but is a member of the team
   * we expect that they can see the subfolder we add the team to, but not the other.
   */

  const subFolderSeenByUserC = await foldersApi.getFolder(subFolderId);

  t.snapshot(subFolderSeenByUserC, {
    id: "folders-folderAfterUpdateTeamsSeenByUserC",
  });

  await t.throwsAsync(async () => {
    try {
      await Request.receiveJSON(`/api/folders/${anotherSubFolderId}`);
    } catch {
      throw new Error("request failed");
    }
  });
});
