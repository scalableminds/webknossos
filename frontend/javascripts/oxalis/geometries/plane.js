/**
 * plane.js
 * @flow
 */

import * as THREE from "three";
import _ from "lodash";

import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import Dimensions from "oxalis/model/dimensions";
import PlaneMaterialFactory from "oxalis/geometries/materials/plane_material_factory";
import Store from "oxalis/store";
import constants, {
  type OrthoView,
  OrthoViewColors,
  OrthoViewCrosshairColors,
  OrthoViewGrayCrosshairColor,
  OrthoViewValues,
  type Vector3,
  type Vector4,
} from "oxalis/constants";

class Plane {
  // This class is supposed to collect all the Geometries that belong to one single plane such as
  // the plane itself, its texture, borders and crosshairs.

  plane: THREE.Mesh;
  planeID: OrthoView;
  displayCrosshair: boolean;
  baseScaleVector: THREE.Vector3;
  crosshair: Array<THREE.LineSegments>;
  TDViewBorders: THREE.Line;

  constructor(planeID: OrthoView) {
    this.planeID = planeID;
    this.displayCrosshair = true;

    // VIEWPORT_WIDTH means that the plane should be that many voxels wide in the
    // dimension with the highest resolution. In all other dimensions, the plane
    // is smaller in voxels, so that it is squared in nm.
    // --> scaleInfo.baseVoxel
    const baseVoxelFactors = getBaseVoxelFactors(Store.getState().dataset.dataSource.scale);
    const scaleArray = Dimensions.transDim(baseVoxelFactors, this.planeID);
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
      this.crosshair[i] = new THREE.LineSegments(
        crosshairGeometries[i],
        this.getLineBasicMaterial(OrthoViewCrosshairColors[this.planeID][i], 1),
      );
      // Objects are rendered according to their renderOrder (lowest to highest).
      // The default renderOrder is 0. In order for the crosshairs to be shown
      // render them AFTER the plane has been rendered.
      this.crosshair[i].renderOrder = 1;
    }

    // create borders
    const TDViewBordersGeo = new THREE.Geometry();
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(pWidth / 2, pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(pWidth / 2, -pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    this.TDViewBorders = new THREE.Line(
      TDViewBordersGeo,
      this.getLineBasicMaterial(OrthoViewColors[this.planeID], 1),
    );
  }

  setDisplayCrosshair = (value: boolean): void => {
    this.displayCrosshair = value;
  };

  getLineBasicMaterial = _.memoize(
    (color: number, linewidth: number) => new THREE.LineBasicMaterial({ color, linewidth }),
    (color: number, linewidth: number) => `${color}_${linewidth}`,
  );

  setOriginalCrosshairColor = (): void => {
    [0, 1].forEach(i => {
      this.crosshair[i].material = this.getLineBasicMaterial(
        OrthoViewCrosshairColors[this.planeID][i],
        1,
      );
    });
  };

  setGrayCrosshairColor = (): void => {
    [0, 1].forEach(i => {
      this.crosshair[i].material = this.getLineBasicMaterial(OrthoViewGrayCrosshairColor, 1);
    });
  };

  updateAnchorPoints(anchorPoint: ?Vector4, fallbackAnchorPoint: ?Vector4): void {
    if (anchorPoint) {
      this.plane.material.setAnchorPoint(anchorPoint);
    }
    if (fallbackAnchorPoint) {
      this.plane.material.setFallbackAnchorPoint(fallbackAnchorPoint);
    }
  }

  setScale(xFactor: number, yFactor: number): void {
    const scaleVec = new THREE.Vector3().multiplyVectors(
      new THREE.Vector3(xFactor, yFactor, 1),
      this.baseScaleVector,
    );
    this.plane.scale.copy(scaleVec);
    this.TDViewBorders.scale.copy(scaleVec);
    this.crosshair[0].scale.copy(scaleVec);
    this.crosshair[1].scale.copy(scaleVec);
  }

  setRotation = (rotVec: Vector3): void => {
    [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]].map(mesh =>
      mesh.setRotationFromEuler(rotVec),
    );
  };

  setPosition = (posVec: THREE.Vector3): void => {
    this.TDViewBorders.position.copy(posVec);
    this.crosshair[0].position.copy(posVec);
    this.crosshair[1].position.copy(posVec);
    this.plane.position.copy(posVec);

    const globalPosition = getPosition(Store.getState().flycam);
    this.plane.material.setGlobalPosition(globalPosition);
  };

  setVisible = (visible: boolean): void => {
    this.plane.visible = visible;
    this.TDViewBorders.visible = visible;
    this.crosshair[0].visible = visible && this.displayCrosshair;
    this.crosshair[1].visible = visible && this.displayCrosshair;
  };

  setSegmentationAlpha(alpha: number): void {
    this.plane.material.setSegmentationAlpha(alpha);
  }

  setSegmentationVisibility(isVisible: boolean): void {
    this.plane.material.setSegmentationVisibility(isVisible);
  }

  getMeshes = () => [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]];

  setLinearInterpolationEnabled = (enabled: boolean) => {
    this.plane.material.setUseBilinearFiltering(enabled);
  };
}

export default Plane;
