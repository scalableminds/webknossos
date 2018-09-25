// @flow
import _ from "lodash";
import NanoEvents from "nanoevents";

import defaultLayouts, { currentLayoutVersion } from "./default_layout_configs";
import type { LayoutKeysType } from "./default_layout_configs";

export const layoutEmitter = new NanoEvents();

// For debugging purposes:
const disableLayoutPersistance = false;

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
  if (layoutString) {
    try {
      return JSON.parse(layoutString);
    } catch (ex) {
      // This should only happen if someone tinkers with localStorage manually
      console.warn("Layout config could not be deserialized.");
    }
  }
  return {};
}

let storedLayouts = readStoredLayoutConfigs();

function persistLayoutConfigs() {
  localStorage.setItem(localStorageKeys.goldenWkLayouts, JSON.stringify(storedLayouts));
  localStorage.setItem(localStorageKeys.currentLayoutVersion, JSON.stringify(currentLayoutVersion));
}

function clearStoredLayouts() {
  localStorage.removeItem(localStorageKeys.goldenWkLayouts);
  storedLayouts = readStoredLayoutConfigs();
}

layoutEmitter.on("resetLayout", () => {
  clearStoredLayouts();
});

const persistLayoutConfigsDebounced = _.debounce(persistLayoutConfigs, 1000);

export function getLayoutConfig(layoutKey: LayoutKeysType) {
  if (storedLayouts[layoutKey]) {
    // Use default dimensions and settings
    const { dimensions, settings } = defaultLayouts[layoutKey];
    return {
      ...storedLayouts[layoutKey],
      dimensions,
      settings,
    };
  }

  return defaultLayouts[layoutKey];
}

export function storeLayoutConfig(layoutConfig: Object, layoutKey: string) {
  storedLayouts[layoutKey] = layoutConfig;
  persistLayoutConfigsDebounced();
}
