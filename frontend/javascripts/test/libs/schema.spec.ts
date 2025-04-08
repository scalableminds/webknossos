import { describe, it, expect } from "vitest";
import { getDefaultRecommendedConfiguration } from "admin/tasktype/recommended_configuration_view";
import { validateUserSettingsJSON } from "types/validation";
import { __setFeatures } from "features";

describe("Schema", () => {
  it("The default recommended task type settings should be valid according to the schema", async () => {
    // Set empty features
    __setFeatures({});

    await validateUserSettingsJSON({}, JSON.stringify(getDefaultRecommendedConfiguration()))
      .then(() => expect(true).toBe(true))
      .catch(() => expect.fail("Schema validation failed"));
  });
});
