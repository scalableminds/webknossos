/**
 * plane.js
 * @flow
 */

import * as THREE from "three";
import _ from "lodash";

import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import { applyAspectRatioToWidth } from "oxalis/model/accessors/view_mode_accessor";
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
  OrthoViews,
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
  renderer: THREE.WebGLRenderer;

  constructor(planeID: OrthoView) {
    this.planeID = planeID;
    this.displayCrosshair = true;

    // PLANE_WIDTH means that the plane should be that many voxels wide in the
    // dimension with the highest resolution. In all other dimensions, the plane
    // is smaller in voxels, so that it is squared in nm.
    // --> scaleInfo.baseVoxel
    const baseVoxelFactors = getBaseVoxelFactors(Store.getState().dataset.dataSource.scale);
    const scaleArray = Dimensions.transDim(baseVoxelFactors, this.planeID);
    this.baseScaleVector = new THREE.Vector3(...scaleArray);

    this.createMeshes();
  }

  createMeshes(): void {
    const pWidth = constants.PLANE_WIDTH;
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

  setScale(factor: number, aspectRatio: number): void {
    const [xFactor, yFactor] = applyAspectRatioToWidth(aspectRatio, factor);
    const scaleVec = new THREE.Vector3().multiplyVectors(
      new THREE.Vector3(xFactor, yFactor, factor),
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

    const offset = new THREE.Vector3(0, 0, 0);
    if (this.planeID === OrthoViews.PLANE_XY) {
      offset.z = 1;
    } else if (this.planeID === OrthoViews.PLANE_YZ) {
      offset.x = -1;
    } else if (this.planeID === OrthoViews.PLANE_XZ) {
      offset.y = -1;
    }
    this.plane.position.copy(offset.addVectors(posVec, offset));

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

  getMeshes = () => [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]];

  setLinearInterpolationEnabled = (enabled: boolean) => {
    this.plane.material.setUseBilinearFiltering(enabled);
  };

  setIsMappingEnabled = (isMappingEnabled: boolean) => {
    this.plane.material.setIsMappingEnabled(isMappingEnabled);
  };
}

export default Plane;
