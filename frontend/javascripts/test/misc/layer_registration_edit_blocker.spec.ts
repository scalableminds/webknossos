import type { APIAnnotationInfo } from "types/api_types";
import { getLayerRegistrationEditBlocker } from "viewer/view/layer_registration/layer_registration_edit_blocker";
import { describe, expect, it } from "vitest";

function createAnnotation(overrides: Partial<APIAnnotationInfo>) {
  return {
    owner: { id: "owner", firstName: "A", lastName: "B" },
    state: "Active",
    isLockedByOwner: false,
    ...overrides,
  } as APIAnnotationInfo;
}

describe("Layer registration edit blocker", () => {
  it("lets only the owner work on an active, unlocked layer registration", () => {
    expect(getLayerRegistrationEditBlocker(createAnnotation({}), "owner")).toBeNull();
    expect(getLayerRegistrationEditBlocker(createAnnotation({}), "someone else")).toBe("notOwner");
    expect(getLayerRegistrationEditBlocker(createAnnotation({}), null)).toBe("notOwner");
    expect(getLayerRegistrationEditBlocker(createAnnotation({ state: "Finished" }), "owner")).toBe(
      "archived",
    );
    expect(
      getLayerRegistrationEditBlocker(createAnnotation({ isLockedByOwner: true }), "owner"),
    ).toBe("locked");
  });
});
