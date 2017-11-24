/**
 * cube.js
 * @flow
 */

import _ from "lodash";
import app from "app";
import * as THREE from "three";
import BackboneEvents from "backbone-events-standalone";
import type { Vector3, OrthoViewMapType, OrthoViewType } from "oxalis/constants";
import { OrthoViews, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import dimensions from "oxalis/model/dimensions";
import Store from "oxalis/store";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";

type PropertiesType = {
  min?: Vector3,
  max: Vector3,
  lineWidth?: number,
  color?: number,
  showCrossSections?: boolean,
};

class Cube {
  crossSections: OrthoViewMapType<THREE.Line>;
  cube: THREE.Line;
  min: Vector3;
  max: Vector3;
  showCrossSections: boolean;
  initialized: boolean;
  visible: boolean;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

  constructor(properties: PropertiesType) {
    this.min = properties.min || [0, 0, 0];
    this.max = properties.max;
    const lineWidth = properties.lineWidth || 1;
    const color = properties.color || 0x000000;
    this.showCrossSections = properties.showCrossSections || false;

    _.extend(this, BackboneEvents);

    this.initialized = false;
    this.visible = true;

    const lineProperties = { color, linewidth: lineWidth };

    this.cube = new THREE.Line(new THREE.Geometry(), new THREE.LineBasicMaterial(lineProperties));

    this.crossSections = {};
    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.crossSections[planeId] = new THREE.Line(
        new THREE.Geometry(),
        new THREE.LineBasicMaterial(lineProperties),
      );
    }

    if (this.min != null && this.max != null) {
      this.setCorners(this.min, this.max);
    }

    Store.subscribe(() => {
      this.updatePosition(getPosition(Store.getState().flycam));
    });
  }

  setCorners(min1: Vector3, max1: Vector3) {
    this.min = min1;
    this.max = max1;
    const { min, max } = this;

    const vec = (x, y, z) => new THREE.Vector3(x, y, z);

    this.cube.geometry.vertices = [
      vec(min[0], min[1], min[2]),
      vec(min[0], max[1], min[2]),
      vec(max[0], max[1], min[2]),
      vec(max[0], min[1], min[2]),
      vec(max[0], min[1], max[2]),
      vec(max[0], max[1], max[2]),
      vec(min[0], max[1], max[2]),
      vec(min[0], min[1], max[2]),
      vec(min[0], min[1], min[2]),
      vec(max[0], min[1], min[2]),
      vec(max[0], max[1], min[2]),
      vec(max[0], max[1], max[2]),
      vec(max[0], min[1], max[2]),
      vec(min[0], min[1], max[2]),
      vec(min[0], max[1], max[2]),
      vec(min[0], max[1], min[2]),
    ];

    this.crossSections[OrthoViews.PLANE_XY].geometry.vertices = [
      vec(min[0], min[1], 0),
      vec(min[0], max[1], 0),
      vec(max[0], max[1], 0),
      vec(max[0], min[1], 0),
      vec(min[0], min[1], 0),
    ];

    this.crossSections[OrthoViews.PLANE_YZ].geometry.vertices = [
      vec(0, min[1], min[2]),
      vec(0, min[1], max[2]),
      vec(0, max[1], max[2]),
      vec(0, max[1], min[2]),
      vec(0, min[1], min[2]),
    ];

    this.crossSections[OrthoViews.PLANE_XZ].geometry.vertices = [
      vec(min[0], 0, min[2]),
      vec(min[0], 0, max[2]),
      vec(max[0], 0, max[2]),
      vec(max[0], 0, min[2]),
      vec(min[0], 0, min[2]),
    ];

    for (const mesh of _.values(this.crossSections).concat([this.cube])) {
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.verticesNeedUpdate = true;
    }

    this.initialized = true;
    this.updatePosition(getPosition(Store.getState().flycam));
    app.vent.trigger("rerender");
  }

  updatePosition(position: Vector3) {
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

  updateForCam(id: OrthoViewType) {
    if (!this.initialized) {
      return;
    }

    for (const planeId of OrthoViewValuesWithoutTDView) {
      const thirdDim = dimensions.thirdDimensionForPlane(planeId);
      const position = getPosition(Store.getState().flycam);
      if (position[thirdDim] >= this.min[thirdDim] && position[thirdDim] <= this.max[thirdDim]) {
        this.crossSections[planeId].visible =
          this.visible && planeId === id && this.showCrossSections;
      } else {
        this.crossSections[planeId].visible = false;
      }
    }

    this.cube.visible = this.visible && id === OrthoViews.TDView;
  }

  setVisibility(visible: boolean) {
    this.visible = visible;
  }
}

export default Cube;
