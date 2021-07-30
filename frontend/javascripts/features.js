// @flow

import { getFeatureToggles } from "admin/admin_rest_api";

let features = null;

export async function load() {
  features = await getFeatureToggles();
  return features;
}

export function __setFeatures(_features: Object) {
  // Only use this function for tests.
  features = _features;
}

export function getDemoDatasetUrl() {
  if (features == null) {
    throw new Error("Features not yet loaded.");
  }

  // Only create a tracing on the demo instance, as the user might not be logged in there
  // otherwise.
  const suffix = features.isDemoInstance ? "/createExplorative/hybrid/true/null/null" : "/view";
  return features.publicDemoDatasetUrl + suffix;
}

export default () => {
  if (features == null) {
    throw new Error("Features not yet loaded.");
  }
  return features;
};
