// @flow
import * as THREE from "three";

const renderer =
  typeof document !== "undefined" && document.getElementById
    ? new THREE.WebGLRenderer({
        canvas: document.getElementById("render-canvas"),
        antialias: true,
      })
    : {};

export default renderer;
