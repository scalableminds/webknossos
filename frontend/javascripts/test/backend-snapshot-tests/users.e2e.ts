import {
  tokenUserA,
  tokenUserE,
  tokenUserF,
  setCurrToken,
  resetDatabase,
  replaceVolatileValues,
  writeTypeCheckingFile,
} from "test/e2e-setup";
import * as api from "admin/admin_rest_api";
import test from "ava";
test.before("Reset database and change token", async () => {
  resetDatabase();
});
test.beforeEach("Reset user token", () => {
  setCurrToken(tokenUserA);
});
test("getUsers() Orga X", async (t) => {
  const users = await api.getUsers();
  writeTypeCheckingFile(users, "user", "APIUser", {
    isArray: true,
  });
  t.snapshot(replaceVolatileValues(users));
});
test("getUsers() Orga Y", async (t) => {
  setCurrToken(tokenUserE);
  const users = await api.getUsers();
  writeTypeCheckingFile(users, "user", "APIUser", {
    isArray: true,
  });
  t.snapshot(replaceVolatileValues(users));
});
test("getUsers() Orga Z", async (t) => {
  setCurrToken(tokenUserF);
  const users = await api.getUsers();
  writeTypeCheckingFile(users, "user", "APIUser", {
    isArray: true,
  });
  t.snapshot(replaceVolatileValues(users));
});
test("getAdminUsers()", async (t) => {
  const adminUsers = await api.getAdminUsers();
  t.snapshot(replaceVolatileValues(adminUsers));
});
test("getEditableUsers()", async (t) => {
  const editableUsers = await api.getEditableUsers();
  t.snapshot(editableUsers);
});
test("getUser()", async (t) => {
  const activeUser = await api.getActiveUser();
  const user = await api.getUser(activeUser.id);
  t.snapshot(replaceVolatileValues(user));
});
test("updateUser()", async (t) => {
  const activeUser = await api.getActiveUser();
  const newUser = Object.assign({}, activeUser, {
    firstName: "UpdatedFirstName",
  });
  const updatedUser = await api.updateUser(newUser);
  t.snapshot(replaceVolatileValues(updatedUser));
  const oldUser = await api.updateUser(activeUser);
  t.snapshot(replaceVolatileValues(oldUser));
});
test("getLoggedTimes()", async (t) => {
  const activeUser = await api.getActiveUser();
  const loggedTimes = await api.getLoggedTimes(activeUser.id);
  writeTypeCheckingFile(loggedTimes, "logged-times", "APITimeInterval", {
    isArray: true,
  });
  t.snapshot(loggedTimes);
});
test("getAuthToken()", async (t) => {
  const authToken = await api.getAuthToken();
  t.snapshot(authToken);
});
test("revokeAuthToken()", async (t) => {
  // Don't revoke the authToken or all test will fail!!!
  // Leave the test anyway to remind everyone of this.
  // await api.revokeAuthToken();
  t.pass();
});
