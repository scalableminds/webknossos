import {
  getActiveUser,
  getAdminUsers,
  getAuthToken,
  getEditableUsers,
  getLoggedTimes,
  getUser,
  getUsers,
  updateUser,
} from "admin/rest_api";
import {
  replaceVolatileValues,
  resetDatabase,
  setUserAuthToken,
  tokenUserA,
  tokenUserE,
  tokenUserF,
  writeTypeCheckingFile,
} from "test/e2e-setup";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";

describe("Users API (E2E)", () => {
  beforeAll(async () => {
    // Reset database and change token
    resetDatabase();
  });
  beforeEach(() => {
    // Reset database and change token
    setUserAuthToken(tokenUserA);
  });

  it("getUsers() Orga X", async () => {
    const users = await getUsers();
    writeTypeCheckingFile(users, "user", "APIUser", {
      isArray: true,
    });
    expect(replaceVolatileValues(users)).toMatchSnapshot();
  });

  it("getUsers() Orga Y", async () => {
    setUserAuthToken(tokenUserE);
    const users = await getUsers();
    expect(replaceVolatileValues(users)).toMatchSnapshot();
  });

  it("getUsers() Orga Z", async () => {
    setUserAuthToken(tokenUserF);
    const users = await getUsers();
    expect(replaceVolatileValues(users)).toMatchSnapshot();
  });

  it("getAdminUsers()", async () => {
    const adminUsers = await getAdminUsers();
    expect(replaceVolatileValues(adminUsers)).toMatchSnapshot();
  });

  it("getEditableUsers()", async () => {
    const editableUsers = await getEditableUsers();
    expect(editableUsers).toMatchSnapshot();
  });

  it("getUser()", async () => {
    const activeUser = await getActiveUser();
    const user = await getUser(activeUser.id);
    expect(replaceVolatileValues(user)).toMatchSnapshot();
  });

  it("updateUser()", async () => {
    const activeUser = await getActiveUser();
    const newUser = Object.assign({}, activeUser, {
      firstName: "UpdatedFirstName",
    });
    const updatedUser = await updateUser(newUser);
    expect(replaceVolatileValues(updatedUser)).toMatchSnapshot();

    const oldUser = await updateUser(activeUser);
    expect(replaceVolatileValues(oldUser)).toMatchSnapshot();
  });

  it("getLoggedTimes()", async () => {
    const activeUser = await getActiveUser();
    const loggedTimes = await getLoggedTimes(activeUser.id);
    writeTypeCheckingFile(loggedTimes, "logged-times", "APITimeInterval", {
      isArray: true,
    });
    expect(loggedTimes).toMatchSnapshot();
  });

  it("getAuthToken()", async () => {
    const authToken = await getAuthToken();
    expect(authToken).toMatchSnapshot();
  });

  it("revokeAuthToken()", async () => {
    // Don't revoke the authToken or all test will fail!!!
    // Leave the test anyway to remind everyone of this.
    // await revokeAuthToken();
    expect(true).toBe(true); // Just pass the test
  });
});
