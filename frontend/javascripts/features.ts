import { getFeatureToggles } from "admin/admin_rest_api";
let features: Record<string, any> | null = null;

export async function load() {
  features = await getFeatureToggles();
  return features;
}
export function __setFeatures(_features: Record<string, any>) {
  // Only use this function for tests.
  features = _features;
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
