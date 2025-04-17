import _ from "lodash";
import {
  tokenUserA,
  tokenUserC,
  setUserAuthToken,
  resetDatabase,
  replaceVolatileValues,
  writeTypeCheckingFile,
} from "test/e2e-setup";
import Request from "libs/request";
import * as foldersApi from "admin/api/folders";
import { describe, it, beforeAll, expect } from "vitest";
import { APIMetadataEnum } from "types/api_flow_types";

// Reset database and change token
beforeAll(async () => {
  resetDatabase();
  setUserAuthToken(tokenUserA);
});

describe("Folder API (E2E))", () => {
  it("getFolderTree", async () => {
    const folderTree = _.sortBy(
      await foldersApi.getFolderTree(),
      (folderWithParent) => folderWithParent.name,
    );

    writeTypeCheckingFile(folderTree, "folderTree", "FlatFolderTreeItem", {
      isArray: true,
    });
    expect(folderTree).toMatchSnapshot();
  });

  const organizationXRootFolderId = "570b9f4e4bb848d0885ea917";

  it("getFolder", async () => {
    const folder = await foldersApi.getFolder(organizationXRootFolderId);

    writeTypeCheckingFile(folder, "folder", "Folder");
    expect(folder).toMatchSnapshot();
  });

  it("updateFolder", async () => {
    const newName = "renamed organization x root folder";
    const updatedFolder = await foldersApi.updateFolder({
      id: organizationXRootFolderId,
      allowedTeams: [],
      name: newName,
      metadata: [],
    });
    expect(updatedFolder.name).toBe(newName);

    expect(updatedFolder).toMatchSnapshot();
  });

  it("createFolder", async () => {
    const newName = "a newly created folder!";
    const folder = await foldersApi.createFolder(organizationXRootFolderId, newName);
    expect(folder.name).toBe(newName);

    expect(replaceVolatileValues(folder)).toMatchSnapshot();
  });

  it("addAllowedTeamToFolder", async () => {
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

    expect(updatedFolderWithTeam).toMatchSnapshot();

    setUserAuthToken(tokenUserC);
    /*
     * user c does not have elevated permissions, but is a member of the team
     * we expect that they can see the subfolder we add the team to, but not the other.
     */

    const subFolderSeenByUserC = await foldersApi.getFolder(subFolderId);

    expect(subFolderSeenByUserC).toMatchSnapshot();

    await expect(async () => {
      try {
        await Request.receiveJSON(`/api/folders/${anotherSubFolderId}`);
      } catch {
        throw new Error("request failed");
      }
    }).rejects.toThrow("request failed");
  });
});
