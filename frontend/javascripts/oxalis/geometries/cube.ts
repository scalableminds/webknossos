import * as THREE from "three";
import _ from "lodash";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import type { OrthoView, OrthoViewWithoutTDMap, Vector3 } from "oxalis/constants";
import { OrthoViewValuesWithoutTDView, OrthoViews } from "oxalis/constants";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import Store from "oxalis/throttled_store";
import app from "app";
import dimensions from "oxalis/model/dimensions";
type Properties = {
  min?: Vector3;
  max: Vector3;
  lineWidth?: number;
  color?: number;
  showCrossSections?: boolean;
  id?: number;
  isHighlighted: boolean;
};

class Cube {
  // The cross sections are lines that are rendered in the XY, YZ and XZ
  // viewports to make the dataset bounding box visible regardless of the
  // current W position. Without the cross sections, the bounding box' wireframe
  // would only be visible when the current position matches the edge positions
  // of the bounding box.
  crossSections: OrthoViewWithoutTDMap<THREE.Line>;
  cube: THREE.Line;
  min: Vector3;
  max: Vector3;
  readonly showCrossSections: boolean;
  initialized: boolean;
  visible: boolean;
  lineWidth: number;
  color: number;
  id: number | null | undefined;
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
    this.cube = new THREE.Line(new THREE.BufferGeometry(), this.getLineMaterial());
    this.crossSections = {
      PLANE_XY: new THREE.Line(new THREE.BufferGeometry(), this.getLineMaterial()),
      PLANE_XZ: new THREE.Line(new THREE.BufferGeometry(), this.getLineMaterial()),
      PLANE_YZ: new THREE.Line(new THREE.BufferGeometry(), this.getLineMaterial()),
    };

    if (this.min != null && this.max != null) {
      this.setCorners(this.min, this.max);
    }

    if (this.showCrossSections) {
      listenToStoreProperty(
        (state) => getPosition(state.flycam),
        (position) => this.updatePositionForCrossSections(position),
      );
    }
  }

  getLineMaterial() {
    return this.isHighlighted
      ? new THREE.LineBasicMaterial({
          color: Store.getState().uiInformation.theme === "light" ? 0xeeeeee : 0xffffff,
          linewidth: this.lineWidth,
        })
      : new THREE.LineBasicMaterial({
          color: this.color,
          linewidth: this.lineWidth,
        });
  }

  setCorners(min: Vector3, max: Vector3) {
    /* Adapt the cube and the cross sections to the bounding box. */

    this.min = min;
    this.max = max;
    // Since `max` itself should not be included in the rendered
    // box, we subtract Number.EPSILON.
    max = [max[0] - Number.EPSILON, max[1] - Number.EPSILON, max[2] - Number.EPSILON];

    const vec = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    this.cube.geometry.setFromPoints([
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
    ]);

    this.crossSections[OrthoViews.PLANE_XY].geometry.setFromPoints([
      vec(min[0], min[1], 0),
      vec(min[0], max[1], 0),
      vec(max[0], max[1], 0),
      vec(max[0], min[1], 0),
      vec(min[0], min[1], 0),
    ]);
    this.crossSections[OrthoViews.PLANE_YZ].geometry.setFromPoints([
      vec(0, min[1], min[2]),
      vec(0, min[1], max[2]),
      vec(0, max[1], max[2]),
      vec(0, max[1], min[2]),
      vec(0, min[1], min[2]),
    ]);
    this.crossSections[OrthoViews.PLANE_XZ].geometry.setFromPoints([
      vec(min[0], 0, min[2]),
      vec(min[0], 0, max[2]),
      vec(max[0], 0, max[2]),
      vec(max[0], 0, min[2]),
      vec(min[0], 0, min[2]),
    ]);

    for (const mesh of _.values(this.crossSections).concat([this.cube])) {
      mesh.geometry.computeBoundingSphere();
      mesh.geometry.attributes.position.needsUpdate = true;
    }

    this.initialized = true;
    this.updatePositionForCrossSections(getPosition(Store.getState().flycam));

    app.vent.emit("rerender");
  }

  updatePositionForCrossSections(position: Vector3) {
    if (!this.initialized) {
      return;
    }

    for (const planeId of OrthoViewValuesWithoutTDView) {
      const thirdDim = dimensions.thirdDimensionForPlane(planeId);
      const { geometry } = this.crossSections[planeId];

      // Update the third dimension for all vectors
      for (let idx = 0; idx < geometry.attributes.position.count; idx++) {
        if (thirdDim === 0) {
          geometry.attributes.position.setX(idx, position[thirdDim]);
        } else if (thirdDim === 1) {
          geometry.attributes.position.setY(idx, position[thirdDim]);
        } else {
          geometry.attributes.position.setZ(idx, position[thirdDim]);
        }
      }

      geometry.computeBoundingSphere();
      geometry.attributes.position.needsUpdate = true;
    }
  }

  getMeshes(): Array<THREE.Line> {
    return [this.cube].concat(_.values(this.crossSections));
  }

  setIsHighlighted(highlighted: boolean) {
    if (highlighted === this.isHighlighted) {
      return;
    }

    this.isHighlighted = highlighted;
    this.getMeshes().forEach((mesh) => {
      mesh.material = this.getLineMaterial();
    });
    app.vent.emit("rerender");
  }

  updateForCam(id: OrthoView) {
    if (!this.initialized) {
      return;
    }

    const position = getPosition(Store.getState().flycam);
    for (const planeId of OrthoViewValuesWithoutTDView) {
      const thirdDim = dimensions.thirdDimensionForPlane(planeId);
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
