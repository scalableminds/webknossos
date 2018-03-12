/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";
import { defaultToken, setCurrToken } from "../enzyme/e2e-setup";

let activeUser;

test.before("Initialize values", async () => {
  setCurrToken("XXX");
  activeUser = await api.getActiveUser();
});

//one of these should fail
test.serial("test whether the test is working", async t => {
  t.is(1, 1);
});

test.serial("test whether the test is working", async t => {
  t.is(1, 0);
});

test.serial("Test Name", async t => {
  t.is(activeUser.firstName, "Boy");
});
