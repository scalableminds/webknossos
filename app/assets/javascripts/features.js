// @flow

import { getFeatureToggles } from "admin/admin_rest_api";

let features = null;

export async function load() {
  features = await getFeatureToggles();
  return features;
}

export default () => {
  if (features == null) {
    throw new Error("Features not yet loaded.");
  }
  return features;
};
