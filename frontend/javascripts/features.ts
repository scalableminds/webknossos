import { getFeatureToggles } from "admin/admin_rest_api";
// @ts-expect-error ts-migrate(7034) FIXME: Variable 'features' implicitly has type 'any' in s... Remove this comment to see the full error message
let features = null;
export async function load() {
  features = await getFeatureToggles();
  return features;
}
export function __setFeatures(_features: Record<string, any>) {
  // Only use this function for tests.
  features = _features;
}
export function getDemoDatasetUrl() {
  // @ts-expect-error ts-migrate(7005) FIXME: Variable 'features' implicitly has an 'any' type.
  if (features == null) {
    throw new Error("Features not yet loaded.");
  }

  // @ts-expect-error ts-migrate(7005) FIXME: Variable 'features' implicitly has an 'any' type.
  return features.publicDemoDatasetUrl;
}
export default () => {
  // @ts-expect-error ts-migrate(7005) FIXME: Variable 'features' implicitly has an 'any' type.
  if (features == null) {
    throw new Error("Features not yet loaded.");
  }

  // @ts-expect-error ts-migrate(7005) FIXME: Variable 'features' implicitly has an 'any' type.
  return features;
};
