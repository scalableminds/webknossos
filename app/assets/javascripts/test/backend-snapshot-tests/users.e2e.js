/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import { tokenUserA, setCurrToken, resetDatabase } from "../enzyme/e2e-setup";
import test from "ava";
import * as api from "admin/admin_rest_api";

test.before("Reset database and change token", async () => {
  resetDatabase();
  setCurrToken(tokenUserA);
});

test("getUsers()", async t => {
  const users = await api.getUsers();
  t.snapshot(users, { id: "users-getUsers" });
});

test("getAdminUsers()", async t => {
  const adminUsers = await api.getAdminUsers();
  t.snapshot(adminUsers, { id: "users-adminUsers" });
});

test("getEditableUsers()", async t => {
  const editableUsers = await api.getEditableUsers();
  t.snapshot(editableUsers, { id: "users-editableUsers" });
});

test("getUser()", async t => {
  const activeUser = await api.getActiveUser();

  const user = await api.getUser(activeUser.id);
  t.snapshot(user, { id: "users-user" });
});

test("updateUser()", async t => {
  const activeUser = await api.getActiveUser();
  const newUser = Object.assign({}, activeUser, { isActive: false });

  const updatedUser = await api.updateUser(newUser);
  t.snapshot(updatedUser, { id: "users-updatedUser" });

  const oldUser = await api.updateUser(activeUser);
  t.snapshot(oldUser, { id: "users-oldUser" });
});

test("getLoggedTimes()", async t => {
  const activeUser = await api.getActiveUser();
  const loggedTimes = await api.getLoggedTimes(activeUser.id);
  t.snapshot(loggedTimes, { id: "users-loggedTimes" });
});

test("getAuthToken()", async t => {
  const authToken = await api.getAuthToken();
  t.snapshot(authToken, { id: "users-authToken" });
});

test("revokeAuthToken()", async t => {
  // Don't revoke the authToken or all test will fail!!!
  // Leave the test anyway to remind everyone of this.
  // await api.revokeAuthToken();
  t.pass();
});
