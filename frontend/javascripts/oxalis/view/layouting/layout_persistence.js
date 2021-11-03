// @flow
import { createNanoEvents } from "nanoevents";
import _ from "lodash";

import { getIsInIframe } from "libs/utils";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { setStoredLayoutsAction } from "oxalis/model/actions/ui_actions";
import Store from "oxalis/store";
import Toast from "libs/toast";
import UserLocalStorage from "libs/user_local_storage";

import getDefaultLayouts, {
  currentLayoutVersion,
  getCurrentDefaultLayoutConfig,
  mapLayoutKeysToLanguage,
  type LayoutKeys,
} from "./default_layout_configs";

export const layoutEmitter = createNanoEvents();

// For debugging purposes:
const disableLayoutPersistance = false;

const localStorageKeys = {
  currentLayoutVersion: "currentLayoutVersion",
  wkFlexLayouts: "wkFlexLayouts",
  outdatedGoldenWkLayouts: "goldenWkLayouts",
};

function readStoredLayoutConfigs() {
  const storedLayoutVersion = UserLocalStorage.getItem(
    localStorageKeys.currentLayoutVersion,
    false,
  );
  const defaultLayoutConfig = getCurrentDefaultLayoutConfig();
  if (getIsInIframe() || !storedLayoutVersion || disableLayoutPersistance) {
    return defaultLayoutConfig;
  }
  // Remove the old golden layout layouts.
  UserLocalStorage.removeItem(localStorageKeys.outdatedGoldenWkLayouts, false);
  const layoutString = UserLocalStorage.getItem(localStorageKeys.wkFlexLayouts, false);
  if (!layoutString) {
    return defaultLayoutConfig;
  }
  try {
    const version = JSON.parse(storedLayoutVersion);
    const layouts = JSON.parse(layoutString);
    if (currentLayoutVersion !== version) {
      return defaultLayoutConfig;
    }
    if (
      layouts.OrthoLayoutView &&
      layouts.VolumeTracingView &&
      layouts.ArbitraryLayout &&
      layouts.OrthoLayout &&
      layouts.OrthoLayout2d &&
      layouts.VolumeTracingView2d &&
      layouts.OrthoLayoutView2d
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

listenToStoreProperty(
  storeState => storeState.activeUser,
  () => {
    Store.dispatch(setStoredLayoutsAction(readStoredLayoutConfigs()));
  },
  true,
);

function persistLayoutConfigs() {
  if (getIsInIframe()) {
    // Don't persist layout in iframe
    return;
  }
  const { storedLayouts } = Store.getState().uiInformation;
  UserLocalStorage.setItem(localStorageKeys.wkFlexLayouts, JSON.stringify(storedLayouts), false);
  UserLocalStorage.setItem(
    localStorageKeys.currentLayoutVersion,
    JSON.stringify(currentLayoutVersion),
    false,
  );
}

layoutEmitter.on("resetLayout", (layoutKey: LayoutKeys, activeLayout: string) => {
  storeLayoutConfig(getDefaultLayouts()[layoutKey], layoutKey, activeLayout);
});

const persistLayoutConfigsDebounced = _.debounce(persistLayoutConfigs, 1000);

export function getLayoutConfig(layoutKey: LayoutKeys, activeLayoutName: string) {
  const { storedLayouts } = Store.getState().uiInformation;
  if (!storedLayouts[layoutKey]) {
    return getDefaultLayouts()[layoutKey];
  }
  const layout = storedLayouts[layoutKey][activeLayoutName];
  if (!layout) {
    return getDefaultLayouts()[layoutKey];
  }
  return layout;
}

export function getLastActiveLayout(layoutKey: LayoutKeys) {
  const { storedLayouts } = Store.getState().uiInformation;
  if (storedLayouts.LastActiveLayouts && storedLayouts.LastActiveLayouts[layoutKey]) {
    return storedLayouts.LastActiveLayouts[layoutKey];
  } else {
    // added as a fallback when there are no stored last active layouts
    const firstStoredLayout = Object.keys(storedLayouts[layoutKey])[0];
    return firstStoredLayout;
  }
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
    newLayouts.LastActiveLayouts[layoutKey] = activeLayout;
    Store.dispatch(setStoredLayoutsAction(newLayouts));
    persistLayoutConfigsDebounced();
  } else {
    throw new Error(
      `Active layout could not be set. The given layout ${layoutKey}  with name ${activeLayout}
      was not found in layouts for ${mapLayoutKeysToLanguage[layoutKey]}.`,
    );
  }
}
