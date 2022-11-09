import _ from "lodash";
import Request from "libs/request";
import {
  tokenUserA,
  tokenUserC,
  setCurrToken,
  resetDatabase,
  writeTypeCheckingFile,
} from "test/enzyme/e2e-setup";
import test from "ava";
test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});
test("getFolderTree", async (t) => {
  const folderTree = _.sortBy(await Request.receiveJSON("/api/folders/tree"), (folderWithParent) => folderWithParent.name);

  writeTypeCheckingFile(folderTree, "folderTree", "FlatFolderTreeItem", {
    isArray: true,
  });
  t.snapshot(folderTree, {
    id: "folders-getFolderTree()",
  });
});
const organizationXRootFolderId = "570b9f4e4bb848d0885ea917";
test("getFolder", async (t) => {
  const folder = await Request.receiveJSON(`/api/folders/${organizationXRootFolderId}`);

  writeTypeCheckingFile(folder, "folder", "Folder", {
    isArray: true,
  });
  t.snapshot(folder, {
    id: "folders-getFolder()",
  });
});
test("updateFolder", async (t) => {
  const newName = "renamed organization x root folder";
  const updatedFolder = await Request.sendJSONReceiveJSON(`/api/folders/${organizationXRootFolderId}`,
    {
    data: {
      allowedTeams: [],
      name: newName
    },
    method: "PUT",
  });
  t.is(updatedFolder.name, newName);

  t.snapshot(updatedFolder, {
    id: "folders-updatedFolder()",
  });
});
test("addAllowedTeamToFolder", async (t) => {
  const subFolderId = "570b9f4e4bb848d08880712a";
  //const anotherSubFolderId = "570b9f4e4bb848d08880712b";
  const teamId = "570b9f4b2a7c0e3b008da6ec";

  await Request.receiveJSON(`/api/folders/${subFolderId}`);

  const updatedFolderWithTeam = await Request.sendJSONReceiveJSON(`/api/folders/${subFolderId}`,
    {
    data: {
      allowedTeams: [teamId],
      name: "A subfolder!"
    },
    method: "PUT",
  });

  t.snapshot(updatedFolderWithTeam, {
    id: "folders-updatedWithTeam",
  });

  setCurrToken(tokenUserC);
  /*
   * user c does not have elevated permissions, but is a member of the team
   * we expect that they can see the subfolder we add the team to, but not the other.
   */

  const subFolderSeenByUserC = await Request.receiveJSON(`/api/folders/${subFolderId}`);

  t.snapshot(subFolderSeenByUserC, {
    id: "folders-folderAfterUpdateTeamsSeenByUserC",
  });

  // await t.throwsAsync(() => Request.receiveJSON(`/api/folders/${anotherSubFolderId}`));

});
