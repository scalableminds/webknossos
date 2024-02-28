import * as api from "admin/admin_rest_api";
import test from "ava";
import {
  replaceVolatileValues,
  resetDatabase,
  setCurrToken,
  tokenUserA,
  writeTypeCheckingFile,
} from "test/enzyme/e2e-setup";
test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});
test("getUsers()", async (t) => {
  const users = await api.getUsers();
  writeTypeCheckingFile(users, "user", "APIUser", {
    isArray: true,
  });
  t.snapshot(replaceVolatileValues(users), {
    id: "users-getUsers",
  });
});
test("getAdminUsers()", async (t) => {
  const adminUsers = await api.getAdminUsers();
  t.snapshot(replaceVolatileValues(adminUsers), {
    id: "users-adminUsers",
  });
});
test("getEditableUsers()", async (t) => {
  const editableUsers = await api.getEditableUsers();
  t.snapshot(editableUsers, {
    id: "users-editableUsers",
  });
});
test("getUser()", async (t) => {
  const activeUser = await api.getActiveUser();
  const user = await api.getUser(activeUser.id);
  t.snapshot(replaceVolatileValues(user), {
    id: "users-user",
  });
});
test("updateUser()", async (t) => {
  const activeUser = await api.getActiveUser();
  const newUser = Object.assign({}, activeUser, {
    firstName: "UpdatedFirstName",
  });
  const updatedUser = await api.updateUser(newUser);
  t.snapshot(replaceVolatileValues(updatedUser), {
    id: "users-updatedUser",
  });
  const oldUser = await api.updateUser(activeUser);
  t.snapshot(replaceVolatileValues(oldUser), {
    id: "users-oldUser",
  });
});
test("getLoggedTimes()", async (t) => {
  const activeUser = await api.getActiveUser();
  const loggedTimes = await api.getLoggedTimes(activeUser.id);
  writeTypeCheckingFile(loggedTimes, "logged-times", "APITimeInterval", {
    isArray: true,
  });
  t.snapshot(loggedTimes, {
    id: "users-loggedTimes",
  });
});
test("getAuthToken()", async (t) => {
  const authToken = await api.getAuthToken();
  t.snapshot(authToken, {
    id: "users-authToken",
  });
});
test("revokeAuthToken()", async (t) => {
  // Don't revoke the authToken or all test will fail!!!
  // Leave the test anyway to remind everyone of this.
  // await api.revokeAuthToken();
  t.pass();
});
