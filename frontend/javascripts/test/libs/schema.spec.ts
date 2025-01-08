import { getDefaultRecommendedConfiguration } from "admin/tasktype/recommended_configuration_view";
import test from "ava";
import { __setFeatures } from "features";
import { validateUserSettingsJSON } from "types/validation";
test("The default recommended task type settings should be valid according to the schema", async (t) => {
  // Set empty features
  __setFeatures({});

  validateUserSettingsJSON({}, JSON.stringify(getDefaultRecommendedConfiguration()))
    .then(() => t.pass())
    .catch(() => t.fail());
});
