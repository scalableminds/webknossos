// @flow
import _ from "lodash";
import defaultLayouts, { currentLayoutVersion } from "./default_layout_configs";
import type { LayoutKeysType } from "./default_layout_configs";

function readStoredLayoutConfigs() {
  const storedLayoutVersion = localStorage.getItem("currentLayoutVersion");
  if (!storedLayoutVersion) {
    return {};
  }
  if (currentLayoutVersion > JSON.parse(storedLayoutVersion)) {
    return {};
  }
  const layoutString = localStorage.getItem("golden-wk-layouts");
  return layoutString ? JSON.parse(layoutString) : {};
}

function persistLayoutConfigs() {
  localStorage.setItem("golden-wk-layouts", JSON.stringify(storedLayouts));
  localStorage.setItem("currentLayoutVersion", JSON.stringify(currentLayoutVersion));
}

const persistLayoutConfigsDebounced = _.debounce(persistLayoutConfigs, 2000);

export function getLayoutConfig(layoutKey: LayoutKeysType) {
  const restoreLayout = false;

  if (storedLayouts[layoutKey]) {
    return storedLayouts[layoutKey];
  }

  return defaultLayouts[layoutKey];
}

const storedLayouts = readStoredLayoutConfigs();

export function storeLayoutConfig(layoutConfig: Object, layoutKey: string) {
  storedLayouts[layoutKey] = layoutConfig;
  persistLayoutConfigsDebounced();
}
