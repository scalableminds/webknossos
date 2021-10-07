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
};

type PlaneGeometry = typeof THREE.PlaneGeometry;
// type CrossSectionHitPlanesTuple = [PlaneGeometry, PlaneGeometry, PlaneGeometry, PlaneGeometry];
type CrossSectionHitPlanesTuple = Array<PlaneGeometry>;

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

  constructor(properties: Properties) {
    // min/max should denote a half-open interval.
    this.min = properties.min || [0, 0, 0];
    this.max = properties.max;
    this.id = properties.id;
    this.isEditable = properties.isEditable || false;
    const lineWidth = properties.lineWidth != null ? properties.lineWidth : 1;
    const color = properties.color || 0x000000;
    this.showCrossSections = properties.showCrossSections || false;

    this.initialized = false;
    this.visible = true;

    const lineProperties = { color, linewidth: lineWidth };

    this.cube = new THREE.Line(new THREE.Geometry(), new THREE.LineBasicMaterial(lineProperties));

    this.crossSections = {};
    this.crossSectionHitPlanes = {
      [OrthoViews.PLANE_XY]: [],
      [OrthoViews.PLANE_YZ]: [],
      [OrthoViews.PLANE_XZ]: [],
    };
    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.crossSections[planeId] = new THREE.Line(
        new THREE.Geometry(),
        new THREE.LineBasicMaterial(lineProperties),
      );
    }

    if (this.min != null && this.max != null) {
      this.setCorners(this.min, this.max);
    }

    listenToStoreProperty(
      state => getPosition(state.flycam),
      position => this.updatePosition(position),
    );
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
      new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide, opacity: 0.3 }),
    );
    const [x, y, z] = topLeftOfEdge;
    plane.position.set(x, y, z);
    plane.userData.boxId = this.id;
    plane.userData.edgeId = edgeId;
    return plane;
  }

  getXYPlaneCrossSectionHitPlanes(): CrossSectionHitPlanesTuple {
    const { min } = this;
    const { max } = this;
    const width = max[0] - min[0];
    const height = max[1] - min[1];
    return [
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "height", 1, 0),
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "width", 0, 1),
      this.getHitPlane(width, height, [max[0], min[1], min[2]], "height", 1, 2),
      this.getHitPlane(width, height, [min[0], max[1], min[2]], "width", 0, 3),
    ];
  }

  getYZPlaneCrossSectionHitPlanes(): CrossSectionHitPlanesTuple {
    const { min } = this;
    const { max } = this;
    const width = max[1] - min[1];
    const height = max[2] - min[2];
    const planes = [
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "height", 2, 4),
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "width", 1, 5),
      this.getHitPlane(width, height, [min[0], max[1], min[2]], "height", 2, 6),
      this.getHitPlane(width, height, [min[0], min[1], max[2]], "width", 1, 7),
    ];
    planes.forEach(plane => {
      plane.geometry.rotateY(Math.PI / 2);
    });
    return planes;
  }

  getXZPlaneCrossSectionHitPlanes(): CrossSectionHitPlanesTuple {
    const { min } = this;
    const { max } = this;
    const width = max[0] - min[0];
    const height = max[2] - min[2];
    const planes = [
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "height", 2, 8),
      this.getHitPlane(width, height, [min[0], min[1], min[2]], "width", 0, 9),
      this.getHitPlane(width, height, [max[0], min[1], min[2]], "height", 2, 10),
      this.getHitPlane(width, height, [min[0], min[1], max[2]], "width", 0, 11),
    ];
    planes.forEach(plane => {
      plane.geometry.rotateX(Math.PI / 2);
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
      mesh.geometry.verticesNeedUpdate = true;
    }

    this.initialized = true;
    this.updatePosition(getPosition(Store.getState().flycam));
    app.vent.trigger("rerender");
  }

  createEdgeHitboxesForCrossSections() {
    // The bounding boxes for the edges of the cube have an id equal to the index of the array.
    // The index of the edge is illustrated in the following ascii art.
    // min--> +-----1------+
    //      .'|          .'|
    //    0'  4        2'  |
    //  .'    |      .'    5
    // +----3-------+      |
    // |      |     |      |
    // |      +---9-|------+
    // 7    .'      6     .'
    // |  .8        |   10
    // |.'          | .'
    // +----11------+' <-- max
    //
    // -z
    // ▵      ↗ -y
    // |    .'
    // |  .'
    // |.'
    // ----------> +x
    // this.crossSectionHitPlanes[OrthoViews.PLANE_XY] = this.getXYPlaneCrossSectionHitPlanes();
    this.crossSectionHitPlanes[OrthoViews.PLANE_XY] = [];
    this.crossSectionHitPlanes[OrthoViews.PLANE_YZ] = [];
    this.crossSectionHitPlanes[OrthoViews.PLANE_XZ] = this.getXZPlaneCrossSectionHitPlanes();
    // this.crossSectionHitPlanes[OrthoViews.PLANE_XZ] = [];
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
      if (position[thirdDim] >= this.min[thirdDim] && position[thirdDim] < this.max[thirdDim]) {
        for (const hitPlane of this.crossSectionHitPlanes[planeId]) {
          const hitPlanePosition = hitPlane.position.toArray();
          hitPlanePosition[thirdDim] = position[thirdDim];
          hitPlane.position.set(hitPlanePosition[0], hitPlanePosition[1], hitPlanePosition[2]);
          hitPlane.geometry.verticesNeedUpdate = true;
          console.log(hitPlane);
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
