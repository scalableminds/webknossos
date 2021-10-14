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
import ErrorHandling from "libs/error_handling";
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
  isEditable?: boolean,
  isHighlighted: boolean,
};

type PlaneGeometry = typeof THREE.PlaneGeometry;
// type CrossSectionHitPlanesTuple = [PlaneGeometry, PlaneGeometry, PlaneGeometry, PlaneGeometry];
type CrossSectionHitPlanesTuple = Array<PlaneGeometry>;

export function edgeIdToEdge(id: number, plane: OrthoView) {
  const isMaxEdge = id > 1;
  const direction = id % 2 === 0 ? "vertical" : "horizontal";
  switch (plane) {
    case OrthoViews.PLANE_XY: {
      const dimensionIndex = id % 2 === 0 ? 0 : 1;
      return { dimensionIndex, direction, isMaxEdge };
    }
    case OrthoViews.PLANE_YZ: {
      const dimensionIndex = id % 2 === 0 ? 2 : 1;
      return { dimensionIndex, direction, isMaxEdge };
    }
    case OrthoViews.PLANE_XZ: {
      const dimensionIndex = id % 2 === 0 ? 0 : 2;
      return { dimensionIndex, direction, isMaxEdge };
    }
    default: {
      return { dimensionIndex: 0, direction, isMaxEdge };
    }
  }
}

class Cube {
  crossSections: OrthoViewMap<typeof THREE.Line>;
  crossSectionHitPlanes: OrthoViewMap<CrossSectionHitPlanesTuple>;

  cube: typeof THREE.Line;
  min: Vector3;
  max: Vector3;
  showCrossSections: boolean;
  initialized: boolean;
  visible: boolean;
  id: ?number;
  isEditable: boolean;
  lineWidth: number;
  color: number;
  isHighlighted: boolean;

  constructor(properties: Properties) {
    // min/max should denote a half-open interval.
    this.min = properties.min || [0, 0, 0];
    this.max = properties.max;
    this.id = properties.id;
    this.isEditable = properties.isEditable || false;
    this.lineWidth = properties.lineWidth != null ? properties.lineWidth : 1;
    this.color = properties.color || 0x000000;
    this.showCrossSections = properties.showCrossSections || false;

    this.initialized = false;
    this.visible = true;
    this.isHighlighted = properties.isHighlighted;

    this.cube = new THREE.Line(new THREE.Geometry(), this.getLineMaterial());

    this.crossSections = {};
    this.crossSectionHitPlanes = {
      [OrthoViews.PLANE_XY]: [],
      [OrthoViews.PLANE_YZ]: [],
      [OrthoViews.PLANE_XZ]: [],
    };
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
      ? new THREE.LineDashedMaterial({
          color: 0xffffff,
          linewidth: this.lineWidth,
          scale: 1,
          dashSize: 5,
          gapSize: 5,
        })
      : new THREE.LineBasicMaterial({ color: this.color, linewidth: this.lineWidth });
  }

  getEdgeHitBox(
    width: number,
    height: number,
    depth: number,
    x: number,
    y: number,
    z: number,
    direction: string,
    edgeId: number,
  ): typeof THREE.BoxGeometry {
    const maxWidth = 40;
    let geometry;
    switch (direction) {
      case "width": {
        geometry = new THREE.BoxGeometry(
          width + maxWidth,
          Math.min(maxWidth, height / 3),
          Math.min(maxWidth, depth / 3),
        );
        break;
      }
      case "depth": {
        geometry = new THREE.BoxGeometry(
          Math.min(maxWidth, width / 3),
          Math.min(maxWidth, height / 3),
          depth + maxWidth,
        );
        break;
      }
      case "height": {
        geometry = new THREE.BoxGeometry(
          Math.min(maxWidth, width / 3),
          height + maxWidth,
          Math.min(maxWidth, depth / 3),
        );
        break;
      }
      default: {
        geometry = new THREE.BoxGeometry(1, 1, 1);
      }
    }
    const box = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0x00ff00 }));
    box.position.set(x, y, z);
    box.userData.boxId = this.id;
    box.userData.edgeId = edgeId;
    return box;
  }

  getHitPlane(
    crossSectionWidth: number,
    crossSectionHeight: number,
    topLeftOfEdge: [number, number, number],
    direction: "width" | "height",
    extendDirectionIndex: 0 | 1 | 2,
    edgeId: number,
  ): typeof THREE.PlaneGeometry {
    const maxHitOffset = 40;
    let planeWidth;
    let planeHeight;
    if (direction === "width") {
      planeWidth = crossSectionWidth + maxHitOffset;
      planeHeight = Math.min(maxHitOffset, crossSectionHeight / 3);
      topLeftOfEdge[extendDirectionIndex] += crossSectionWidth / 2;
    } else {
      planeWidth = Math.min(maxHitOffset, crossSectionWidth / 3);
      planeHeight = crossSectionHeight + maxHitOffset;
      topLeftOfEdge[extendDirectionIndex] += crossSectionHeight / 2;
    }
    const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight);
    // TODO: Adjust Orientation of the planes according to the plane parameter!!!!
    const plane = new THREE.Mesh(
      geometry,
      new THREE.MeshBasicMaterial({
        color: 0x00ff00,
        side: THREE.DoubleSide,
        opacity: 0.2,
        transparent: true,
      }),
    );
    const [x, y, z] = topLeftOfEdge;
    plane.position.set(x, y, z);
    plane.userData.boxId = this.id;
    plane.userData.edgeId = edgeId;
    plane.userData.cube = this;
    return plane;
  }

  getXYPlaneCrossSectionHitPlanes(): CrossSectionHitPlanesTuple {
    const { min } = this;
    const { max } = this;
    const width = max[0] - min[0];
    const height = max[1] - min[1];
    const planes = [
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "height", 1, 0),
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "width", 0, 1),
      this.getHitPlane(width, height, [max[0], min[1], min[2]], "height", 1, 2),
      this.getHitPlane(width, height, [min[0], max[1], min[2]], "width", 0, 3),
    ];
    planes.forEach(plane => {
      plane.userData.plane = OrthoViews.PLANE_XY;
    });
    return planes;
  }

  getYZPlaneCrossSectionHitPlanes(): CrossSectionHitPlanesTuple {
    const { min } = this;
    const { max } = this;
    const width = max[2] - min[2];
    const height = max[1] - min[1];
    const planes = [
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "height", 1, 0),
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "width", 2, 1),
      this.getHitPlane(width, height, [min[0], min[1], max[2]], "height", 1, 2),
      this.getHitPlane(width, height, [min[0], max[1], min[2]], "width", 2, 3),
    ];
    planes.forEach(plane => {
      // Rotating to the correct orientation.
      plane.geometry.rotateY(Math.PI / 2);
      plane.userData.plane = OrthoViews.PLANE_YZ;
    });
    return planes;
  }

  getXZPlaneCrossSectionHitPlanes(): CrossSectionHitPlanesTuple {
    const { min } = this;
    const { max } = this;
    const width = max[0] - min[0];
    const height = max[2] - min[2];
    const planes = [
      // TODO: Test if all sphere intersections fail or why the object is pushed / not pushed to the array!!
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "height", 2, 0),
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "width", 0, 1),
      this.getHitPlane(width, height, [max[0], min[1], min[2]], "height", 2, 2),
      this.getHitPlane(width, height, [min[0], min[1], max[2]], "width", 0, 3),
    ];
    planes.forEach(plane => {
      // Rotating to the correct orientation.
      plane.geometry.rotateX(Math.PI / 2);
      plane.userData.plane = OrthoViews.PLANE_XZ;
    });
    return planes;
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

    if (this.isEditable) {
      ErrorHandling.assert(this.id != null, "Every editable bounding box needs an id!");
      this.createEdgeHitboxesForCrossSections();
    }

    for (const mesh of _.values(this.crossSections).concat([this.cube])) {
      mesh.geometry.computeBoundingSphere();
      mesh.computeLineDistances();
      mesh.geometry.verticesNeedUpdate = true;
    }

    this.initialized = true;
    this.updatePosition(getPosition(Store.getState().flycam));
    app.vent.trigger("rerender");
  }

  createEdgeHitboxesForCrossSections() {
    this.crossSectionHitPlanes[OrthoViews.PLANE_XY] = this.getXYPlaneCrossSectionHitPlanes();
    this.crossSectionHitPlanes[OrthoViews.PLANE_YZ] = this.getYZPlaneCrossSectionHitPlanes();
    this.crossSectionHitPlanes[OrthoViews.PLANE_XZ] = this.getXZPlaneCrossSectionHitPlanes();
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
      const offset = planeId === OrthoViews.PLANE_XY ? +0.001 : -0.001;
      if (position[thirdDim] >= this.min[thirdDim] && position[thirdDim] < this.max[thirdDim]) {
        for (const hitPlane of this.crossSectionHitPlanes[planeId]) {
          const hitPlanePosition = hitPlane.position.toArray();
          // TODO: Offset!!!!!!!
          hitPlanePosition[thirdDim] = position[thirdDim] + offset;
          hitPlane.position.set(hitPlanePosition[0], hitPlanePosition[1], hitPlanePosition[2]);
          hitPlane.geometry.verticesNeedUpdate = true;
          // hitPlane.geometry.attributes.position.needsUpdate = true;
          // TODO: "The bounding sphere is also computed automatically when doing raycasting."
          // According to this, the call can be removed and will then only be done when needed.
          hitPlane.geometry.computeBoundingBox();
        }
      }
    }
  }

  getMeshes(): Array<typeof THREE.Line> {
    return [this.cube].concat(_.values(this.crossSections));
  }

  getCrossSectionHitPlanes(): Array<typeof THREE.PlaneGeometry> {
    return _.flattenDeep(_.values(this.crossSectionHitPlanes));
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
