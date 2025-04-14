import ErrorHandling from "libs/error_handling";
import Toast from "libs/toast";
import messages from "messages";
import { setViewModeAction } from "oxalis/model/actions/settings_actions";
import { api } from "oxalis/singletons";
import Store from "oxalis/store";
import type * as React from "react";

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
      Toast.error(messages["webgl.context_loss"], {
        sticky: true,
        key: WEBGL_CONTEXT_LOST_KEY,
      });
      console.error("Webgl context lost", e);
      ErrorHandling.notify(new Error("WebGLContextLost"));
    },
    false,
  );

  canvas.addEventListener(
    "webglcontextrestored",
    (e: MessageEvent) => {
      e.preventDefault();

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
