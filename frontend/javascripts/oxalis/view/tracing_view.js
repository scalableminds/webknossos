// @flow
import * as React from "react";

import Toast from "libs/toast";
import messages from "messages";

const registerWebGlCrashHandler = canvas => {
  if (!canvas) {
    return;
  }
  canvas.addEventListener(
    "webglcontextlost",
    e => {
      Toast.error(messages["webgl.context_loss"], { sticky: true });
      console.error("Webgl context lost", e);
    },
    false,
  );
};

export default function TracingView() {
  const handleContextMenu = (event: SyntheticInputEvent<>) => {
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
        style={canvasStyle}
      />
    </div>
  );
}
