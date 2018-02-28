/* eslint import/no-extraneous-dependencies: ["error", {"peerDependencies": true}] */
/* eslint-disable import/first */
// @flow
import "../enzyme/e2e-setup";
import test from "ava";
import _ from "lodash";
import * as api from "admin/admin_rest_api";
import {fetchWrapper} from "../enzyme/e2e-setup";

test.beforeEach(global.fetch = changeXAuthToken);

//...

