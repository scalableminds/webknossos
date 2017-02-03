/**
 * cube.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import THREE from "three";
import Backbone from "backbone";
import Model from "oxalis/model";
import type { Vector3 } from "oxalis/constants";
import constants from "../constants";
import dimensions from "../model/dimensions";

class Cube {

  model: Model;
  crossSections: Array<THREE.Line>;
  cube: THREE.Line;
  min: Vector3;
  max: Vector3;
  showCrossSections: boolean;
  initialized: boolean;
  visible: boolean;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(model: Model, properties) {
    this.model = model;
    this.min = properties.min || [0, 0, 0];
    this.max = properties.max;
    const lineWidth = properties.lineWidth || 1;
    const color = properties.color || 0x000000;
    this.showCrossSections = properties.showCrossSections || false;

    _.extend(this, Backbone.Events);

    this.initialized = false;
    this.visible = true;

    this.listenTo(this.model.flycam, "positionChanged", pos => this.updatePosition(pos));

    const lineProperties = { color, linewidth: lineWidth };

    this.cube = new THREE.Line(
      new THREE.Geometry(),
      new THREE.LineBasicMaterial(lineProperties));

    this.crossSections = [];
    constants.ALL_PLANES.forEach(() => {
      this.crossSections.push(
        new THREE.Line(
          new THREE.Geometry(),
          new THREE.LineBasicMaterial(lineProperties)));
    });


    if ((this.min != null) && (this.max != null)) {
      this.setCorners(this.min, this.max);
    }
  }

  setCorners(min1, max1) {
    this.min = min1;
    this.max = max1;
    const { min, max } = this;

    const vec = (x, y, z) => new THREE.Vector3(x, y, z);

    let v = (this.cube.geometry.vertices = []);
    v.push(vec(min[0], min[1], min[2])); v.push(vec(min[0], max[1], min[2]));
    v.push(vec(max[0], max[1], min[2])); v.push(vec(max[0], min[1], min[2]));
    v.push(vec(max[0], min[1], max[2])); v.push(vec(max[0], max[1], max[2]));
    v.push(vec(min[0], max[1], max[2])); v.push(vec(min[0], min[1], max[2]));
    v.push(vec(min[0], min[1], min[2])); v.push(vec(max[0], min[1], min[2]));
    v.push(vec(max[0], max[1], min[2])); v.push(vec(max[0], max[1], max[2]));
    v.push(vec(max[0], min[1], max[2])); v.push(vec(min[0], min[1], max[2]));
    v.push(vec(min[0], max[1], max[2])); v.push(vec(min[0], max[1], min[2]));

    v = (this.crossSections[constants.PLANE_XY].geometry.vertices = []);
    v.push(vec(min[0], min[1], 0)); v.push(vec(min[0], max[1], 0));
    v.push(vec(max[0], max[1], 0)); v.push(vec(max[0], min[1], 0));
    v.push(vec(min[0], min[1], 0));

    v = (this.crossSections[constants.PLANE_YZ].geometry.vertices = []);
    v.push(vec(0, min[1], min[2])); v.push(vec(0, min[1], max[2]));
    v.push(vec(0, max[1], max[2])); v.push(vec(0, max[1], min[2]));
    v.push(vec(0, min[1], min[2]));

    v = (this.crossSections[constants.PLANE_XZ].geometry.vertices = []);
    v.push(vec(min[0], 0, min[2])); v.push(vec(min[0], 0, max[2]));
    v.push(vec(max[0], 0, max[2])); v.push(vec(max[0], 0, min[2]));
    v.push(vec(min[0], 0, min[2]));

    for (const mesh of this.crossSections.concat([this.cube])) {
      mesh.geometry.verticesNeedUpdate = true;
    }

    this.initialized = true;
    this.updatePosition(this.model.flycam.getPosition());
    app.vent.trigger("rerender");
  }

  updatePosition(position) {
    if (!this.initialized) {
      return;
    }

    for (const i of constants.ALL_PLANES) {
      const thirdDim = dimensions.thirdDimensionForPlane(i);
      const geo = this.crossSections[i].geometry;
      for (const j of Utils.__range__(0, geo.vertices.length, false)) {
        const array = geo.vertices[j].toArray();
        array[thirdDim] = position[thirdDim];
        geo.vertices[j] = new THREE.Vector3(array[0], array[1], array[2]);
      }

      geo.verticesNeedUpdate = true;
    }
  }

  getMeshes() {
    return [this.cube].concat(this.crossSections);
  }

  updateForCam(id) {
    if (!this.initialized) {
      return;
    }

    for (let i = 0; i <= 2; i++) {
      const thirdDim = dimensions.thirdDimensionForPlane(i);
      const position = this.model.flycam.getPosition();
      if (position[thirdDim] >= this.min[thirdDim] && position[thirdDim] <= this.max[thirdDim]) {
        this.crossSections[i].visible = this.visible && (i === id) && this.showCrossSections;
      } else {
        this.crossSections[i].visible = false;
      }
    }

    this.cube.visible = this.visible && (id === constants.TDView);
  }

  setVisibility(visible) {
    this.visible = visible;
  }
}


export default Cube;
