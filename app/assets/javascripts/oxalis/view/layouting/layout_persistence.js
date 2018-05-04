// @flow
import _ from "lodash";
import defaultLayouts, { currentLayoutVersion } from "./default_layout_configs";
import type { LayoutKeysType } from "./default_layout_configs";

const disableLayoutPersistance = true;

const localStorageKeys = {
  currentLayoutVersion: "currentLayoutVersion",
  goldenWkLayouts: "goldenWkLayouts",
};

function readStoredLayoutConfigs() {
  const storedLayoutVersion = localStorage.getItem(localStorageKeys.currentLayoutVersion);
  if (!storedLayoutVersion || disableLayoutPersistance) {
    return {};
  }
  if (currentLayoutVersion > JSON.parse(storedLayoutVersion)) {
    return {};
  }
  const layoutString = localStorage.getItem(localStorageKeys.goldenWkLayouts);
  return layoutString ? JSON.parse(layoutString) : {};
}

const storedLayouts = readStoredLayoutConfigs();

function persistLayoutConfigs() {
  localStorage.setItem(localStorageKeys.goldenWkLayouts, JSON.stringify(storedLayouts));
  localStorage.setItem(localStorageKeys.currentLayoutVersion, JSON.stringify(currentLayoutVersion));
}

const persistLayoutConfigsDebounced = _.debounce(persistLayoutConfigs, 2000);

export function getLayoutConfig(layoutKey: LayoutKeysType) {
  if (storedLayouts[layoutKey]) {
    return storedLayouts[layoutKey];
  }

  return defaultLayouts[layoutKey];
}

export function storeLayoutConfig(layoutConfig: Object, layoutKey: string) {
  storedLayouts[layoutKey] = layoutConfig;
  persistLayoutConfigsDebounced();
}
