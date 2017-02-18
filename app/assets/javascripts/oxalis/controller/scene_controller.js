/**
 * scene_controller.js
 * @flow
 */

import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import Backbone from "backbone";
import * as THREE from "three";
import Flycam2d from "oxalis/model/flycam2d";
import Model from "oxalis/model";
import scaleInfo from "oxalis/model/scaleinfo";
import Plane from "oxalis/geometries/plane";
import Skeleton from "oxalis/geometries/skeleton";
import Cube from "oxalis/geometries/cube";
import ContourGeometry from "oxalis/geometries/contourgeometry";
import VolumeGeometry from "oxalis/geometries/volumegeometry";
import Dimensions from "oxalis/model/dimensions";
import constants, { OrthoViews, OrthoViewValues, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import type { Vector3, OrthoViewType, OrthoViewMapType } from "oxalis/constants";
import type { BoundingBoxType } from "oxalis/model";
import PolygonFactory from "oxalis/view/polygons/polygon_factory";

class SceneController {
  skeleton: Skeleton;
  CUBE_COLOR: number;
  upperBoundary: Vector3;
  flycam: Flycam2d;
  model: Model;
  current: number;
  displayPlane: OrthoViewMapType<boolean>;
  planeShift: Vector3;
  pingBinary: boolean;
  pingBinarySeg: boolean;
  volumeMeshes: any;
  polygonFactory: ?PolygonFactory;
  cube: Cube;
  userBoundingBox: Cube;
  taskBoundingBox: Cube;
  contour: ContourGeometry;
  planes: OrthoViewMapType<Plane>;

  // Copied from backbone events (TODO: handle this better)
  trigger: Function;
  listenTo: Function;

  static initClass() {
    // This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
    // element depending on the provided flycam.

    this.prototype.CUBE_COLOR = 0x999999;
  }

  constructor(upperBoundary: Vector3, flycam: Flycam2d, model: Model) {
    _.extend(this, Backbone.Events);
    this.upperBoundary = upperBoundary;
    this.flycam = flycam;
    this.model = model;

    this.current = 0;
    this.displayPlane = {
      [OrthoViews.PLANE_XY]: true,
      [OrthoViews.PLANE_YZ]: true,
      [OrthoViews.PLANE_XZ]: true,
    };
    this.planeShift = [0, 0, 0];
    this.pingBinary = true;
    this.pingBinarySeg = true;

    this.volumeMeshes = [];

    this.createMeshes();
    this.bindToEvents();
  }


  createMeshes(): void {
    // Cubes
    this.cube = new Cube(this.model, {
      max: this.upperBoundary,
      color: this.CUBE_COLOR,
      showCrossSections: true });
    this.userBoundingBox = new Cube(this.model, {
      max: [0, 0, 0],
      color: 0xffaa00,
      showCrossSections: true });

    if (this.model.taskBoundingBox != null) {
      this.taskBoundingBox = new Cube(this.model, {
        min: this.model.taskBoundingBox.min,
        max: this.model.taskBoundingBox.max,
        color: 0x00ff00,
        showCrossSections: true });
    }

    if (this.model.volumeTracing != null) {
      this.contour = new ContourGeometry(this.model.volumeTracing, this.model.flycam);
    }

    if (this.model.skeletonTracing != null) {
      this.skeleton = new Skeleton(this.model);
    }

    // create Meshes
    const createPlane = planeIndex =>
      new Plane(constants.PLANE_WIDTH, constants.TEXTURE_WIDTH, this.flycam, planeIndex, this.model);

    this.planes = {
      [OrthoViews.PLANE_XY]: createPlane(OrthoViews.PLANE_XY),
      [OrthoViews.PLANE_YZ]: createPlane(OrthoViews.PLANE_YZ),
      [OrthoViews.PLANE_XZ]: createPlane(OrthoViews.PLANE_XZ),
    };

    this.planes[OrthoViews.PLANE_XY].setRotation(new THREE.Euler(Math.PI, 0, 0));
    this.planes[OrthoViews.PLANE_YZ].setRotation(new THREE.Euler(Math.PI, (1 / 2) * Math.PI, 0));
    this.planes[OrthoViews.PLANE_XZ].setRotation(new THREE.Euler((-1 / 2) * Math.PI, 0, 0));
  }


  removeShapes(): void {
    this.trigger("removeGeometries", this.volumeMeshes);
  }


  showShapes(bb: BoundingBoxType, resolution: number, id: number): void {
    if (this.model.getSegmentationBinary() == null) { return; }

    if (this.polygonFactory != null) {
      this.polygonFactory.cancel();
    }

    this.polygonFactory = new PolygonFactory(
      this.model.getSegmentationBinary().cube,
      resolution,
      bb.min, bb.max, id,
    );

    this.polygonFactory.getTriangles().then((triangles) => {
      if (triangles == null) {
        return;
      }
      this.removeShapes();
      this.volumeMeshes = [];

      for (const triangleIdString of Object.keys(triangles)) {
        const triangleId = parseInt(triangleIdString, 10);
        const mappedId = this.model.getSegmentationBinary().cube.mapId(triangleId);
        const volume = new VolumeGeometry(triangles[triangleId], mappedId);
        this.volumeMeshes = this.volumeMeshes.concat(volume.getMeshes());
      }

      this.trigger("newGeometries", this.volumeMeshes);
      app.vent.trigger("rerender");
      this.polygonFactory = null;
    });
  }


  updateSceneForCam = (id: OrthoViewType): void => {
    // This method is called for each of the four cams. Even
    // though they are all looking at the same scene, some
    // things have to be changed for each cam.

    let mesh;
    let pos;
    this.cube.updateForCam(id);
    this.userBoundingBox.updateForCam(id);
    Utils.__guard__(this.taskBoundingBox, x => x.updateForCam(id));
    Utils.__guard__(this.skeleton, x1 => x1.updateForCam(id));

    if (id !== OrthoViews.TDView) {
      let ind;
      for (mesh of this.volumeMeshes) {
        mesh.visible = false;
      }
      for (const planeId of OrthoViewValuesWithoutTDView) {
        if (planeId === id) {
          this.planes[planeId].setOriginalCrosshairColor();
          this.planes[planeId].setVisible(true);
          pos = this.flycam.getPosition().slice();
          ind = Dimensions.getIndices(planeId);
          // Offset the plane so the user can see the skeletonTracing behind the plane
          pos[ind[2]] += planeId === OrthoViews.PLANE_XY ? this.planeShift[ind[2]] : -this.planeShift[ind[2]];
          this.planes[planeId].setPosition(new THREE.Vector3(...pos));
        } else {
          this.planes[planeId].setVisible(false);
        }
      }
    } else {
      for (mesh of this.volumeMeshes) {
        mesh.visible = true;
      }
      for (const planeId of OrthoViewValuesWithoutTDView) {
        pos = this.flycam.getPosition();
        this.planes[planeId].setPosition(new THREE.Vector3(pos[0], pos[1], pos[2]));
        this.planes[planeId].setGrayCrosshairColor();
        this.planes[planeId].setVisible(true);
        this.planes[planeId].plane.visible = this.displayPlane[planeId];
      }
    }
  }


  update = (): void => {
    const gPos = this.flycam.getPosition();
    const globalPosVec = new THREE.Vector3(...gPos);
    const planeScale = this.flycam.getPlaneScalingFactor();
    for (const planeId of OrthoViewValuesWithoutTDView) {
      this.planes[planeId].updateTexture();
      // Update plane position
      this.planes[planeId].setPosition(globalPosVec);
      // Update plane scale
      this.planes[planeId].setScale(planeScale);
    }
  }


  setDisplayCrosshair(value: boolean): void {
    for (const plane of _.values(this.planes)) {
      plane.setDisplayCrosshair(value);
    }
    app.vent.trigger("rerender");
  }


  setClippingDistance(value: number): void {
    // convert nm to voxel
    for (let i = 0; i <= 2; i++) {
      this.planeShift[i] = value * scaleInfo.voxelPerNM[i];
    }
    app.vent.trigger("rerender");
  }


  setInterpolation(value: boolean): void {
    for (const plane of _.values(this.planes)) {
      plane.setLinearInterpolationEnabled(value);
    }
    app.vent.trigger("rerender");
  }


  setDisplayPlanes = (value: boolean): void => {
    for (const planeId of OrthoViewValues) {
      this.displayPlane[planeId] = value;
    }
    app.vent.trigger("rerender");
  }


  getMeshes = (): Array<THREE.Mesh> => {
    let result = [];
    for (const plane of _.values(this.planes)) {
      result = result.concat(plane.getMeshes());
    }

    for (const geometry of [this.skeleton, this.contour, this.cube, this.userBoundingBox, this.taskBoundingBox]) {
      if (geometry != null) {
        result = result.concat(geometry.getMeshes());
      }
    }

    return result;
  }

  setUserBoundingBox(bb: BoundingBoxType): void {
    this.userBoundingBox.setCorners(bb.min, bb.max);
  }

  setSegmentationAlpha(alpha: number): void {
    for (const plane of _.values(this.planes)) {
      plane.setSegmentationAlpha(alpha);
    }
    this.pingBinarySeg = alpha !== 0;
  }

  pingDataLayer(dataLayerName: string): boolean {
    if (this.model.binary[dataLayerName].category === "color") {
      return this.pingBinary;
    }
    if (this.model.binary[dataLayerName].category === "segmentation") {
      return this.pingBinarySeg;
    }
    return false;
  }


  stop(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(false);
    }
    this.cube.setVisibility(false);
    this.userBoundingBox.setVisibility(false);
    Utils.__guard__(this.taskBoundingBox, x => x.setVisibility(false));

    Utils.__guard__(this.skeleton, x1 => x1.restoreVisibility());
    Utils.__guard__(this.skeleton, x2 => x2.setSizeAttenuation(true));
  }


  start(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(true);
    }
    this.cube.setVisibility(true);
    this.userBoundingBox.setVisibility(true);
    Utils.__guard__(this.taskBoundingBox, x => x.setVisibility(true));

    Utils.__guard__(this.skeleton, x1 => x1.setSizeAttenuation(false));
  }


  bindToEvents(): void {
    const { user } = this.model;
    this.listenTo(this.model, "change:userBoundingBox", (bb) => { this.setUserBoundingBox(bb); });
    this.listenTo(user, "change:segmentationOpacity", (model, opacity) => {
      this.setSegmentationAlpha(opacity);
    });
    this.listenTo(user, "change:clippingDistance", (model, value) => { this.setClippingDistance(value); });
    this.listenTo(user, "change:displayCrosshair", (model, value) => { this.setDisplayCrosshair(value); });
    this.listenTo(this.model.datasetConfiguration, "change:interpolation", (model, value) => {
      this.setInterpolation(value);
    });
    this.listenTo(user, "change:tdViewDisplayPlanes", (model, value) => { this.setDisplayPlanes(value); });
  }
}
SceneController.initClass();

export default SceneController;
