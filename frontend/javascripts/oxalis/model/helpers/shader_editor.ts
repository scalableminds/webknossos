// @ts-nocheck
import app from "app";
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

  destroy() {
    window.materials = [];
    window.managers = [];
  },
};

function loadAceImpl(options, callback) {
  const load = function (path, loadCallback) {
    const head = document.getElementsByTagName("head")[0];
    let s = document.createElement("script");
    s.src = "https://ajaxorg.github.io/ace-builds/src-noconflict" + "/" + path;
    head.appendChild(s);
    s.onload = s.onreadystatechange = function (_, isAbort) {
      if (isAbort || !s.readyState || s.readyState === "loaded" || s.readyState === "complete") {
        s = s.onload = s.onreadystatechange = null;
        if (!isAbort) loadCallback();
      }
    };
  };
  load("ace.js", function () {
    ace.config.loadModule("ace/ext/textarea", function (m) {
      callback((el) => {
        if (!el.ace) {
          el.ace = m.transformTextarea(el, options);
        }
      });
    });
  });
}

const aceOptions = {
  selectionStyle: "line",
  highlightActiveLine: true,
  highlightSelectedWord: true,
  readOnly: false,
  copyWithEmptySelection: false,
  cursorStyle: "ace",
  mergeUndoDeltas: true,
  behavioursEnabled: true,
  wrapBehavioursEnabled: true,
  enableAutoIndent: true,
  keyboardHandler: null,
  showLineNumbers: true,
  enableKeyboardAccessibility: false,
  textInputAriaLabel: "",
  enableMobileMenu: true,
  highlightGutterLine: true,
  showInvisibles: false,
  showPrintMargin: false,
  printMarginColumn: 80,
  printMargin: false,
  fadeFoldWidgets: false,
  showFoldWidgets: true,
  displayIndentGuides: true,
  highlightIndentGuides: true,
  showGutter: true,
  fontSize: "14px",
  theme: "textmate",
  maxPixelHeight: 0,
  useTextareaForIME: true,
  useSvgGutterIcons: false,
  showFoldedAnnotations: false,
  dragDelay: 0,
  dragEnabled: true,
  focusTimeout: 0,
  tooltipFollowsMouse: true,
  firstLineNumber: 1,
  overwrite: false,
  newLineMode: "auto",
  useWorker: true,
  useSoftTabs: true,
  navigateWithinSoftTabs: false,
  tabSize: 4,
  wrap: "off",
  indentedSoftWrap: true,
  mode: "c_cpp",
  enableMultiselect: true,
  enableBlockSelect: true,
};

function loadAce() {
  const promise = new Promise((resolve) => {
    loadAceImpl(aceOptions, (transformFn) => {
      resolve(transformFn);
    });
  });
  return promise;
}

window._setupShaderEditor = (identifier, _shaderType) => {
  const outerContainer = document.createElement("div");
  const input = document.createElement("textarea");
  const shaderType = _shaderType || "fragmentShader";
  input.value = window.materials[identifier][shaderType];
  const button = document.createElement("button");
  const buttonContainer = document.createElement("div");

  function overrideShader() {
    window.materials[identifier][shaderType] = input.ace?.getValue() || input.value;
    window.materials[identifier].needsUpdate = true;
    app.vent.emit("rerender");
  }

  button.addEventListener("click", () => overrideShader());
  button.innerHTML = `Update ${shaderType}`;
  buttonContainer.appendChild(button);

  buttonContainer.setAttribute(
    "style",
    `
    position: absolute;
    z-index: 10000000000000;
    left: 20px;
`,
  );

  input.cols = "80";
  input.rows = "50";
  input.setAttribute(
    "style",
    `background: white;
     font-family: monospace;
    `,
  );
  input.addEventListener("keydown", (evt) => {
    if ((evt.keyCode === 10 || evt.keyCode === 13) && (evt.ctrlKey || event.metaKey)) {
      evt.preventDefault();
      overrideShader();
    }
  });
  outerContainer.setAttribute(
    "style",
    `position: absolute;
        top: ${shaderType === "fragmentShader" ? 0 : "50%"};
        right: 0px;
        z-index: 10000;
        `,
  );
  outerContainer.appendChild(buttonContainer);

  const dragIcon = document.createElement("div");
  dragIcon.innerHTML = '<i class="fas fa-grip-lines"></i>';
  dragIcon.setAttribute(
    "style",
    `position: absolute;
     top: 0;
     left: 0;
     width: 22px;
     height: 22px;
     cursor: grab;
     z-index: 1000000000`,
  );
  outerContainer.appendChild(dragIcon);

  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;

  dragIcon.addEventListener("mousedown", (e) => {
    isDragging = true;
    offsetX = e.clientX - outerContainer.offsetLeft;
    offsetY = e.clientY - outerContainer.offsetTop;
    dragIcon.style.cursor = "grabbing";
  });

  window.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    outerContainer.style.left = `${e.clientX - offsetX}px`;
    outerContainer.style.top = `${e.clientY - offsetY}px`;
  });

  window.addEventListener("mouseup", () => {
    if (isDragging) {
      isDragging = false;
      dragIcon.style.cursor = "grab";
    }
  });

  outerContainer.appendChild(input);
  document.body.appendChild(outerContainer);
  loadAce().then((transform) => {
    transform(input);

    input.ace.commands.addCommand({
      name: "Update Shader",
      bindKey: {
        win: "Ctrl-Enter",
        mac: "Command-Enter",
      },
      exec: overrideShader,
    });
  });
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
