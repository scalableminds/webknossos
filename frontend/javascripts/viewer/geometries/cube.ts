import type { Tween } from "@tweenjs/tween.js";
import app from "app";
import { createTween } from "libs/tween_group";
import { getActiveTheme } from "theme";
import {
  BufferGeometry,
  DoubleSide,
  Float32BufferAttribute,
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
// The fill is a triangle fan over the (up to six) cross-section corners. Unused vertex slots
// hold the first corner (see writeCrossSectionCorners), so that the surplus triangles have zero
// area for cross sections with fewer corners.
const FILL_TRIANGLE_INDICES = [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 5];

function createPreallocatedGeometry(vertexCount: number): BufferGeometry {
  const geometry = new BufferGeometry();
  geometry.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array(vertexCount * 3), 3),
  );
  return geometry;
}

// Writes the corners into the preallocated geometry. The vertex after the last corner and all
// unused vertices hold the first corner. This closes the outline of a line and makes the surplus
// triangles of a fill degenerate. It also keeps the unused vertices from distorting the bounding
// sphere.
function writeCrossSectionCorners(geometry: BufferGeometry, corners: Vector3[]) {
  const positionAttribute = geometry.attributes.position;
  for (let idx = 0; idx < positionAttribute.count; idx++) {
    const corner = corners[idx < corners.length ? idx : 0];
    positionAttribute.setXYZ(idx, corner[0], corner[1], corner[2]);
  }
  geometry.computeBoundingSphere();
  positionAttribute.needsUpdate = true;
}

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
  // The corners of the polygon in which the (possibly rotated) data plane of each viewport cuts
  // the box, or null if it misses the box. Set in updateCrossSections.
  crossSectionCorners: OrthoViewWithoutTDMap<Vector3[] | null> = {
    PLANE_XY: null,
    PLANE_XZ: null,
    PLANE_YZ: null,
  };
  // Hidden cubes skip the cross-section updates. They are recomputed once the cube is shown.
  areCrossSectionsOutdated: boolean = false;
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
  fillFadeTween: Tween<{ opacity: number }> | null = null;
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
        // The flycam position and rotation are both derived from the current matrix.
        listenToStoreProperty(
          (state) => state.flycam.currentMatrix,
          () => this.updateCrossSections(),
        ),
      );
    }
  }

  createCrossSectionLine(): Line {
    // Preallocate enough vertices for the largest possible cross section polygon
    // (plus the closing vertex). The drawRange selects the vertices actually used.
    return new Line(
      createPreallocatedGeometry(MAX_CROSS_SECTION_CORNERS + 1),
      this.getLineMaterial(),
    );
  }

  getLineMaterial() {
    return new LineBasicMaterial({
      color: this.getLineColor(),
      linewidth: this.lineWidth,
    });
  }

  createCrossSectionFill(planeId: OrthoViewWithoutTD): Mesh<BufferGeometry, MeshBasicMaterial> {
    const geometry = createPreallocatedGeometry(MAX_CROSS_SECTION_CORNERS);
    geometry.setIndex(FILL_TRIANGLE_INDICES);
    const corners = this.crossSectionCorners[planeId];
    if (corners != null) {
      writeCrossSectionCorners(geometry, corners);
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
    fill.visible = this.visible && corners != null;
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
    if (!this.visible) {
      this.areCrossSectionsOutdated = true;
      return;
    }
    this.areCrossSectionsOutdated = false;

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
    this.crossSectionCorners[planeId] = corners;
    if (corners == null) {
      return;
    }

    const { geometry } = this.crossSections[planeId];
    writeCrossSectionCorners(geometry, corners);
    geometry.setDrawRange(0, corners.length + 1);
    const fill = this.crossSectionFills?.[planeId];
    if (fill != null) {
      writeCrossSectionCorners(fill.geometry, corners);
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
    // The fills are created from the current cross-section corners. updateForCam refines their
    // per-viewport visibility on the next render.
    const fills = {
      PLANE_XY: this.createCrossSectionFill(OrthoViews.PLANE_XY),
      PLANE_XZ: this.createCrossSectionFill(OrthoViews.PLANE_XZ),
      PLANE_YZ: this.createCrossSectionFill(OrthoViews.PLANE_YZ),
    };
    this.crossSectionFills = fills;
    // Cubes are only flashed after they were added to the scene (cubes created as active
    // don't flash), so add the fills next to the lines.
    this.cube.parent?.add(...Object.values(fills));

    this.fillFadeTween = createTween({ opacity: ACTIVE_FILL_OPACITY })
      .to({ opacity: 0 }, ACTIVE_FILL_FADE_DURATION_MS)
      .onUpdate(({ opacity }) => {
        for (const fill of Object.values(fills)) {
          fill.material.opacity = opacity;
        }
        app.vent.emit("rerender");
      })
      .onComplete(() => {
        this.fillFadeTween = null;
        this.removeFills();
      })
      .start();
  }

  removeFills() {
    this.fillFadeTween?.stop();
    this.fillFadeTween = null;
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

    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.crossSections[planeId].visible =
        this.crossSectionCorners[planeId] != null &&
        this.visible &&
        planeId === id &&
        this.showCrossSections;
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

    if (visible && this.areCrossSectionsOutdated) {
      this.updateCrossSections();
    }
  }

  destroy() {
    this.fillFadeTween?.stop();
    this.fillFadeTween = null;
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
