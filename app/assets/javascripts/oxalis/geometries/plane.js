/**
 * plane.js
 * @flow
 */

import app from "app";
import scaleInfo from "oxalis/model/scaleinfo";
import * as THREE from "three";
import Model from "oxalis/model";
import Flycam2d from "oxalis/model/flycam2d";
import PlaneMaterialFactory from "oxalis/geometries/materials/plane_material_factory";
import Dimensions from "oxalis/model/dimensions";
import { OrthoViews, OrthoViewColors } from "oxalis/constants";
import type { OrthoViewType, Vector3 } from "oxalis/constants";

const CROSSHAIR_COLORS = {
  [OrthoViews.PLANE_XY]: [0x0000ff, 0x00ff00],
  [OrthoViews.PLANE_XZ]: [0xff0000, 0x00ff00],
  [OrthoViews.PLANE_YZ]: [0x0000ff, 0xff0000],
  [OrthoViews.TDView]: [0x000000, 0x000000],
};
const GRAY_CH_COLOR = 0x222222;

class Plane {
  // This class is supposed to collect all the Geometries that belong to one single plane such as
  // the plane itself, its texture, borders and crosshairs.

  plane: THREE.Mesh;
  flycam: Flycam2d;
  planeID: OrthoViewType;
  model: Model;
  planeWidth: number;
  textureWidth: number;
  displayCosshair: boolean;
  scaleVector: THREE.Vector3;
  crosshair: Array<THREE.LineSegments>;
  TDViewBorders: THREE.Line;

  constructor(planeWidth: number, textureWidth: number, flycam: Flycam2d, planeID: OrthoViewType, model: Model) {
    this.flycam = flycam;
    this.planeID = planeID;
    this.model = model;
    this.planeWidth = planeWidth;
    this.textureWidth = textureWidth;
    this.displayCosshair = true;

    // planeWidth means that the plane should be that many voxels wide in the
    // dimension with the highest resolution. In all other dimensions, the plane
    // is smaller in voxels, so that it is squared in nm.
    // --> scaleInfo.baseVoxel
    const scaleArray = Dimensions.transDim(scaleInfo.baseVoxelFactors, this.planeID);
    this.scaleVector = new THREE.Vector3(...scaleArray);

    this.createMeshes(planeWidth, textureWidth);
  }

  createMeshes(pWidth: number, tWidth: number): void {
    // create plane
    const planeGeo = new THREE.PlaneGeometry(pWidth, pWidth, 1, 1);
    const textureMaterial = new PlaneMaterialFactory(this.model, tWidth).getMaterial();
    this.plane = new THREE.Mesh(planeGeo, textureMaterial);

    // create crosshair
    const crosshairGeometries = new Array(2);
    this.crosshair = new Array(2);
    for (let i = 0; i <= 1; i++) {
      crosshairGeometries[i] = new THREE.Geometry();
      crosshairGeometries[i].vertices.push(new THREE.Vector3((-pWidth / 2) * i, (-pWidth / 2) * (1 - i), 0));
      crosshairGeometries[i].vertices.push(new THREE.Vector3(-25 * i, -25 * (1 - i), 0));
      crosshairGeometries[i].vertices.push(new THREE.Vector3(25 * i, 25 * (1 - i), 0));
      crosshairGeometries[i].vertices.push(new THREE.Vector3((pWidth / 2) * i, (pWidth / 2) * (1 - i), 0));
      this.crosshair[i] = new THREE.LineSegments(crosshairGeometries[i], new THREE.LineBasicMaterial({ color: CROSSHAIR_COLORS[this.planeID][i], linewidth: 1 }));
    }

    // create borders
    const TDViewBordersGeo = new THREE.Geometry();
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(pWidth / 2, pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(pWidth / 2, -pWidth / 2, 0));
    TDViewBordersGeo.vertices.push(new THREE.Vector3(-pWidth / 2, -pWidth / 2, 0));
    this.TDViewBorders = new THREE.Line(TDViewBordersGeo, new THREE.LineBasicMaterial({ color: OrthoViewColors[this.planeID], linewidth: 1 }));
  }


  setDisplayCrosshair = (value: boolean): void => {
    this.displayCosshair = value;
  }


  setOriginalCrosshairColor = (): void => {
    [0, 1].forEach((i) => {
      this.crosshair[i].material = new THREE.LineBasicMaterial({ color: CROSSHAIR_COLORS[this.planeID][i], linewidth: 1 });
    });
  }

  setGrayCrosshairColor = (): void => {
    [0, 1].forEach((i) => {
      this.crosshair[i].material = new THREE.LineBasicMaterial({ color: GRAY_CH_COLOR, linewidth: 1 });
    });
  }


  updateTexture(): void {
    const area = this.flycam.getArea(this.planeID);
    if (this.model != null) {
      for (const name of Object.keys(this.model.binary)) {
        const binary = this.model.binary[name];
        const dataBuffer = binary.planes[this.planeID].get({
          position: this.flycam.getTexturePosition(this.planeID),
          zoomStep: this.flycam.getIntegerZoomStep(),
          area: this.flycam.getArea(this.planeID),
        });

        if (dataBuffer) {
          this.plane.material.setData(name, dataBuffer);
          app.vent.trigger("rerender");
        }
      }
    }

    this.plane.material.setScaleParams({
      repeat: {
        x: (area[2] - area[0]) / this.textureWidth,
        y: (area[3] - area[1]) / this.textureWidth,
      },
      offset: {
        x: area[0] / this.textureWidth,
        y: 1 - (area[3] / this.textureWidth),
      },
    });
  }


  setScale = (factor: number): void => {
    const scaleVec = new THREE.Vector3().multiplyVectors(new THREE.Vector3(factor, factor, factor), this.scaleVector);
    this.plane.scale.copy(scaleVec);
    this.TDViewBorders.scale.copy(scaleVec);
    this.crosshair[0].scale.copy(scaleVec);
    this.crosshair[1].scale.copy(scaleVec);
  }


  setRotation = (rotVec: Vector3): void => {
    [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]]
      .map(mesh => mesh.setRotationFromEuler(rotVec));
  }


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
  }


  setVisible = (visible: boolean): void => {
    this.plane.visible = this.TDViewBorders.visible = visible;
    this.crosshair[0].visible = this.crosshair[1].visible = visible && this.displayCosshair;
  }


  setSegmentationAlpha(alpha: number): void {
    this.plane.material.setSegmentationAlpha(alpha);
    app.vent.trigger("rerender");
  }


  getMeshes = () => [this.plane, this.TDViewBorders, this.crosshair[0], this.crosshair[1]]


  setLinearInterpolationEnabled = (enabled: boolean) => {
    this.plane.material.setColorInterpolation(
      enabled ? THREE.LinearFilter : THREE.NearestFilter,
    );
  }
}

export default Plane;
