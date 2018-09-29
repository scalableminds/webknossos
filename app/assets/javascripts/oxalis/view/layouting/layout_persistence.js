// @flow
import _ from "lodash";
import NanoEvents from "nanoevents";
import { setStoredLayoutsAction } from "oxalis/model/actions/ui_actions";
import Store from "oxalis/store";

import defaultLayouts, { currentLayoutVersion } from "./default_layout_configs";
import type { LayoutKeys } from "./default_layout_configs";

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
      // return JSON.parse(layoutString);
      const layouts = JSON.parse(layoutString);
    } catch (ex) {
      // This should only happen if someone tinkers with localStorage manually
      console.warn("Layout config could not be deserialized.");
    }
  }
  return {};
}

Store.dispatch(setStoredLayoutsAction(readStoredLayoutConfigs()));

function persistLayoutConfigs() {
  const storedLayouts = Store.getState().uiInformation.storedLayouts;
  localStorage.setItem(localStorageKeys.goldenWkLayouts, JSON.stringify(storedLayouts));
  localStorage.setItem(localStorageKeys.currentLayoutVersion, JSON.stringify(currentLayoutVersion));
}

function clearStoredLayouts() {
  localStorage.removeItem(localStorageKeys.goldenWkLayouts);
  Store.dispatch(setStoredLayoutsAction(readStoredLayoutConfigs()));
}

layoutEmitter.on("resetLayout", () => {
  clearStoredLayouts();
});

const persistLayoutConfigsDebounced = _.debounce(persistLayoutConfigs, 1000);

export function getLayoutConfig(layoutKey: LayoutKeys, layoutName: string) {
  const storedLayouts = Store.getState().uiInformation.storedLayouts;
  if (storedLayouts[layoutKey]) {
    // Use default dimensions and settings
    const layout = storedLayouts[layoutKey][layoutName];
    if (layout) {
      const { dimensions, settings } = defaultLayouts[layoutKey];
      return {
        ...storedLayouts[layoutKey],
        dimensions,
        settings,
      };
    }
  }

  return defaultLayouts[layoutKey];
}

export function getLayoutConfigs(layoutKey: LayoutKeys) {
  const storedLayouts = Store.getState().uiInformation.storedLayouts;
  if (storedLayouts[layoutKey]) {
    // Use default dimensions and settings
    const { dimensions, settings } = defaultLayouts[layoutKey];
    const layoutNames = Object.keys(storedLayouts);
    const layouts = layoutNames.map(layoutName => ({
      ...storedLayouts[layoutKey],
      dimensions,
      settings,
      name: layoutName,
    }));
    return layouts;
  }
  return defaultLayouts[layoutKey];
}

export function storeLayoutConfig(layoutConfig: Object, layoutKey: string, layoutName: string) {
  const currentLayouts = Store.getState().uiInformation.storedLayouts;
  const newLayout = {};
  newLayout[layoutName] = layoutConfig;
  const layoutKeys = Object.keys(currentLayouts);
  const newLayouts = layoutKeys.map(
    currentLayoutKey =>
      currentLayoutKey === layoutKey
        ? { ...currentLayouts[layoutKey], ...newLayout }
        : currentLayouts[currentLayoutKey],
  );
  console.log(newLayouts);
  Store.dispatch(setStoredLayoutsAction(newLayouts));
  // storedLayouts[layoutKey] = layoutConfig; -> remove later
  persistLayoutConfigsDebounced();
}
