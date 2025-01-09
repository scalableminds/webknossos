import app from "app";
// @ts-nocheck
import window, { document } from "libs/window";

export default {
  addBucketManagers(textureBucketManager) {
    window.managers = window.managers || [];
    window.managers.push(textureBucketManager);
  },

  addMaterial(identifier, material) {
    window.materials = window.materials || [];
    window.materials[identifier] = material;
  },
};

window._setupShaderEditor = (identifier, _shaderType) => {
  const outer = document.createElement("div");
  const input = document.createElement("textarea");
  const shaderType = _shaderType || "fragmentShader";
  input.value = window.materials[identifier][shaderType];
  const button = document.createElement("button");
  const buttonContainer = document.createElement("div");

  function overrideShader() {
    window.materials[identifier][shaderType] = input.value;
    window.materials[identifier].needsUpdate = true;
    app.vent.emit("rerender");
  }

  button.addEventListener("click", () => overrideShader());
  button.innerHTML = "run";
  buttonContainer.appendChild(button);
  input.cols = "80";
  input.rows = "20";
  input.setAttribute(
    "style",
    `position: absolute;
        top: ${shaderType === "fragmentShader" ? 0 : "50%"};
        right: 0px;
        z-index: 10000;
        background: white;
        font-family: monospace;
        `,
  );
  input.addEventListener("keydown", (evt) => {
    if ((evt.keyCode === 10 || evt.keyCode === 13) && (evt.ctrlKey || event.metaKey)) {
      evt.preventDefault();
      overrideShader();
    }
  });
  outer.appendChild(buttonContainer);
  buttonContainer.setAttribute(
    "style",
    `position: absolute;
        top: 40px;
        left: 300px;
        z-index: 10000000;`,
  );
  outer.appendChild(input);
  document.body.appendChild(outer);
};

window._setupShaderReporting = () => {
  const oldError = console.error;

  console.error = (...args) => {
    if (args.length === 1 && typeof args[0] === "string") {
      const errorsByLineNum: Record<string, string> = {};
      const linesByLineNum: Record<string, string> = {};
      for (const line of args[0].split("\n")) {
        if (line.startsWith("ERROR")) {
          const lineNum = line.split(":")[2];
          errorsByLineNum[lineNum] = line;
        }
      }
      for (const line of args[0].split("\n")) {
        const maybeLineNum = line.split(":")[0];
        if (!isNaN(Number.parseInt(maybeLineNum))) {
          if (linesByLineNum[maybeLineNum] != null) {
            // Sometimes errors appear in fragment as well as vertex shaders. Simply
            // show both.
            linesByLineNum[maybeLineNum] += "\nor:\n" + line;
          } else {
            linesByLineNum[maybeLineNum] = line;
          }
        }
      }

      for (const errorLineNum of Object.keys(errorsByLineNum)) {
        oldError(
          `Error ${errorsByLineNum[errorLineNum]}. Context:\n\n${linesByLineNum[errorLineNum]}`,
        );
      }
      if (Object.keys(errorsByLineNum).length > 0) {
        return;
      }
    }

    oldError(...args);
  };
};

if (process.env.NODE_ENV !== "production") {
  window._setupShaderReporting();
}
