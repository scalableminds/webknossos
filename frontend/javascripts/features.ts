import { getFeatureToggles } from "admin/rest_api";
import type { APIFeatureToggles } from "types/api_types";
let features: APIFeatureToggles | null = null;

export async function load() {
  features = await getFeatureToggles();
  return features;
}
export function __setFeatures(_features: Record<string, any>) {
  // Only use this function for tests. Unsafe typecase is intended here to have improved type safety.
  features = _features as APIFeatureToggles;
}
export function getDemoDatasetUrl() {
  if (features == null) {
    throw new Error("Features not yet loaded.");
  }

  return features.publicDemoDatasetUrl;
}
export default () => {
  if (features == null) {
    throw new Error("Features not yet loaded.");
  }

  return features;
};
