// @flow
import _ from "lodash";
import NanoEvents from "nanoevents";
import { setStoredLayoutsAction } from "oxalis/model/actions/ui_actions";
import Store from "oxalis/store";
import Toast from "libs/toast";
import defaultLayouts, {
  currentLayoutVersion,
  defaultLayoutSchema,
  lastUsedLayout,
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

layoutEmitter.on("resetLayout", (layoutKey: LayoutKeys, activeLayout: string) => {
  storeLayoutConfig(defaultLayouts[layoutKey], layoutKey, activeLayout);
  layoutEmitter.emit("reloadLayout");
});

const persistLayoutConfigsDebounced = _.debounce(persistLayoutConfigs, 1000);

export function getLayoutConfig(layoutKey: LayoutKeys, activeLayoutName: string) {
  const storedLayouts = Store.getState().uiInformation.storedLayouts;
  if (!storedLayouts[layoutKey]) {
    return defaultLayouts[layoutKey];
  }
  const layout = storedLayouts[layoutKey][activeLayoutName];
  if (!layout) {
    return defaultLayouts[layoutKey];
  }
  // Use default dimensions and settings
  const { dimensions, settings } = defaultLayouts[layoutKey];
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
    newLayouts[layoutKey][lastUsedLayout] = newLayoutName;
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
    newLayouts[layoutKey][lastUsedLayout] = activeLayout;
    Store.dispatch(setStoredLayoutsAction(newLayouts));
    persistLayoutConfigsDebounced();
  }
}
