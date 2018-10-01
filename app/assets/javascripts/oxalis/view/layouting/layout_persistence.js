// @flow
import _ from "lodash";
import NanoEvents from "nanoevents";
import { setStoredLayoutsAction } from "oxalis/model/actions/ui_actions";
import Store from "oxalis/store";

import defaultLayouts, {
  currentLayoutVersion,
  defaultLayoutSchema,
} from "./default_layout_configs";
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
    return defaultLayoutSchema;
  }
  const layoutString = localStorage.getItem(localStorageKeys.goldenWkLayouts);
  if (!layoutString) {
    return defaultLayoutSchema;
  }
  try {
    const version = JSON.parse(storedLayoutVersion);
    const layouts = JSON.parse(layoutString);
    if (currentLayoutVersion > version) {
      if (version !== 5) {
        return defaultLayoutSchema;
      }
      // migrate to newst schema
      const withMulipleLayoutsSchema = {
        OrthoLayoutView: {
          "Custom Layout": layouts.OrthoLayoutView || defaultLayouts.OrthoLayoutView,
          lastActive: "Custom Layout",
        },
        VolumeTracingView: {
          "Custom Layout": layouts.VolumeTracingView || defaultLayouts.VolumeTracingView,
          lastActive: "Custom Layout",
        },
        ArbitraryLayout: {
          "Custom Layout": layouts.ArbitraryLayout || defaultLayouts.ArbitraryLayout,
          lastActive: "Custom Layout",
        },
        OrthoLayout: {
          "Custom Layout": layouts.OrthoLayout || defaultLayouts.OrthoLayout,
          lastActive: "Custom Layout",
        },
      };
      return withMulipleLayoutsSchema;
    }
    if (
      layouts.OrthoLayoutView &&
      layouts.VolumeTracingView &&
      layouts.ArbitraryLayout &&
      layouts.OrthoLayout
    ) {
      return layouts;
    }
    return defaultLayoutSchema;
  } catch (ex) {
    // This should only happen if someone tinkers with localStorage manually
    console.warn("Layout config could not be deserialized.");
  }
  return defaultLayoutSchema;
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

layoutEmitter.on("resetLayout", (layoutKey: LayoutKeys, activeLayout: string) => {
  storeLayoutConfig(defaultLayouts[layoutKey], layoutKey, activeLayout);
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

export function storeLayoutConfig(layoutConfig: Object, layoutKey: string, layoutName: string) {
  const currentLayouts = Store.getState().uiInformation.storedLayouts;
  const layoutKeys = Object.keys(currentLayouts);
  const newLayouts = {};
  layoutKeys.forEach(currentLayoutKey => {
    newLayouts[currentLayoutKey] = {};
    const layoutNames = Object.keys(currentLayouts[currentLayoutKey]);
    layoutNames.forEach(currentLayoutName => {
      if (currentLayoutKey === layoutKey && currentLayoutName === layoutName) {
        newLayouts[currentLayoutKey][currentLayoutName] = layoutConfig;
      } else {
        newLayouts[currentLayoutKey][currentLayoutName] =
          currentLayouts[currentLayoutKey][currentLayoutName];
      }
    });
  });
  console.log("persisting", newLayouts);
  Store.dispatch(setStoredLayoutsAction(newLayouts));
  persistLayoutConfigsDebounced();
}
