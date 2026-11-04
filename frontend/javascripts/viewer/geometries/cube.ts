import app from "app";
import { getActiveTheme } from "theme";
import {
  BufferGeometry,
  DoubleSide,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  Vector3 as ThreeVector3,
} from "three";
import type {
  OrthoView,
  OrthoViewWithoutTD,
  OrthoViewWithoutTDMap,
  Vector3,
} from "viewer/constants";
import { OrthoViews, OrthoViewValuesWithoutTDView } from "viewer/constants";
import { getPosition } from "viewer/model/accessors/flycam_accessor";
import dimensions from "viewer/model/dimensions";
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
  // A cube that is created as active does not flash its fill (see setIsActive). This avoids
  // re-flashing whenever the user bounding boxes change and their cubes are rebuilt.
  isActive: boolean;
  // Schedules the disposal of GPU resources, e.g. to wait for pending shader compilations.
  deferDisposal?: (dispose: () => void) => void;
};

// When a bounding box becomes active (selected), its cross sections are filled in the 2D
// viewports, so that the user can spot it. A color change of the 1px outline alone is too
// subtle to notice on top of the data. The fill immediately starts fading out, so that it does
// not get in the way while annotating inside the box.
const ACTIVE_FILL_OPACITY = 0.2;
const ACTIVE_FILL_FADE_DURATION_MS = 1500;
// The fill's two triangles, indexing the first four cross-section corners.
const FILL_TRIANGLE_INDICES = [0, 1, 2, 0, 2, 3];

class Cube {
  // The cross sections are lines that are rendered in the XY, YZ and XZ
  // viewports to make the dataset bounding box visible regardless of the
  // current W position. Without the cross sections, the bounding box' wireframe
  // would only be visible when the current position matches the edge positions
  // of the bounding box.
  crossSections: OrthoViewWithoutTDMap<Line>;
  // Translucent fills of the cross sections. They only exist while the fill flashes after the
  // bounding box became active, so that the other boxes don't pay for extra meshes and
  // per-move geometry updates.
  crossSectionFills: OrthoViewWithoutTDMap<Mesh<BufferGeometry, MeshBasicMaterial>> | null = null;
  // The four corners of each cross section (without the third dimension), set in setCorners.
  crossSectionCorners: OrthoViewWithoutTDMap<ThreeVector3[]> | null = null;
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
  isActive: boolean;
  fillAnimationFrameId: number | null = null;
  storePropertyUnsubscribers: Array<() => void> = [];
  deferDisposal: (dispose: () => void) => void;

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
    this.isActive = properties.isActive;
    this.deferDisposal = properties.deferDisposal ?? ((dispose) => dispose());
    this.cube = new Line(new BufferGeometry(), this.getLineMaterial());
    this.crossSections = {
      PLANE_XY: new Line(new BufferGeometry(), this.getLineMaterial()),
      PLANE_XZ: new Line(new BufferGeometry(), this.getLineMaterial()),
      PLANE_YZ: new Line(new BufferGeometry(), this.getLineMaterial()),
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
          (position) => this.updatePositionForCrossSections(position),
        ),
      );
    }
  }

  getLineMaterial() {
    return new LineBasicMaterial({
      color: this.getLineColor(),
      linewidth: this.lineWidth,
    });
  }

  createCrossSectionFill(planeId: OrthoViewWithoutTD): Mesh<BufferGeometry, MeshBasicMaterial> {
    const geometry = new BufferGeometry();
    geometry.setIndex(FILL_TRIANGLE_INDICES);
    if (this.crossSectionCorners != null) {
      geometry.setFromPoints(this.crossSectionCorners[planeId]);
      geometry.computeBoundingSphere();
    }
    const fill = new Mesh(
      geometry,
      new MeshBasicMaterial({
        color: this.color,
        side: DoubleSide,
        transparent: true,
        opacity: ACTIVE_FILL_OPACITY,
        depthWrite: false,
      }),
    );
    fill.visible = this.visible;
    return fill;
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

    // The four corners of each cross section. The third dimension is set in
    // updatePositionForCrossSections.
    const crossSectionCorners: OrthoViewWithoutTDMap<ThreeVector3[]> = {
      PLANE_XY: [
        vec(min[0], min[1], 0),
        vec(min[0], max[1], 0),
        vec(max[0], max[1], 0),
        vec(max[0], min[1], 0),
      ],
      PLANE_YZ: [
        vec(0, min[1], min[2]),
        vec(0, min[1], max[2]),
        vec(0, max[1], max[2]),
        vec(0, max[1], min[2]),
      ],
      PLANE_XZ: [
        vec(min[0], 0, min[2]),
        vec(min[0], 0, max[2]),
        vec(max[0], 0, max[2]),
        vec(max[0], 0, min[2]),
      ],
    };
    this.crossSectionCorners = crossSectionCorners;
    for (const planeId of OrthoViewValuesWithoutTDView) {
      const corners = crossSectionCorners[planeId];
      // Close the outline by returning to the first corner.
      this.crossSections[planeId].geometry.setFromPoints([...corners, corners[0]]);
      this.crossSectionFills?.[planeId].geometry.setFromPoints(corners);
    }

    for (const mesh of this.getMeshes()) {
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
      const meshes: Array<Line | Mesh> = [this.crossSections[planeId]];
      if (this.crossSectionFills != null) {
        meshes.push(this.crossSectionFills[planeId]);
      }
      for (const { geometry } of meshes) {
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
  }

  getLines(): Line[] {
    return [this.cube, ...Object.values(this.crossSections)];
  }

  getMeshes(): Array<Line | Mesh<BufferGeometry, MeshBasicMaterial>> {
    return [...this.getLines(), ...Object.values(this.crossSectionFills ?? {})];
  }

  setIsHighlighted(highlighted: boolean) {
    if (highlighted === this.isHighlighted) {
      return;
    }

    this.isHighlighted = highlighted;
    this.updateLineColors();
  }

  setIsActive(isActive: boolean) {
    if (isActive === this.isActive) {
      return;
    }

    this.isActive = isActive;
    if (isActive) {
      this.flashFill();
    } else {
      this.removeFills();
    }
  }

  flashFill() {
    this.removeFills();
    if (!this.showCrossSections) {
      return;
    }
    const fills = {
      PLANE_XY: this.createCrossSectionFill(OrthoViews.PLANE_XY),
      PLANE_XZ: this.createCrossSectionFill(OrthoViews.PLANE_XZ),
      PLANE_YZ: this.createCrossSectionFill(OrthoViews.PLANE_YZ),
    };
    this.crossSectionFills = fills;
    // Cubes are only flashed after they were added to the scene (cubes created as active
    // don't flash), so add the fills next to the lines.
    this.cube.parent?.add(...Object.values(fills));
    // Set the third dimension of the fills. updateForCam refines their per-viewport
    // visibility on the next render.
    this.updatePositionForCrossSections(getPosition(Store.getState().flycam));

    const startTime = performance.now();
    const animate = (now: number) => {
      const fadeProgress = (now - startTime) / ACTIVE_FILL_FADE_DURATION_MS;
      if (fadeProgress >= 1) {
        this.fillAnimationFrameId = null;
        this.removeFills();
        return;
      }
      const opacity = ACTIVE_FILL_OPACITY * (1 - fadeProgress);
      for (const fill of Object.values(fills)) {
        fill.material.opacity = opacity;
      }
      app.vent.emit("rerender");
      this.fillAnimationFrameId = requestAnimationFrame(animate);
    };
    this.fillAnimationFrameId = requestAnimationFrame(animate);
  }

  removeFills() {
    if (this.fillAnimationFrameId != null) {
      cancelAnimationFrame(this.fillAnimationFrameId);
      this.fillAnimationFrameId = null;
    }
    if (this.crossSectionFills == null) {
      return;
    }
    const fills = Object.values(this.crossSectionFills);
    this.crossSectionFills = null;
    for (const fill of fills) {
      fill.removeFromParent();
    }
    this.deferDisposal(() => {
      for (const fill of fills) {
        fill.geometry.dispose();
        fill.material.dispose();
      }
    });
    app.vent.emit("rerender");
  }

  updateLineColors() {
    this.getLines().forEach((mesh) => {
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

    const position = getPosition(Store.getState().flycam);
    for (const planeId of OrthoViewValuesWithoutTDView) {
      const thirdDim = dimensions.thirdDimensionForPlane(planeId);
      if (position[thirdDim] >= this.min[thirdDim] && position[thirdDim] < this.max[thirdDim]) {
        this.crossSections[planeId].visible =
          this.visible && planeId === id && this.showCrossSections;
      } else {
        this.crossSections[planeId].visible = false;
      }
      if (this.crossSectionFills != null) {
        this.crossSectionFills[planeId].visible = this.crossSections[planeId].visible;
      }
    }

    this.cube.visible = this.visible && id === OrthoViews.TDView;
  }

  setVisibility(visible: boolean) {
    this.visible = visible;
    this.cube.visible = visible;

    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.crossSections[planeId].visible = visible;
      if (this.crossSectionFills != null) {
        this.crossSectionFills[planeId].visible = visible;
      }
    }
  }

  destroy() {
    if (this.fillAnimationFrameId != null) {
      cancelAnimationFrame(this.fillAnimationFrameId);
      this.fillAnimationFrameId = null;
    }
    for (const fn of this.storePropertyUnsubscribers) {
      fn();
    }
    this.storePropertyUnsubscribers = [];

    for (const mesh of this.getMeshes()) {
      mesh.geometry.dispose();
      (mesh.material as LineBasicMaterial | MeshBasicMaterial).dispose();
    }
  }
}

export default Cube;
