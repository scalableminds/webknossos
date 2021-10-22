/**
 * cube.js
 * @flow
 */

import * as THREE from "three";
import _ from "lodash";

import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import {
  type OrthoView,
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  type Vector3,
} from "oxalis/constants";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import Store from "oxalis/throttled_store";
import app from "app";
import dimensions from "oxalis/model/dimensions";

type Properties = {
  min?: Vector3,
  max: Vector3,
  lineWidth?: number,
  color?: number,
  showCrossSections?: boolean,
  id?: number,
  isHighlighted: boolean,
};

class Cube {
  crossSections: OrthoViewMap<typeof THREE.Line>;

  cube: typeof THREE.Line;
  min: Vector3;
  max: Vector3;
  showCrossSections: boolean;
  initialized: boolean;
  visible: boolean;
  lineWidth: number;
  color: number;
  id: ?number;
  isHighlighted: boolean;

  constructor(properties: Properties) {
    // min/max should denote a half-open interval.
    this.min = properties.min || [0, 0, 0];
    this.max = properties.max;
    this.lineWidth = properties.lineWidth != null ? properties.lineWidth : 1;
    this.color = properties.color || 0x000000;
    this.showCrossSections = properties.showCrossSections || false;
    this.id = properties.id;

    this.initialized = false;
    this.visible = true;
    this.isHighlighted = properties.isHighlighted;

    this.cube = new THREE.Line(new THREE.Geometry(), this.getLineMaterial());

    this.crossSections = {};
    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.crossSections[planeId] = new THREE.Line(new THREE.Geometry(), this.getLineMaterial());
    }

    if (this.min != null && this.max != null) {
      this.setCorners(this.min, this.max);
    }

    listenToStoreProperty(
      state => getPosition(state.flycam),
      position => this.updatePosition(position),
    );
  }

  getLineMaterial() {
    return this.isHighlighted
      ? new THREE.LineBasicMaterial({ color: 0xffffff, linewidth: this.lineWidth })
      : new THREE.LineBasicMaterial({ color: this.color, linewidth: this.lineWidth });
  }

  setCorners(min: Vector3, max: Vector3) {
    this.min = min;
    this.max = max;

    // Since `max` itself should not be included in the rendered
    // box, we subtract Number.EPSILON.
    max = [max[0] - Number.EPSILON, max[1] - Number.EPSILON, max[2] - Number.EPSILON];

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
    // Why not generally avoid updating when the position for the third dim is outside the bbox?
    for (const planeId of OrthoViewValuesWithoutTDView) {
      const thirdDim = dimensions.thirdDimensionForPlane(planeId);
      const { geometry } = this.crossSections[planeId];
      for (const vertex of geometry.vertices) {
        const array = vertex.toArray();
        array[thirdDim] = position[thirdDim];
        vertex.fromArray(array);
      }

      geometry.computeBoundingSphere();
      geometry.verticesNeedUpdate = true;
    }
  }

  getMeshes(): Array<typeof THREE.Line> {
    return [this.cube].concat(_.values(this.crossSections));
  }

  setIsHighlighted(highlighted: boolean) {
    if (highlighted === this.isHighlighted) {
      return;
    }
    this.isHighlighted = highlighted;
    this.getMeshes().forEach(mesh => {
      mesh.material = this.getLineMaterial();
    });
    app.vent.trigger("rerender");
  }

  updateForCam(id: OrthoView) {
    if (!this.initialized) {
      return;
    }

    for (const planeId of OrthoViewValuesWithoutTDView) {
      const thirdDim = dimensions.thirdDimensionForPlane(planeId);
      const position = getPosition(Store.getState().flycam);
      if (position[thirdDim] >= this.min[thirdDim] && position[thirdDim] < this.max[thirdDim]) {
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
    this.cube.visible = visible;
    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.crossSections[planeId].visible = visible;
    }
  }
}

export default Cube;
