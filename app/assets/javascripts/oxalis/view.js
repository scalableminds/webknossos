/**
 * view.js
 * @flow weak
 */

import $ from "jquery";
import * as THREE from "three";
import Toast from "libs/toast";
import messages from "messages";

class View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;

  constructor() {
    if (!this.isWebGlSupported()) {
      Toast.error(messages["webgl.disabled"]);
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById("render-canvas"),
      antialias: true,
    });
    this.scene = new THREE.Scene();

    // disable loader
    $("#loader").addClass("hidden");
  }

  isWebGlSupported() {
    return window.WebGLRenderingContext && document.createElement("canvas").getContext("experimental-webgl");
  }
}

export default View;
