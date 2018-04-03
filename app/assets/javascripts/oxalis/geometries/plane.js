/**
 * plane.js
 * @flow
 */

import app from "app";
import { getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import * as THREE from "three";
import Model from "oxalis/model";
import { getPosition } from "oxalis/model/accessors/flycam_accessor";
import Store from "oxalis/store";
import { sanitizeName } from "oxalis/geometries/materials/abstract_plane_material_factory";
import PlaneMaterialFactory from "oxalis/geometries/materials/plane_material_factory";
import Dimensions from "oxalis/model/dimensions";
import constants, {
  OrthoViews,
  OrthoViewColors,
  OrthoViewCrosshairColors,
  OrthoViewGrayCrosshairColor,
} from "oxalis/constants";
import type { OrthoViewType, Vector3 } from "oxalis/constants";
import _ from "lodash";

class Plane {
  // This class is supposed to collect all the Geometries that belong to one single plane such as
  // the plane itself, its texture, borders and crosshairs.

  plane: THREE.Mesh;
  planeID: OrthoViewType;
  displayCrosshair: boolean;
  scaleVector: THREE.Vector3;
  crosshair: Array<THREE.LineSegments>;
  TDViewBorders: THREE.Line;
  renderer: THREE.WebGLRenderer;

  constructor(planeID: OrthoViewType) {
    this.planeID = planeID;
    this.displayCrosshair = true;

    // PLANE_WIDTH means that the plane should be that many voxels wide in the
    // dimension with the highest resolution. In all other dimensions, the plane
    // is smaller in voxels, so that it is squared in nm.
    // --> scaleInfo.baseVoxel
    const baseVoxelFactors = getBaseVoxelFactors(Store.getState().dataset.scale);
    const scaleArray = Dimensions.transDim(baseVoxelFactors, this.planeID);
    this.scaleVector = new THREE.Vector3(...scaleArray);

    this.createMeshes();
  }

  createMeshes(): void {
    const pWidth = constants.PLANE_WIDTH;
    const tWidth = constants.DATA_TEXTURE_WIDTH;
    // create plane
    const planeGeo = new THREE.PlaneGeometry(pWidth, pWidth, 1, 1);

    // Gather data textures from binary
    const textures = {};
    for (const name of Object.keys(Model.binary)) {
      const binary = Model.binary[name];
      const [dataTexture, lookUpTexture] = binary.getDataTextures();
      const [fallbackDataTexture, fallbackLookUpTexture] = binary.getFallbackDataTextures();

      const shaderName = sanitizeName(name);
      const lookUpBufferName = sanitizeName(`${name}_lookup`);
      textures[shaderName] = dataTexture;
      textures[lookUpBufferName] = lookUpTexture;

      const fshaderName = sanitizeName(`${name}_fallback`);
      const flookUpBufferName = sanitizeName(`${name}_lookup_fallback`);

      textures[fshaderName] = fallbackDataTexture;
      textures[flookUpBufferName] = fallbackLookUpTexture;
    }
    const textureMaterial = new PlaneMaterialFactory(tWidth, textures, this.planeID)
      .setup()
      .getMaterial();

    this.plane = new THREE.Mesh(planeGeo, textureMaterial);

    // create crosshair
    const crosshairGeometries = new Array(2);
    this.crosshair = new Array(2);
    for (let i = 0; i <= 1; i++) {
      crosshairGeometries[i] = new THREE.Geometry();
      crosshairGeometries[i].vertices.push(
        new THREE.Vector3(-pWidth / 2 * i, -pWidth / 2 * (1 - i), 0),
      );
      crosshairGeometries[i].vertices.push(new THREE.Vector3(-25 * i, -25 * (1 - i), 0));
      crosshairGeometries[i].vertices.push(new THREE.Vector3(25 * i, 25 * (1 - i), 0));
      crosshairGeometries[i].vertices.push(
        new THREE.Vector3(pWidth / 2 * i, pWidth / 2 * (1 - i), 0),
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

  updateAnchorPoints(anchorPoint: ?Vector3, fallbackAnchorPoint: ?Vector3): void {
    if (anchorPoint) {
      this.plane.material.setAnchorPoint(anchorPoint);
    }

    if (fallbackAnchorPoint) {
      this.plane.material.setFallbackAnchorPoint(fallbackAnchorPoint);
    }
  }

  setScale = (factor: number): void => {
    const scaleVec = new THREE.Vector3().multiplyVectors(
      new THREE.Vector3(factor, factor, factor),
      this.scaleVector,
    );
    this.plane.scale.copy(scaleVec);
    this.TDViewBorders.scale.copy(scaleVec);
    this.crosshair[0].scale.copy(scaleVec);
    this.crosshair[1].scale.copy(scaleVec);
  };

  setRotation = (rotVec: Vector3): void => {
    [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]].map(mesh =>
      mesh.setRotationFromEuler(rotVec),
    );
  };

  setPosition = (posVec: Vector3): void => {
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
    app.vent.trigger("rerender");
  }

  getMeshes = () => [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]];

  setLinearInterpolationEnabled = (enabled: boolean) => {
    this.plane.material.setUseBilinearFiltering(enabled);
  };
}

export default Plane;
