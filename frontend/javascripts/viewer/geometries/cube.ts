import app from "app";
import { getActiveTheme } from "theme";
import {
  BufferGeometry,
  Float32BufferAttribute,
  Line,
  LineBasicMaterial,
  Vector3 as ThreeVector3,
} from "three";
import type {
  OrthoView,
  OrthoViewWithoutTD,
  OrthoViewWithoutTDMap,
  Vector3,
} from "viewer/constants";
import { OrthoViews, OrthoViewValuesWithoutTDView } from "viewer/constants";
import {
  getBoxCrossSection,
  MAX_CROSS_SECTION_CORNERS,
} from "viewer/geometries/helpers/box_cross_section";
import { getPosition, getRotationInRadian } from "viewer/model/accessors/flycam_accessor";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import Store from "viewer/throttled_store";

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
  crossSections: OrthoViewWithoutTDMap<Line>;
  // Whether the (possibly rotated) data plane of a viewport currently cuts the box.
  hasCrossSection: OrthoViewWithoutTDMap<boolean> = {
    PLANE_XY: false,
    PLANE_XZ: false,
    PLANE_YZ: false,
  };
  cube: Line;
  min: Vector3;
  max: Vector3;
  readonly showCrossSections: boolean;
  initialized: boolean;
  visible: boolean;
  lineWidth: number;
  color: number;
  id: number | null | undefined;
  isHighlighted: boolean;
  storePropertyUnsubscribers: Array<() => void> = [];

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
    this.cube = new Line(new BufferGeometry(), this.getLineMaterial());
    this.crossSections = {
      PLANE_XY: this.createCrossSectionLine(),
      PLANE_XZ: this.createCrossSectionLine(),
      PLANE_YZ: this.createCrossSectionLine(),
    };

    if (this.min != null && this.max != null) {
      this.setCorners(this.min, this.max);
    }

    // The highlight color depends on the theme.
    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(getActiveTheme, () => this.updateLineColors()),
    );

    if (this.showCrossSections) {
      this.storePropertyUnsubscribers.push(
        listenToStoreProperty(
          (state) => getPosition(state.flycam),
          () => this.updateCrossSections(),
        ),
        listenToStoreProperty(
          (state) => getRotationInRadian(state.flycam),
          () => this.updateCrossSections(),
        ),
      );
    }
  }

  createCrossSectionLine(): Line {
    // Preallocate enough vertices for the largest possible cross section polygon
    // (plus the closing vertex). The drawRange selects the vertices actually used.
    const geometry = new BufferGeometry();
    geometry.setAttribute(
      "position",
      new Float32BufferAttribute(new Float32Array((MAX_CROSS_SECTION_CORNERS + 1) * 3), 3),
    );
    return new Line(geometry, this.getLineMaterial());
  }

  getLineMaterial() {
    return new LineBasicMaterial({
      color: this.getLineColor(),
      linewidth: this.lineWidth,
    });
  }

  getLineColor(): number {
    if (this.isHighlighted) {
      return getActiveTheme(Store.getState()) === "light" ? 0xeeeeee : 0xffffff;
    }
    return this.color;
  }

  setCorners(min: Vector3, max: Vector3) {
    /* Adapt the cube and the cross sections to the bounding box. */

    this.min = min;
    this.max = max;
    // Since `max` itself should not be included in the rendered
    // box, we subtract Number.EPSILON.
    max = [max[0] - Number.EPSILON, max[1] - Number.EPSILON, max[2] - Number.EPSILON];

    const vec = (x: number, y: number, z: number) => new ThreeVector3(x, y, z);

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

    this.cube.geometry.computeBoundingSphere();
    this.cube.geometry.attributes.position.needsUpdate = true;

    this.initialized = true;
    this.updateCrossSections();

    app.vent.emit("rerender");
  }

  updateCrossSections() {
    if (!this.initialized) {
      return;
    }

    const state = Store.getState();
    const position = getPosition(state.flycam);
    const rotation = getRotationInRadian(state.flycam);
    const voxelSize = state.dataset.dataSource.scale.factor;
    for (const planeId of OrthoViewValuesWithoutTDView) {
      const corners = getBoxCrossSection(
        this.min,
        this.max,
        planeId,
        position,
        rotation,
        voxelSize,
      );
      this.setCrossSectionCorners(planeId, corners);
    }
  }

  setCrossSectionCorners(planeId: OrthoViewWithoutTD, corners: Vector3[] | null) {
    this.hasCrossSection[planeId] = corners != null;
    if (corners == null) {
      return;
    }

    const { geometry } = this.crossSections[planeId];
    const positionAttribute = geometry.attributes.position;
    // Close the outline by repeating the first corner. The unused vertices are also
    // filled with the first corner so that they don't distort the bounding sphere.
    for (let idx = 0; idx < positionAttribute.count; idx++) {
      const corner = corners[idx < corners.length ? idx : 0];
      positionAttribute.setXYZ(idx, corner[0], corner[1], corner[2]);
    }
    geometry.setDrawRange(0, corners.length + 1);
    geometry.computeBoundingSphere();
    positionAttribute.needsUpdate = true;
  }

  getMeshes(): Line[] {
    return [this.cube].concat(Object.values(this.crossSections));
  }

  setIsHighlighted(highlighted: boolean) {
    if (highlighted === this.isHighlighted) {
      return;
    }

    this.isHighlighted = highlighted;
    this.updateLineColors();
  }

  updateLineColors() {
    this.getMeshes().forEach((mesh) => {
      // @ts-expect-error We don't use material arrays
      const meshMaterial: LineBasicMaterial = mesh.material;
      meshMaterial.color.setHex(this.getLineColor());
      meshMaterial.linewidth = this.lineWidth;
    });
    app.vent.emit("rerender");
  }

  updateForCam(id: OrthoView) {
    if (!this.initialized) {
      return;
    }

    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.crossSections[planeId].visible =
        this.hasCrossSection[planeId] && this.visible && planeId === id && this.showCrossSections;
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

  destroy() {
    for (const fn of this.storePropertyUnsubscribers) {
      fn();
    }
    this.storePropertyUnsubscribers = [];

    for (const mesh of this.getMeshes()) {
      mesh.geometry.dispose();
      (mesh.material as LineBasicMaterial).dispose();
    }
  }
}

export default Cube;
