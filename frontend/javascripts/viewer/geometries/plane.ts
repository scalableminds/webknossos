import { V3 } from "libs/mjs";
import _ from "lodash";
import * as THREE from "three";
import type { OrthoView, Vector3 } from "viewer/constants";
import constants, {
  OrthoViewColors,
  OrthoViewCrosshairColors,
  OrthoViewGrayCrosshairColor,
  OrthoViewValues,
} from "viewer/constants";
import PlaneMaterialFactory from "viewer/geometries/materials/plane_material_factory";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";

// A subdivision of 100 means that there will be 100 segments per axis
// and thus 101 vertices per axis (i.e., the vertex shader is executed 101**2).
// In an extreme scenario, these vertices would have a distance to each other
// of 32 voxels. Thus, each square (two triangles) would render one bucket.
// 100**2 == 10,000 buckets per plane are currently unrealistic and therefore
// a valid upper bound.
// However, note that in case of anisotropic datasets, the above calculation
// needs to be adapted a bit. For example, consider a dataset with mag 8-8-1.
// The XZ plane could render 100 buckets along the X coordinate (as above), but
// only ~13 buckets along the Z coordinate. This would require 1300 which is not
// unrealistic. PLANE_SUBDIVISION values of 80 showed rare problems which is why
// a value of 100 is now used. If this should become problematic, too, a dynamic
// subdivision would probably be the next step.
export const PLANE_SUBDIVISION = 100;

const DEFAULT_POSITION_OFFSET = [0, 0, 0] as Vector3;

class Plane {
  // This class is supposed to collect all the Geometries that belong to one single plane such as
  // the plane itself, its texture, borders and crosshairs.
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'plane' has no initializer and is not def... Remove this comment to see the full error message
  plane: THREE.Mesh<PlaneGeometry, ShaderMaterial, Object3DEventMap>;
  planeID: OrthoView;
  materialFactory!: PlaneMaterialFactory;
  displayCrosshair: boolean;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'crosshair' has no initializer and is not... Remove this comment to see the full error message
  crosshair: Array<THREE.LineSegments>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'TDViewBorders' has no initializer and is... Remove this comment to see the full error message
  TDViewBorders: THREE.Line;
  lastScaleFactors: [number, number];
  // baseRotation is the base rotation the plane has in an unrotated scene. It will be applied additional to the flycams rotation.
  // Different baseRotations for each of the planes ensures that the planes stay orthogonal to each other.
  baseRotation: THREE.Euler;
  storePropertyUnsubscribers: Array<() => void> = [];
  datasetScaleFactor: Vector3 = [1, 1, 1];

  // Properties are only created here to avoid new creating objects for each setRotation call.
  baseRotationMatrix = new THREE.Matrix4();
  flycamRotationMatrix = new THREE.Matrix4();

  constructor(planeID: OrthoView) {
    this.planeID = planeID;
    this.displayCrosshair = true;
    this.lastScaleFactors = [-1, -1];
    // VIEWPORT_WIDTH means that the plane should be that many voxels wide in the
    // dimension with the highest mag. In all other dimensions, the plane
    // is smaller in voxels, so that it is squared in nm.
    // --> scaleInfo.baseVoxel
    this.baseRotation = new THREE.Euler(0, 0, 0);
    this.bindToEvents();
    this.createMeshes();
  }

  createMeshes(): void {
    const pWidth = constants.VIEWPORT_WIDTH;
    // create plane
    const planeGeo = new THREE.PlaneGeometry(pWidth, pWidth, PLANE_SUBDIVISION, PLANE_SUBDIVISION);

    this.materialFactory = new PlaneMaterialFactory(
      this.planeID,
      true,
      OrthoViewValues.indexOf(this.planeID),
    );
    const textureMaterial = this.materialFactory.setup().getMaterial();
    this.plane = new THREE.Mesh(planeGeo, textureMaterial);

    // Create crosshairs
    this.crosshair = new Array(2);
    for (let i = 0; i <= 1; i++) {
      const crosshairGeometry = new THREE.BufferGeometry();
      // biome-ignore format: don't format array
      const crosshairVertices = new Float32Array([
        (-pWidth / 2) * i, (-pWidth / 2) * (1 - i), 0,
        -25 * i, -25 * (1 - i), 0,
        25 * i, 25 * (1 - i), 0,
        (pWidth / 2) * i, (pWidth / 2) * (1 - i), 0,
      ]);
      crosshairGeometry.setAttribute("position", new THREE.BufferAttribute(crosshairVertices, 3));

      this.crosshair[i] = new THREE.LineSegments(
        crosshairGeometry,
        this.getLineBasicMaterial(OrthoViewCrosshairColors[this.planeID][i], 1),
      );
      // Objects are rendered according to their renderOrder (lowest to highest).
      // The default renderOrder is 0. In order for the crosshairs to be shown
      // render them AFTER the plane has been rendered.
      this.crosshair[i].renderOrder = 1;
    }

    // Create borders
    const vertices = [
      new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0),
      new THREE.Vector3(-pWidth / 2, pWidth / 2, 0),
      new THREE.Vector3(pWidth / 2, pWidth / 2, 0),
      new THREE.Vector3(pWidth / 2, -pWidth / 2, 0),
      new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0),
    ];
    const tdBorderGeometry = new THREE.BufferGeometry().setFromPoints(vertices);

    this.TDViewBorders = new THREE.Line(
      tdBorderGeometry,
      this.getLineBasicMaterial(OrthoViewColors[this.planeID], 1),
    );
  }

  setDisplayCrosshair = (value: boolean): void => {
    this.displayCrosshair = value;
  };

  getLineBasicMaterial = _.memoize(
    (color: number, linewidth: number) =>
      new THREE.LineBasicMaterial({
        color,
        linewidth,
      }),
    (color: number, linewidth: number) => `${color}_${linewidth}`,
  );

  setOriginalCrosshairColor = (): void => {
    [0, 1].forEach((i) => {
      this.crosshair[i].material = this.getLineBasicMaterial(
        OrthoViewCrosshairColors[this.planeID][i],
        1,
      );
    });
  };

  setGrayCrosshairColor = (): void => {
    [0, 1].forEach((i) => {
      this.crosshair[i].material = this.getLineBasicMaterial(OrthoViewGrayCrosshairColor, 1);
    });
  };

  setScale(xFactor: number, yFactor: number): void {
    if (this.lastScaleFactors[0] === xFactor && this.lastScaleFactors[1] === yFactor) {
      return;
    }
    this.lastScaleFactors[0] = xFactor;
    this.lastScaleFactors[1] = yFactor;
    // Account for the dataset scale to match one world space coordinate to one dataset scale unit.
    const scaleVector: Vector3 = V3.multiply([xFactor, yFactor, 1], this.datasetScaleFactor);
    this.getMeshes().map((mesh) => mesh.scale.set(...scaleVector));
  }

  setBaseRotation = (rotVec: THREE.Euler): void => {
    this.baseRotation.copy(rotVec);
    this.baseRotationMatrix.makeRotationFromEuler(this.baseRotation);
  };

  setRotation = (rotVec: THREE.Euler): void => {
    // rotVec must be in "ZYX" order as this is how the flycam operates (see flycam_reducer setRotationReducer)
    this.flycamRotationMatrix.makeRotationFromEuler(rotVec);
    const combinedMatrix = this.flycamRotationMatrix.multiply(this.baseRotationMatrix);
    this.getMeshes().map((mesh) => mesh.setRotationFromMatrix(combinedMatrix));
  };

  // In case the plane's position was offset to make geometries
  // on the plane visible (by moving the plane to the back), one can
  // additionally pass the offset of the position (which is necessary for the
  // shader)
  setPosition = (
    originalPosition: Vector3,
    positionOffset: Vector3 = DEFAULT_POSITION_OFFSET,
  ): void => {
    // The world scaling by the dataset scale factor is inverted by the scene group

    // containing all planes to avoid sheering in anisotropic scaled datasets.
    // Thus, this scale needs to be applied manually to the position here.
    const scaledPosition = V3.multiply(originalPosition, this.datasetScaleFactor);
    // The offset is in screen space already so no scaling is necessary.
    const offsetPosition = V3.add(scaledPosition, positionOffset);
    this.TDViewBorders.position.set(...offsetPosition);
    this.crosshair[0].position.set(...offsetPosition);
    this.crosshair[1].position.set(...offsetPosition);
    this.plane.position.set(...offsetPosition);
    this.plane.material.setPositionOffset(...positionOffset);
  };

  setVisible = (isVisible: boolean, isDataVisible?: boolean): void => {
    this.plane.visible = isDataVisible != null ? isDataVisible : isVisible;
    this.TDViewBorders.visible = isVisible;
    this.crosshair[0].visible = isVisible && this.displayCrosshair;
    this.crosshair[1].visible = isVisible && this.displayCrosshair;
  };

  getMeshes = () => [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]];
  setLinearInterpolationEnabled = (enabled: boolean) => {
    this.plane.material.setUseBilinearFiltering(enabled);
  };

  destroy() {
    this.materialFactory.destroy();
    this.storePropertyUnsubscribers.forEach((f) => f());
    this.storePropertyUnsubscribers = [];
  }

  bindToEvents(): void {
    this.storePropertyUnsubscribers = [
      listenToStoreProperty(
        (storeState) => storeState.dataset.dataSource.scale.factor,
        (scaleFactor) => (this.datasetScaleFactor = scaleFactor),
      ),
    ];
  }
}

export default Plane;
