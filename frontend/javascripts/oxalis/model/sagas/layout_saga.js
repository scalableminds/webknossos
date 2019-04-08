// @flow
import {
  type Saga,
  call,
  fork,
  race,
  put,
  select,
  take,
} from "oxalis/model/sagas/effect-generators";
import { delay } from "redux-saga";
import {
  currentLayoutVersion,
  getCurrentDefaultLayoutConfig,
} from "oxalis/view/layouting/default_layout_configs";
import { getIsInIframe } from "libs/utils";
import { getLayoutConfiguration, updateLayoutConfiguration } from "admin/admin_rest_api";
import { localStorageKeys } from "oxalis/view/layouting/layout_persistence";
import { setStoredLayoutsAction } from "oxalis/model/actions/ui_actions";

// For debugging purposes:
const disableLayoutPersistance = false;

function* storeLayout(): Saga<void> {
  if (getIsInIframe()) {
    // Don't persist layout in iframe
    return;
  }
  const storedLayouts = yield* select(state => state.uiInformation);

  yield* call(
    updateLayoutConfiguration,
    JSON.stringify({
      [localStorageKeys.goldenWkLayouts]: storedLayouts,
      [localStorageKeys.currentLayoutVersion]: currentLayoutVersion,
    }),
  );
}

const debounce = (ms, pattern, task, ...args) =>
  fork(function* saga() {
    while (true) {
      let action = yield take(pattern);

      while (true) {
        const { debounced, _action } = yield* race({
          debounced: delay(ms),
          _action: take(pattern),
        });

        if (debounced) {
          yield* fork(task, ...args, action);
          break;
        }

        action = _action;
      }
    }
  });

function* debouncedWatchLayout(): Saga<void> {
  yield debounce(1000, "SET_STORED_LAYOUTS", storeLayout);
}

function* getPersistedLayoutConfigs(): Saga<Object> {
  const serverLayoutObject = (yield* call(getLayoutConfiguration)) || {};

  const storedLayoutVersion = serverLayoutObject[localStorageKeys.currentLayoutVersion];
  const defaultLayoutConfig = getCurrentDefaultLayoutConfig();
  if (getIsInIframe() || !storedLayoutVersion || disableLayoutPersistance) {
    return defaultLayoutConfig;
  }
  const layoutString = serverLayoutObject[localStorageKeys.goldenWkLayouts];
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
      // migrate to newest schema
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

function* initializeLayoutConfig(): Saga<void> {
  const layoutConfig = yield* call(getPersistedLayoutConfigs);
  yield* put(setStoredLayoutsAction(layoutConfig));
}

export default function* layoutRootSaga(): Saga<void> {
  yield* take("WK_READY");
  // Initialize the layout config (blocking)
  yield* call(initializeLayoutConfig);

  // Afterwards, save layout on each change
  yield* fork(debouncedWatchLayout);
}
