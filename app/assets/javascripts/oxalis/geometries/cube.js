/**
 * cube.js
 * @flow weak
 */

import _ from "lodash";
import app from "app";
import * as THREE from "three";
import Backbone from "backbone";
import Model from "oxalis/model";
import type { Vector3, OrthoViewMapType } from "oxalis/constants";
import { OrthoViews, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import dimensions from "oxalis/model/dimensions";
import Store from "oxalis/store";
import { getPosition } from "oxalis/model/accessors/flycam3d_accessor";

class Cube {

  model: Model;
  crossSections: OrthoViewMapType<THREE.Line>;
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

    const lineProperties = { color, linewidth: lineWidth };

    this.cube = new THREE.Line(
      new THREE.Geometry(),
      new THREE.LineBasicMaterial(lineProperties));

    this.crossSections = {};
    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.crossSections[planeId] = new THREE.Line(
        new THREE.Geometry(),
        new THREE.LineBasicMaterial(lineProperties));
    }


    if ((this.min != null) && (this.max != null)) {
      this.setCorners(this.min, this.max);
    }

    Store.subscribe(() => {
      this.updatePosition(getPosition(Store.getState().flycam3d));
    });
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

    v = (this.crossSections[OrthoViews.PLANE_XY].geometry.vertices = []);
    v.push(vec(min[0], min[1], 0)); v.push(vec(min[0], max[1], 0));
    v.push(vec(max[0], max[1], 0)); v.push(vec(max[0], min[1], 0));
    v.push(vec(min[0], min[1], 0));

    v = (this.crossSections[OrthoViews.PLANE_YZ].geometry.vertices = []);
    v.push(vec(0, min[1], min[2])); v.push(vec(0, min[1], max[2]));
    v.push(vec(0, max[1], max[2])); v.push(vec(0, max[1], min[2]));
    v.push(vec(0, min[1], min[2]));

    v = (this.crossSections[OrthoViews.PLANE_XZ].geometry.vertices = []);
    v.push(vec(min[0], 0, min[2])); v.push(vec(min[0], 0, max[2]));
    v.push(vec(max[0], 0, max[2])); v.push(vec(max[0], 0, min[2]));
    v.push(vec(min[0], 0, min[2]));

    for (const mesh of _.values(this.crossSections).concat([this.cube])) {
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.verticesNeedUpdate = true;
    }

    this.initialized = true;
    this.updatePosition(getPosition(Store.getState().flycam3d));
    app.vent.trigger("rerender");
  }

  updatePosition(position) {
    if (!this.initialized) {
      return;
    }

    for (const planeId of OrthoViewValuesWithoutTDView) {
      const thirdDim = dimensions.thirdDimensionForPlane(planeId);
      const geometry = this.crossSections[planeId].geometry;
      for (const vertex of geometry.vertices) {
        const array = vertex.toArray();
        array[thirdDim] = position[thirdDim];
        vertex.fromArray(array);
      }

      geometry.computeBoundingSphere();
      geometry.verticesNeedUpdate = true;
    }
  }

  getMeshes() {
    return [this.cube].concat(_.values(this.crossSections));
  }

  updateForCam(id) {
    if (!this.initialized) {
      return;
    }

    for (const planeId of OrthoViewValuesWithoutTDView) {
      const thirdDim = dimensions.thirdDimensionForPlane(planeId);
      const position = getPosition(Store.getState().flycam3d);
      if (position[thirdDim] >= this.min[thirdDim] && position[thirdDim] <= this.max[thirdDim]) {
        this.crossSections[planeId].visible = this.visible && (planeId === id) && this.showCrossSections;
      } else {
        this.crossSections[planeId].visible = false;
      }
    }

    this.cube.visible = this.visible && (id === OrthoViews.TDView);
  }

  setVisibility(visible) {
    this.visible = visible;
  }
}


export default Cube;
