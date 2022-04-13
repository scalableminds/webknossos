// @ts-nocheck
import window, { document } from "libs/window";
export default {
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'textureBucketManager' implicitly has an... Remove this comment to see the full error message
  addBucketManagers(textureBucketManager) {
    // @ts-ignore
    window.managers = window.managers || [];
    // @ts-ignore
    window.managers.push(textureBucketManager);
  },

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'identifier' implicitly has an 'any' typ... Remove this comment to see the full error message
  addMaterial(identifier, material) {
    // @ts-ignore
    window.materials = window.materials || [];
    // @ts-ignore
    window.materials[identifier] = material;
  },
};

// @ts-expect-error ts-migrate(2339) FIXME: Property '_setupShaderEditor' does not exist on ty... Remove this comment to see the full error message
window._setupShaderEditor = (identifier, _shaderType) => {
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'createElement' does not exist on type 'D... Remove this comment to see the full error message
  const outer = document.createElement("div");
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'createElement' does not exist on type 'D... Remove this comment to see the full error message
  const input = document.createElement("textarea");
  const shaderType = _shaderType || "fragmentShader";
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'materials' does not exist on type '(Wind... Remove this comment to see the full error message
  input.value = window.materials[identifier][shaderType];
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'createElement' does not exist on type 'D... Remove this comment to see the full error message
  const button = document.createElement("button");
  // @ts-expect-error ts-migrate(2339) FIXME: Property 'createElement' does not exist on type 'D... Remove this comment to see the full error message
  const buttonContainer = document.createElement("div");

  function overrideShader() {
    // @ts-ignore
    window.materials[identifier][shaderType] = input.value;
    // @ts-ignore
    window.materials[identifier].needsUpdate = true;
    // @ts-ignore
    window.needsRerender = true;
  }

  button.addEventListener("click", () => overrideShader());
  button.innerHTML = "run";
  buttonContainer.appendChild(button);
  input.cols = "80";
  input.rows = "20";
  input.setAttribute(
    "style",
    `position: absolute;
        top: 0;
        right: 0px;
        z-index: 10000;
        background: white;
        font-family: monospace;
        `,
  );
  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'evt' implicitly has an 'any' type.
  input.addEventListener("keydown", (evt) => {
    if ((evt.keyCode === 10 || evt.keyCode === 13) && evt.ctrlKey) {
      evt.preventDefault();
      overrideShader();
    }
  });
  outer.appendChild(buttonContainer);
  buttonContainer.setAttribute(
    "style",
    `position: absolute;
        top: 0;
        left: 300px;
        z-index: 10000000;`,
  );
  outer.appendChild(input);
  // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
  document.body.appendChild(outer);
};
