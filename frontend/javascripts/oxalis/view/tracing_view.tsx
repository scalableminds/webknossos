import * as React from "react";
import Toast from "libs/toast";
import messages from "messages";
import ErrorHandling from "libs/error_handling";

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
      ErrorHandling.notify(e);
    },
    false,
  );

  canvas.addEventListener(
    "webglcontextrestored",
    (e: MessageEvent) => {
      e.preventDefault();
      Toast.close(WEBGL_CONTEXT_LOST_KEY);
    },
    false,
  );
};

export default function TracingView() {
  const handleContextMenu = (event: React.SyntheticEvent) => {
    // hide contextmenu, while rightclicking a canvas
    event.preventDefault();
  };

  const canvasStyle = {
    width: "100%",
    position: "absolute",
    top: 0,
    left: 0,
  };
  return (
    <div onContextMenu={handleContextMenu}>
      <canvas
        ref={registerWebGlCrashHandler}
        key="render-canvas"
        id="render-canvas"
        // @ts-expect-error ts-migrate(2322) FIXME: Type '{ width: string; position: string; top: numb... Remove this comment to see the full error message
        style={canvasStyle}
      />
    </div>
  );
}
