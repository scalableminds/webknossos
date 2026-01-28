import { getDefaultRecommendedConfiguration } from "admin/tasktype/recommended_configuration_view";
import { __setFeatures } from "features";
import { validateUserSettingsJSON } from "types/validation";
import { describe, expect, it } from "vitest";

describe("Schema", () => {
  it("The default recommended task type settings should be valid according to the schema", async () => {
    // Set empty features
    __setFeatures({});

    await validateUserSettingsJSON({}, JSON.stringify(getDefaultRecommendedConfiguration()))
      .then(() => expect(true).toBe(true))
      .catch(() => expect.fail("Schema validation failed"));
  });
});
