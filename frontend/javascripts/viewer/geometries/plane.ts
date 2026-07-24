import { V3 } from "libs/mjs";
import memoize from "lodash-es/memoize";
import {
  BufferAttribute,
  BufferGeometry,
  Euler,
  Line,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  type Object3DEventMap,
  PlaneGeometry,
  Vector3 as ThreeVector3,
} from "three";
import type { OrthoView, Vector3 } from "viewer/constants";
import constants, {
  OrthoViewColors,
  OrthoViewCrosshairColors,
  OrthoViewGrayCrosshairColor,
  OrthoViewValues,
  PLANE_SUBDIVISION,
} from "viewer/constants";
import PlaneMaterialFactory, {
  type PlaneShaderMaterial,
} from "viewer/geometries/materials/plane_material_factory";
import { listenToStoreProperty } from "viewer/model/helpers/listener_helpers";
import { getBaseVoxelInUnit } from "viewer/model/scaleinfo";

const DEFAULT_POSITION_OFFSET = [0, 0, 0] as Vector3;

class Plane {
  // This class is supposed to collect all the Geometries that belong to one single plane such as
  // the plane itself, its texture, borders and crosshairs.
  plane!: Mesh<PlaneGeometry, PlaneShaderMaterial, Object3DEventMap>;
  planeID: OrthoView;
  materialFactory!: PlaneMaterialFactory;
  displayCrosshair: boolean;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'crosshair' has no initializer and is not... Remove this comment to see the full error message
  crosshair: Array<LineSegments>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'TDViewBorders' has no initializer and is... Remove this comment to see the full error message
  TDViewBorders: Line;
  lastScaleFactors: [number, number];
  // baseRotation is the base rotation the plane has in an unrotated scene. It will be applied additional to the flycams rotation.
  // Different baseRotations for each of the planes ensures that the planes stay orthogonal to each other.
  baseRotation: Euler;
  storePropertyUnsubscribers: Array<() => void> = [];
  datasetScaleFactor: Vector3 = [1, 1, 1];

  // Properties are only created here to avoid new creating objects for each setRotation call.
  baseRotationMatrix = new Matrix4();
  flycamRotationMatrix = new Matrix4();

  // Keeps track of the materials created by getLineBasicMaterial so that
  // they can be disposed in destroy().
  private lineMaterials: LineBasicMaterial[] = [];

  constructor(planeID: OrthoView) {
    this.planeID = planeID;
    this.displayCrosshair = true;
    this.lastScaleFactors = [-1, -1];
    this.baseRotation = new Euler(0, 0, 0);
    this.bindToEvents();
    this.createMeshes();
  }

  createMeshes(): void {
    const pWidth = constants.VIEWPORT_WIDTH;
    // create plane
    const planeGeo = new PlaneGeometry(pWidth, pWidth, PLANE_SUBDIVISION, PLANE_SUBDIVISION);

    this.materialFactory = new PlaneMaterialFactory(
      this.planeID,
      true,
      OrthoViewValues.indexOf(this.planeID),
    );
    const textureMaterial = this.materialFactory.setup().getMaterial();
    this.plane = new Mesh(planeGeo, textureMaterial);

    // Create crosshairs
    this.crosshair = new Array(2);
    for (let i = 0; i <= 1; i++) {
      const crosshairGeometry = new BufferGeometry();
      // biome-ignore format: don't format array
      const crosshairVertices = new Float32Array([
        (-pWidth / 2) * i, (-pWidth / 2) * (1 - i), 0,
        -25 * i, -25 * (1 - i), 0,
        25 * i, 25 * (1 - i), 0,
        (pWidth / 2) * i, (pWidth / 2) * (1 - i), 0,
      ]);
      crosshairGeometry.setAttribute("position", new BufferAttribute(crosshairVertices, 3));

      this.crosshair[i] = new LineSegments(
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
      new ThreeVector3(-pWidth / 2, -pWidth / 2, 0),
      new ThreeVector3(-pWidth / 2, pWidth / 2, 0),
      new ThreeVector3(pWidth / 2, pWidth / 2, 0),
      new ThreeVector3(pWidth / 2, -pWidth / 2, 0),
      new ThreeVector3(-pWidth / 2, -pWidth / 2, 0),
    ];
    const tdBorderGeometry = new BufferGeometry().setFromPoints(vertices);

    this.TDViewBorders = new Line(
      tdBorderGeometry,
      this.getLineBasicMaterial(OrthoViewColors[this.planeID], 1),
    );
  }

  setDisplayCrosshair = (value: boolean): void => {
    this.displayCrosshair = value;
  };

  getLineBasicMaterial = memoize(
    (color: number, linewidth: number) => {
      const material = new LineBasicMaterial({
        color,
        linewidth,
      });
      this.lineMaterials.push(material);
      return material;
    },
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
    // Scale to base voxel space which is the same coordinate space the cameras use
    const baseVoxelUnit = getBaseVoxelInUnit(this.datasetScaleFactor);
    const scaleVector: Vector3 = V3.scale([xFactor, yFactor, 1], baseVoxelUnit);
    this.getMeshes().map((mesh) => mesh.scale.set(...scaleVector));
  }

  setBaseRotation = (rotVec: Euler): void => {
    this.baseRotation.copy(rotVec);
    this.baseRotationMatrix.makeRotationFromEuler(this.baseRotation);
  };

  updateToFlycamRotation = (flycamRotationVec: Euler): void => {
    // rotVec must be in "ZYX" order as this is how the flycam operates (see flycam_reducer setRotationReducer)
    this.flycamRotationMatrix.makeRotationFromEuler(flycamRotationVec);
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
    // The offset is in world space already so no scaling is necessary.
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
  setLinearInterpolationEnabled = (_enabled: boolean) => {
    this.plane.material.updateUseInterpolation();
  };

  destroy() {
    this.materialFactory.destroy();
    this.storePropertyUnsubscribers.forEach((f) => {
      f();
    });
    this.storePropertyUnsubscribers = [];

    for (const mesh of this.getMeshes()) {
      mesh.geometry.dispose();
    }
    for (const material of this.lineMaterials) {
      material.dispose();
    }
    this.lineMaterials = [];
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
