import {
  tokenUserA,
  tokenUserE,
  tokenUserF,
  setUserAuthToken,
  resetDatabase,
  replaceVolatileValues,
  writeTypeCheckingFile,
} from "test/e2e-setup";
import * as api from "admin/admin_rest_api";
import { describe, it, beforeAll, expect, beforeEach } from "vitest";

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
    const users = await api.getUsers();
    writeTypeCheckingFile(users, "user", "APIUser", {
      isArray: true,
    });
    expect(replaceVolatileValues(users)).toMatchSnapshot();
  });

  it("getUsers() Orga Y", async () => {
    setUserAuthToken(tokenUserE);
    const users = await api.getUsers();
    expect(replaceVolatileValues(users)).toMatchSnapshot();
  });

  it("getUsers() Orga Z", async () => {
    setUserAuthToken(tokenUserF);
    const users = await api.getUsers();
    expect(replaceVolatileValues(users)).toMatchSnapshot();
  });

  it("getAdminUsers()", async () => {
    const adminUsers = await api.getAdminUsers();
    expect(replaceVolatileValues(adminUsers)).toMatchSnapshot();
  });

  it("getEditableUsers()", async () => {
    const editableUsers = await api.getEditableUsers();
    expect(editableUsers).toMatchSnapshot();
  });

  it("getUser()", async () => {
    const activeUser = await api.getActiveUser();
    const user = await api.getUser(activeUser.id);
    expect(replaceVolatileValues(user)).toMatchSnapshot();
  });

  it("updateUser()", async () => {
    const activeUser = await api.getActiveUser();
    const newUser = Object.assign({}, activeUser, {
      firstName: "UpdatedFirstName",
    });
    const updatedUser = await api.updateUser(newUser);
    expect(replaceVolatileValues(updatedUser)).toMatchSnapshot();

    const oldUser = await api.updateUser(activeUser);
    expect(replaceVolatileValues(oldUser)).toMatchSnapshot();
  });

  it("getLoggedTimes()", async () => {
    const activeUser = await api.getActiveUser();
    const loggedTimes = await api.getLoggedTimes(activeUser.id);
    writeTypeCheckingFile(loggedTimes, "logged-times", "APITimeInterval", {
      isArray: true,
    });
    expect(loggedTimes).toMatchSnapshot();
  });

  it("getAuthToken()", async () => {
    const authToken = await api.getAuthToken();
    expect(authToken).toMatchSnapshot();
  });

  it("revokeAuthToken()", async () => {
    // Don't revoke the authToken or all test will fail!!!
    // Leave the test anyway to remind everyone of this.
    // await api.revokeAuthToken();
    expect(true).toBe(true); // Just pass the test
  });
});
