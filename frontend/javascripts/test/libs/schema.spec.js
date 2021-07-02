// @flow

import test from "ava";

import { getDefaultRecommendedConfiguration } from "admin/tasktype/recommended_configuration_view";
import { validateUserSettingsJSON } from "types/validation";
import { __setFeatures } from "features";

test("The default recommended task type settings should be valid according to the schema", async t => {
  // Set empty features
  __setFeatures({});

  validateUserSettingsJSON({}, JSON.stringify(getDefaultRecommendedConfiguration()))
    .then(() => t.pass())
    .catch(() => t.fail());
});
