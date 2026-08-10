import { sendAnalyticsEvent } from "admin/rest_api";
import { Button } from "antd";
import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import { sleep } from "libs/utils";
import messages from "messages";
import type * as React from "react";
import Constants from "viewer/constants";
import { getWebGlAnalyticsInformation, wasContextLossForced } from "viewer/controller/renderer";
import {
  setViewModeAction,
  updateDatasetSettingAction,
  updateUserSettingAction,
} from "viewer/model/actions/settings_actions";
import { getGpuFactorsWithLabels } from "viewer/model/bucket_data_handling/data_rendering_logic";
import { api } from "viewer/singletons";
import Store from "viewer/store";

const WEBGL_CONTEXT_LOST_KEY = "WEBGL_CONTEXT_LOST_KEY";

// @ts-expect-error ts-migrate(7006) FIXME: Parameter 'canvas' implicitly has an 'any' type.
const registerWebGlCrashHandler = (canvas) => {
  if (!canvas) {
    return;
  }

  canvas.addEventListener(
    "webglcontextlost",
    (e: MessageEvent) => {
      e.preventDefault();
      if (wasContextLossForced()) {
        // The context loss was triggered intentionally during teardown (see
        // destroyRenderer) to release the GPU memory deterministically.
        // Don't treat it as a crash.
        return;
      }
      console.error("Webgl context lost", e);
      ErrorHandling.notify(new Error("WebGLContextLost"));
      sendAnalyticsEvent("webgl_context_lost", getWebGlAnalyticsInformation(Store.getState()));

      // The hardware utilization setting (gpuMemoryFactor) is persisted per user account and
      // shared across devices. A setting that works well on a high-end machine may be too
      // demanding on a weaker device, causing a WebGL context loss on the next login.
      // To help the user recover, we offer a one-click button in the error toast that steps
      // down to the next lower hardware utilization tier, persists the change to the server
      // (so it survives the reload), and then reloads the page.
      const state = Store.getState();
      const currentGpuFactor =
        state.userConfiguration.gpuMemoryFactor || Constants.DEFAULT_GPU_MEMORY_FACTOR;
      // getGpuFactorsWithLabels returns factors in descending order, so the first entry
      // strictly lower than the current factor is the next step down.
      const lowerUtilizationEntry = getGpuFactorsWithLabels().find(
        ([factorStr]) => Number(factorStr) < currentGpuFactor,
      );

      const handleReduceAndReload = async () => {
        Toast.close(WEBGL_CONTEXT_LOST_KEY);
        if (lowerUtilizationEntry) {
          const lowerGpuFactor = Number(lowerUtilizationEntry[0]);
          Store.dispatch(updateUserSettingAction("gpuMemoryFactor", lowerGpuFactor));
        }
        await sleep(2 * Constants.SETTING_SAVE_DEBOUNCE_MS);
        location.reload();
      };

      const recoveryButton = (
        <Button size="small" onClick={handleReduceAndReload}>
          {lowerUtilizationEntry != null
            ? `Reduce Hardware Utilization to "${lowerUtilizationEntry[1]}" & Reload`
            : "Reload Page"}
        </Button>
      );

      Toast.error(messages["webgl.context_loss"], {
        sticky: true,
        key: WEBGL_CONTEXT_LOST_KEY,
        customFooter: recoveryButton,
      });
    },
    false,
  );

  canvas.addEventListener(
    "webglcontextrestored",
    (e: MessageEvent) => {
      e.preventDefault();

      // WebGL context losses are often caused by graphics driver issues during shader compilation.
      // Try again with a more simple shader by turning off the interpolation setting.
      if (Store.getState().datasetConfiguration.interpolation) {
        Store.dispatch(updateDatasetSettingAction("interpolation", false));
        Toast.info(
          "Disabled interpolation setting to simplify WebGL shader and avoid WebGL context losses.",
        );
      }

      // To bring webKnossos back to life, switching the current view mode
      // to another one and then switching back proved to be the most robust way,
      // even though it seems a bit hacky.
      const currentViewMode = Store.getState().temporaryConfiguration.viewMode;
      const { allowedModes } = Store.getState().annotation.restrictions;
      const index = (allowedModes.indexOf(currentViewMode) + 1) % allowedModes.length;
      const newViewMode = allowedModes[index];
      console.log(
        "Trying to recover from WebGL context loss by switching to",
        allowedModes[index],
        "...",
      );
      Store.dispatch(setViewModeAction(newViewMode));

      setTimeout(() => {
        console.log("... and switching back to", currentViewMode);
        Store.dispatch(setViewModeAction(currentViewMode));
      }, 1000);

      // Also reload all buckets to ensure that the buckets are all available on the
      // GPU.
      api.data.reloadAllBuckets();

      Toast.close(WEBGL_CONTEXT_LOST_KEY);
      Toast.info(messages["webgl.context_recovery"], { timeout: 10000 });
    },
    false,
  );
};

export default function TracingView() {
  const handleContextMenu = (event: React.SyntheticEvent) => {
    // hide context menu, while right-clicking a canvas
    event.preventDefault();
  };

  const canvasStyle = {
    width: "100%",
    position: "absolute",
    top: 0,
    left: 0,
  } as const;
  return (
    <div onContextMenu={handleContextMenu}>
      <canvas
        ref={registerWebGlCrashHandler}
        key="render-canvas"
        id="render-canvas"
        style={canvasStyle}
      />
    </div>
  );
}
