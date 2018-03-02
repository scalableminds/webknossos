/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";
import {fetchWrapper} from "../enzyme/e2e-setup";

let activeUser;
test.beforeEach(global.fetch = changeXAuthToken);

test.before("Initialize values", async () => {
  activeUser = await api.getActiveUser();
});

//one of these should fail
test.serial("test whether is test is working", async t => {
  t.equal(1, 1, "One is not equal to One")
});

test.serial("test whether is test is working", async t => {
  t.equal(1, 0, "One is not equal to One")
});

 test.serial("Test Name", async t => {
  t.equal(activeUser.lastName, "Boy", "lastName do not match")
});

