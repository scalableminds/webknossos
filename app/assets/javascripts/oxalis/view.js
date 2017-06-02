/**
 * view.js
 * @flow weak
 */

import $ from "jquery";
import app from "app";
import * as THREE from "three";
import constants from "oxalis/constants";
import Toast from "libs/toast";
import messages from "messages";

class View {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  theme: 0 | 1;

  constructor() {
    if (!this.isWebGlSupported()) {
      Toast.error(messages["webgl.disabled"]);
    }

    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById("render-canvas"),
      antialias: true,
    });
    this.scene = new THREE.Scene();

    this.setTheme(constants.THEME_BRIGHT);

    // disable loader
    $("#loader").addClass("hidden");
  }

  isWebGlSupported() {
    return window.WebGLRenderingContext && document.createElement("canvas").getContext("experimental-webgl");
  }

  toggleTheme() {
    if (this.theme === constants.THEME_BRIGHT) {
      return this.setTheme(constants.THEME_DARK);
    } else {
      return this.setTheme(constants.THEME_BRIGHT);
    }
  }


  setTheme(theme) {
    this.theme = theme;
    app.vent.trigger("view:setTheme", theme);

    if (theme === constants.THEME_BRIGHT) {
      return $("body").attr("class", "bright");
    } else {
      return $("body").attr("class", "dark");
    }
  }


}

export default View;
