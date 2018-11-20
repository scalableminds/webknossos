import window, { document } from "libs/window";

export default {
  addBucketManagers(textureBucketManager) {
    window.managers = window.managers || [];
    window.managers.push(textureBucketManager);
  },

  addMaterial(viewMode, material) {
    window.materials = window.materials || [];
    window.materials[viewMode] = material;
  },
};

window._setupShaderEditor = viewport => {
  const outer = document.createElement("div");
  const input = document.createElement("textarea");
  input.value = window.materials[viewport].fragmentShader;
  const button = document.createElement("button");
  const buttonContainer = document.createElement("div");
  function overrideShader() {
    window.materials[viewport].fragmentShader = input.value;
    window.materials[viewport].needsUpdate = true;
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
        background: white;`,
  );
  input.addEventListener("keydown", evt => {
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

  document.body.appendChild(outer);
};
