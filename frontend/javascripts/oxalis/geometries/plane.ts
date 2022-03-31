// @flow
import * as THREE from "three";
import _ from "lodash";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import Dimensions from "oxalis/model/dimensions";
import PlaneMaterialFactory from "oxalis/geometries/materials/plane_material_factory";
import Store from "oxalis/store";
import type { OrthoView, Vector3, Vector4 } from "oxalis/constants";
import constants, {
  OrthoViewColors,
  OrthoViewCrosshairColors,
  OrthoViewGrayCrosshairColor,
  OrthoViewValues,
} from "oxalis/constants";

class Plane {
  // This class is supposed to collect all the Geometries that belong to one single plane such as
  // the plane itself, its texture, borders and crosshairs.
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'plane' has no initializer and is not def... Remove this comment to see the full error message
  plane: typeof THREE.Mesh;
  planeID: OrthoView;
  displayCrosshair: boolean;
  baseScaleVector: typeof THREE.Vector3;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'crosshair' has no initializer and is not... Remove this comment to see the full error message
  crosshair: Array<typeof THREE.LineSegments>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'TDViewBorders' has no initializer and is... Remove this comment to see the full error message
  TDViewBorders: typeof THREE.Line;
  lastScaleFactors: [number, number];

  constructor(planeID: OrthoView) {
    this.planeID = planeID;
    this.displayCrosshair = true;
    this.lastScaleFactors = [-1, -1];
    // VIEWPORT_WIDTH means that the plane should be that many voxels wide in the
    // dimension with the highest resolution. In all other dimensions, the plane
    // is smaller in voxels, so that it is squared in nm.
    // --> scaleInfo.baseVoxel
    const baseVoxelFactors = getBaseVoxelFactors(Store.getState().dataset.dataSource.scale);
    const scaleArray = Dimensions.transDim(baseVoxelFactors, this.planeID);
    // @ts-expect-error ts-migrate(2741) FIXME: Property 'prototype' is missing in type 'Vector3' ... Remove this comment to see the full error message
    this.baseScaleVector = new THREE.Vector3(...scaleArray);
    this.createMeshes();
  }

  createMeshes(): void {
    const pWidth = constants.VIEWPORT_WIDTH;
    // create plane
    const planeGeo = new THREE.PlaneGeometry(pWidth, pWidth, 1, 1);
    const textureMaterial = new PlaneMaterialFactory(
      this.planeID,
      true,
      OrthoViewValues.indexOf(this.planeID),
    )
      .setup()
      .getMaterial();
    // @ts-expect-error ts-migrate(2739) FIXME: Type 'Mesh' is missing the following properties fr... Remove this comment to see the full error message
    this.plane = new THREE.Mesh(planeGeo, textureMaterial);
    // create crosshair
    const crosshairGeometries = new Array(2);
    this.crosshair = new Array(2);

    for (let i = 0; i <= 1; i++) {
      crosshairGeometries[i] = new THREE.Geometry();
      crosshairGeometries[i].vertices.push(
        new THREE.Vector3((-pWidth / 2) * i, (-pWidth / 2) * (1 - i), 0),
      );
      crosshairGeometries[i].vertices.push(new THREE.Vector3(-25 * i, -25 * (1 - i), 0));
      crosshairGeometries[i].vertices.push(new THREE.Vector3(25 * i, 25 * (1 - i), 0));
      crosshairGeometries[i].vertices.push(
        new THREE.Vector3((pWidth / 2) * i, (pWidth / 2) * (1 - i), 0),
      );
      // @ts-expect-error ts-migrate(2739) FIXME: Type 'LineSegments' is missing the following prope... Remove this comment to see the full error message
      this.crosshair[i] = new THREE.LineSegments(
        crosshairGeometries[i],
        this.getLineBasicMaterial(OrthoViewCrosshairColors[this.planeID][i], 1),
      );
      // Objects are rendered according to their renderOrder (lowest to highest).
      // The default renderOrder is 0. In order for the crosshairs to be shown
      // render them AFTER the plane has been rendered.
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'renderOrder' does not exist on type 'typ... Remove this comment to see the full error message
      this.crosshair[i].renderOrder = 1;
    }

    // create borders
    const TDViewBordersGeo = new THREE.Geometry();
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(pWidth / 2, pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(pWidth / 2, -pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    // @ts-expect-error ts-migrate(2739) FIXME: Type 'Line' is missing the following properties fr... Remove this comment to see the full error message
    this.TDViewBorders = new THREE.Line(
      TDViewBordersGeo,
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
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'material' does not exist on type 'typeof... Remove this comment to see the full error message
      this.crosshair[i].material = this.getLineBasicMaterial(
        OrthoViewCrosshairColors[this.planeID][i],
        1,
      );
    });
  };

  setGrayCrosshairColor = (): void => {
    [0, 1].forEach((i) => {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'material' does not exist on type 'typeof... Remove this comment to see the full error message
      this.crosshair[i].material = this.getLineBasicMaterial(OrthoViewGrayCrosshairColor, 1);
    });
  };

  updateAnchorPoints(
    anchorPoint: Vector4 | null | undefined,
    fallbackAnchorPoint: Vector4 | null | undefined,
  ): void {
    if (anchorPoint) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'material' does not exist on type 'typeof... Remove this comment to see the full error message
      this.plane.material.setAnchorPoint(anchorPoint);
    }

    if (fallbackAnchorPoint) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'material' does not exist on type 'typeof... Remove this comment to see the full error message
      this.plane.material.setFallbackAnchorPoint(fallbackAnchorPoint);
    }
  }

  setScale(xFactor: number, yFactor: number): void {
    if (this.lastScaleFactors[0] !== xFactor || this.lastScaleFactors[1] !== yFactor) {
      this.lastScaleFactors[0] = xFactor;
      this.lastScaleFactors[1] = yFactor;
    } else {
      return;
    }

    const scaleVec = new THREE.Vector3().multiplyVectors(
      new THREE.Vector3(xFactor, yFactor, 1),
      // @ts-expect-error ts-migrate(2345) FIXME: Argument of type 'typeof Vector3' is not assignabl... Remove this comment to see the full error message
      this.baseScaleVector,
    );
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'scale' does not exist on type 'typeof Me... Remove this comment to see the full error message
    this.plane.scale.copy(scaleVec);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'scale' does not exist on type 'typeof Li... Remove this comment to see the full error message
    this.TDViewBorders.scale.copy(scaleVec);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'scale' does not exist on type 'typeof Li... Remove this comment to see the full error message
    this.crosshair[0].scale.copy(scaleVec);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'scale' does not exist on type 'typeof Li... Remove this comment to see the full error message
    this.crosshair[1].scale.copy(scaleVec);
  }

  setRotation = (rotVec: Vector3): void => {
    [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]].map((mesh) =>
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'setRotationFromEuler' does not exist on ... Remove this comment to see the full error message
      mesh.setRotationFromEuler(rotVec),
    );
  };

  // In case the plane's position was offset to make geometries
  // on the plane visible (by moving the plane to the back), one can
  // additionall pass the originalPosition (which is necessary for the
  // shader)
  setPosition = (pos: Vector3, originalPosition?: Vector3): void => {
    const [x, y, z] = pos;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'typeof... Remove this comment to see the full error message
    this.TDViewBorders.position.set(x, y, z);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'typeof... Remove this comment to see the full error message
    this.crosshair[0].position.set(x, y, z);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'typeof... Remove this comment to see the full error message
    this.crosshair[1].position.set(x, y, z);
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'position' does not exist on type 'typeof... Remove this comment to see the full error message
    this.plane.position.set(x, y, z);

    if (originalPosition == null) {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'material' does not exist on type 'typeof... Remove this comment to see the full error message
      this.plane.material.setGlobalPosition(x, y, z);
    } else {
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'material' does not exist on type 'typeof... Remove this comment to see the full error message
      this.plane.material.setGlobalPosition(
        originalPosition[0],
        originalPosition[1],
        originalPosition[2],
      );
    }
  };

  setVisible = (isVisible: boolean, isDataVisible?: boolean): void => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'typeof ... Remove this comment to see the full error message
    this.plane.visible = isDataVisible != null ? isDataVisible : isVisible;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'typeof ... Remove this comment to see the full error message
    this.TDViewBorders.visible = isVisible;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'typeof ... Remove this comment to see the full error message
    this.crosshair[0].visible = isVisible && this.displayCrosshair;
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'visible' does not exist on type 'typeof ... Remove this comment to see the full error message
    this.crosshair[1].visible = isVisible && this.displayCrosshair;
  };

  getMeshes = () => [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]];
  setLinearInterpolationEnabled = (enabled: boolean) => {
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'material' does not exist on type 'typeof... Remove this comment to see the full error message
    this.plane.material.setUseBilinearFiltering(enabled);
  };
}

export default Plane;
