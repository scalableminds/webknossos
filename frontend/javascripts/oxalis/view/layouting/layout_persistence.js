// @flow
import NanoEvents from "nanoevents";
import _ from "lodash";

import getDefaultLayouts, {
  getCurrentDefaultLayoutConfig,
  mapLayoutKeysToLanguage,
  type LayoutKeys,
} from "oxalis/view/layouting/default_layout_configs";
import { setStoredLayoutsAction } from "oxalis/model/actions/ui_actions";
import Store from "oxalis/store";
import Toast from "libs/toast";

export const layoutEmitter = new NanoEvents();

export const localStorageKeys = {
  currentLayoutVersion: "currentLayoutVersion",
  goldenWkLayouts: "goldenWkLayouts",
};

layoutEmitter.on("resetLayout", (layoutKey: LayoutKeys, activeLayout: string) => {
  storeLayoutConfig(getDefaultLayouts()[layoutKey], layoutKey, activeLayout);
});

export function getLayoutConfig(layoutKey: LayoutKeys, activeLayoutName: string) {
  const { storedLayouts } = Store.getState().uiInformation;
  if (!storedLayouts || !storedLayouts[layoutKey]) {
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

function getDeepCopyOfStoredLayouts(): ?Object {
  const currentLayouts = Store.getState().uiInformation.storedLayouts;
  return _.cloneDeep(currentLayouts);
}

export function storeLayoutConfig(layoutConfig: Object, layoutKey: LayoutKeys, layoutName: string) {
  const newLayouts = getDeepCopyOfStoredLayouts();
  if (newLayouts == null) {
    return;
  }
  if (newLayouts[layoutKey] && newLayouts[layoutKey][layoutName]) {
    newLayouts[layoutKey][layoutName] = layoutConfig;
  }
  Store.dispatch(setStoredLayoutsAction(newLayouts));
}

export function deleteLayout(layoutKey: LayoutKeys, layoutName: string) {
  const newLayouts = getDeepCopyOfStoredLayouts();
  if (newLayouts == null) {
    return;
  }
  if (newLayouts[layoutKey]) {
    delete newLayouts[layoutKey][layoutName];
  }
  Store.dispatch(setStoredLayoutsAction(newLayouts));
}

export function addNewLayout(
  layoutKey: LayoutKeys,
  newLayoutName: string,
  configForLayout: Object,
): boolean {
  const newLayouts = getDeepCopyOfStoredLayouts();
  if (newLayouts == null) {
    return false;
  }
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
    return true;
  }
  Toast.warning("Could not create a new Layout.");
  return false;
}

export function setActiveLayout(layoutKey: LayoutKeys, activeLayout: string) {
  const newLayouts = getDeepCopyOfStoredLayouts();
  if (newLayouts == null) {
    return;
  }
  if (newLayouts[layoutKey] && newLayouts[layoutKey][activeLayout]) {
    // might happen during migration
    if (!newLayouts.LastActiveLayouts) {
      newLayouts.LastActiveLayouts = {};
    }
    newLayouts.LastActiveLayouts[layoutKey] = activeLayout;
    Store.dispatch(setStoredLayoutsAction(newLayouts));
  } else {
    throw new Error(
      `Active layout could not be set. The given layout ${layoutKey} was not found in layouts for
      ${mapLayoutKeysToLanguage[layoutKey]}`,
    );
  }
}
