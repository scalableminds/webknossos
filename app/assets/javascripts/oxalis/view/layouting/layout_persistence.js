// @flow
import NanoEvents from "nanoevents";
import _ from "lodash";

import { setStoredLayoutsAction } from "oxalis/model/actions/ui_actions";
import Store from "oxalis/store";
import Toast from "libs/toast";

import getDefaultLayouts, {
  currentLayoutVersion,
  getCurrentDefaultLayoutConfig,
  mapLayoutKeysToLanguage,
  type LayoutKeys,
} from "./default_layout_configs";

export const layoutEmitter = new NanoEvents();

// For debugging purposes:
const disableLayoutPersistance = false;

const localStorageKeys = {
  currentLayoutVersion: "currentLayoutVersion",
  goldenWkLayouts: "goldenWkLayouts",
};

function readStoredLayoutConfigs() {
  const storedLayoutVersion = localStorage.getItem(localStorageKeys.currentLayoutVersion);
  const defaultLayoutConfig = getCurrentDefaultLayoutConfig();
  if (!storedLayoutVersion || disableLayoutPersistance) {
    return defaultLayoutConfig;
  }
  const layoutString = localStorage.getItem(localStorageKeys.goldenWkLayouts);
  if (!layoutString) {
    return defaultLayoutConfig;
  }
  try {
    const version = JSON.parse(storedLayoutVersion);
    const layouts = JSON.parse(layoutString);
    if (currentLayoutVersion > version) {
      if (version !== 5) {
        return defaultLayoutConfig;
      }
      // migrate to newset schema
      const withMulipleLayoutsSchema = {
        OrthoLayoutView: {
          "Custom Layout": layouts.OrthoLayoutView || defaultLayoutConfig.OrthoLayoutView,
        },
        VolumeTracingView: {
          "Custom Layout": layouts.VolumeTracingView || defaultLayoutConfig.VolumeTracingView,
        },
        ArbitraryLayout: {
          "Custom Layout": layouts.ArbitraryLayout || defaultLayoutConfig.ArbitraryLayout,
        },
        OrthoLayout: {
          "Custom Layout": layouts.OrthoLayout || defaultLayoutConfig.OrthoLayout,
        },
        LastActiveLayouts: {
          OrthoLayoutView: "Custom Layout",
          VolumeTracingView: "Custom Layout",
          ArbitraryLayout: "Custom Layout",
          OrthoLayout: "Custom Layout",
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
    return defaultLayoutConfig;
  } catch (ex) {
    // This should only happen if someone tinkers with localStorage manually
    console.warn("Layout config could not be deserialized.");
  }
  return defaultLayoutConfig;
}

Store.dispatch(setStoredLayoutsAction(readStoredLayoutConfigs()));

function persistLayoutConfigs() {
  const storedLayouts = Store.getState().uiInformation.storedLayouts;
  localStorage.setItem(localStorageKeys.goldenWkLayouts, JSON.stringify(storedLayouts));
  localStorage.setItem(localStorageKeys.currentLayoutVersion, JSON.stringify(currentLayoutVersion));
}

layoutEmitter.on("resetLayout", (layoutKey: LayoutKeys, activeLayout: string) => {
  storeLayoutConfig(getDefaultLayouts()[layoutKey], layoutKey, activeLayout);
});

const persistLayoutConfigsDebounced = _.debounce(persistLayoutConfigs, 1000);

export function getLayoutConfig(layoutKey: LayoutKeys, activeLayoutName: string) {
  const storedLayouts = Store.getState().uiInformation.storedLayouts;
  if (!storedLayouts[layoutKey]) {
    return getDefaultLayouts()[layoutKey];
  }
  const layout = storedLayouts[layoutKey][activeLayoutName];
  if (!layout) {
    return getDefaultLayouts()[layoutKey];
  }
  // Use default dimensions and settings
  const { dimensions, settings } = getDefaultLayouts()[layoutKey];
  return {
    ...layout,
    dimensions,
    settings,
  };
}

function getDeepCopyOfStoredLayouts(): Object {
  const currentLayouts = Store.getState().uiInformation.storedLayouts;
  return _.cloneDeep(currentLayouts);
}

export function storeLayoutConfig(layoutConfig: Object, layoutKey: LayoutKeys, layoutName: string) {
  const newLayouts = getDeepCopyOfStoredLayouts();
  if (newLayouts[layoutKey] && newLayouts[layoutKey][layoutName]) {
    newLayouts[layoutKey][layoutName] = layoutConfig;
  }
  Store.dispatch(setStoredLayoutsAction(newLayouts));
  persistLayoutConfigsDebounced();
}

export function deleteLayout(layoutKey: LayoutKeys, layoutName: string) {
  const newLayouts = getDeepCopyOfStoredLayouts();
  if (newLayouts[layoutKey]) {
    delete newLayouts[layoutKey][layoutName];
  }
  Store.dispatch(setStoredLayoutsAction(newLayouts));
  persistLayoutConfigsDebounced();
}

export function addNewLayout(
  layoutKey: LayoutKeys,
  newLayoutName: string,
  configForLayout: Object,
): boolean {
  const newLayouts = getDeepCopyOfStoredLayouts();
  if (newLayouts[layoutKey] && newLayouts[layoutKey][newLayoutName]) {
    Toast.info("This layout name is already used.");
    return false;
  }
  if (newLayouts[layoutKey]) {
    newLayouts[layoutKey][newLayoutName] = configForLayout;
    // might happen during migration
    if (!newLayouts.LastActiveLayouts) {
      newLayouts.LastActiveLayouts = {};
    }
    newLayouts.LastActiveLayouts[layoutKey] = newLayoutName;
    Store.dispatch(setStoredLayoutsAction(newLayouts));
    persistLayoutConfigsDebounced();
    return true;
  }
  Toast.warning("Could not create a new Layout.");
  return false;
}

export function setActiveLayout(layoutKey: LayoutKeys, activeLayout: string) {
  const newLayouts = getDeepCopyOfStoredLayouts();
  if (newLayouts[layoutKey] && newLayouts[layoutKey][activeLayout]) {
    // might happen during migration
    if (!newLayouts.LastActiveLayouts) {
      newLayouts.LastActiveLayouts = {};
    }
    newLayouts.LastActiveLayouts[layoutKey] = activeLayout;
    Store.dispatch(setStoredLayoutsAction(newLayouts));
    persistLayoutConfigsDebounced();
  } else {
    throw new Error(
      `Active layout could not be set. The given layout ${layoutKey} was not found in layouts for
      ${mapLayoutKeysToLanguage[layoutKey]}`,
    );
  }
}
