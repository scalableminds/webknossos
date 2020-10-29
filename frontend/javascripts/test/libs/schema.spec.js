// @flow

import test from "ava";

import { DEFAULT_RECOMMENDED_CONFIGURATION } from "admin/tasktype/recommended_configuration_view";
import { validateUserSettingsJSON } from "types/validation";

test("The default recommended task type settings should be valid according to the schema", async t => {
  validateUserSettingsJSON({}, JSON.stringify(DEFAULT_RECOMMENDED_CONFIGURATION), error =>
    t.true(error == null),
  );
});
