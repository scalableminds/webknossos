/**
 * scene_controller.js
 * @flow
 */

import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import Backbone from "backbone";
import * as THREE from "three";
import { V3 } from "libs/mjs";
import { getPosition, getPlaneScalingFactor, getViewportBoundingBox } from "oxalis/model/accessors/flycam_accessor";
import Model from "oxalis/model";
import Store from "oxalis/store";
import { getVoxelPerNM } from "oxalis/model/scaleinfo";
import Plane from "oxalis/geometries/plane";
import Skeleton from "oxalis/geometries/skeleton";
import Cube from "oxalis/geometries/cube";
import ContourGeometry from "oxalis/geometries/contourgeometry";
import VolumeGeometry from "oxalis/geometries/volumegeometry";
import Dimensions from "oxalis/model/dimensions";
import constants, { OrthoViews, OrthoViewValues, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import PolygonFactory from "oxalis/view/polygons/polygon_factory";
import type { Vector3, OrthoViewType, OrthoViewMapType, BoundingBoxType } from "oxalis/constants";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";


class SceneController {
  skeleton: Skeleton;
  CUBE_COLOR: number;
  current: number;
  displayPlane: OrthoViewMapType<boolean>;
  planeShift: Vector3;
  pingBinary: boolean;
  pingBinarySeg: boolean;
  volumeMeshes: THREE.Object3D;
  polygonFactory: ?PolygonFactory;
  cube: Cube;
  userBoundingBox: Cube;
  taskBoundingBox: ?Cube;
  contour: ContourGeometry;
  planes: OrthoViewMapType<Plane>;
  rootNode: THREE.Object3D;

  static initClass() {
    // This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
    // element depending on the provided flycam.

    this.prototype.CUBE_COLOR = 0x999999;
  }

  constructor() {
    _.extend(this, Backbone.Events);
    this.current = 0;
    this.displayPlane = {
      [OrthoViews.PLANE_XY]: true,
      [OrthoViews.PLANE_YZ]: true,
      [OrthoViews.PLANE_XZ]: true,
    };
    this.planeShift = [0, 0, 0];
    this.pingBinary = true;
    this.pingBinarySeg = true;

    this.createMeshes();
    this.bindToEvents();
  }


  createMeshes(): void {
    this.rootNode = new THREE.Object3D();

    // Cubes
    this.cube = new Cube({
      min: Model.lowerBoundary,
      max: Model.upperBoundary,
      color: this.CUBE_COLOR,
      showCrossSections: true });
    this.cube.getMeshes().forEach(mesh => this.rootNode.add(mesh));

    this.userBoundingBox = new Cube({
      max: [0, 0, 0],
      color: 0xffaa00,
      showCrossSections: true });
    this.userBoundingBox.getMeshes().forEach(mesh => this.rootNode.add(mesh));

    const taskBoundingBox = Store.getState().tracing.boundingBox;
    if (taskBoundingBox != null) {
      this.taskBoundingBox = new Cube({
        min: taskBoundingBox.min,
        max: taskBoundingBox.max,
        color: 0x00ff00,
        showCrossSections: true });
      this.taskBoundingBox.getMeshes().forEach(mesh => this.rootNode.add(mesh));
    }

    this.volumeMeshes = new THREE.Object3D();
    if (Store.getState().tracing.type === "volume") {
      this.contour = new ContourGeometry();
      this.contour.getMeshes().forEach(mesh => this.rootNode.add(mesh));
    }

    if (Store.getState().tracing.type === "skeleton") {
      this.skeleton = new Skeleton();
      this.rootNode.add(this.skeleton.getRootNode());
    }

    // create Meshes
    const createPlane = planeIndex =>
      new Plane(constants.PLANE_WIDTH, constants.TEXTURE_WIDTH, planeIndex, Model);

    this.planes = {
      [OrthoViews.PLANE_XY]: createPlane(OrthoViews.PLANE_XY),
      [OrthoViews.PLANE_YZ]: createPlane(OrthoViews.PLANE_YZ),
      [OrthoViews.PLANE_XZ]: createPlane(OrthoViews.PLANE_XZ),
    };

    this.planes[OrthoViews.PLANE_XY].setRotation(new THREE.Euler(Math.PI, 0, 0));
    this.planes[OrthoViews.PLANE_YZ].setRotation(new THREE.Euler(Math.PI, (1 / 2) * Math.PI, 0));
    this.planes[OrthoViews.PLANE_XZ].setRotation(new THREE.Euler((-1 / 2) * Math.PI, 0, 0));

    for (const plane of _.values(this.planes)) {
      plane.getMeshes().forEach(mesh => this.rootNode.add(mesh));
    }
  }


  renderVolumeIsosurface(cellId: number): void {
    const state = Store.getState();
    if (!state.userConfiguration.isosurfaceDisplay || Model.getSegmentationBinary() == null) {
      return;
    }

    if (this.polygonFactory != null) {
      this.polygonFactory.cancel();
    }

    const factor = state.userConfiguration.isosurfaceBBsize;
    const bb = getViewportBoundingBox(state);

    for (let i = 0; i <= 2; i++) {
      const width = bb.max[i] - bb.min[i];
      const diff = ((factor - 1) * width) / 2;
      bb.min[i] -= diff;
      bb.max[i] += diff;
    }


    this.polygonFactory = new PolygonFactory(
      Model.getSegmentationBinary().cube,
      state.userConfiguration.isosurfaceResolution,
      bb.min, bb.max, cellId,
    );
    this.polygonFactory.getTriangles().then((triangles) => {
      if (triangles == null) {
        return;
      }
      this.rootNode.remove(this.volumeMeshes);
      this.volumeMeshes = new THREE.Object3D();
      this.rootNode.add(this.volumeMeshes);

      for (const triangleIdString of Object.keys(triangles)) {
        const triangleId = parseInt(triangleIdString, 10);
        const mappedId = Model.getSegmentationBinary().cube.mapId(triangleId);
        const volume = new VolumeGeometry(triangles[triangleId], mappedId);
        volume.getMeshes().forEach(mesh => this.volumeMeshes.add(mesh));
      }
      app.vent.trigger("rerender");
      this.polygonFactory = null;
    });
  }


  updateSceneForCam = (id: OrthoViewType): void => {
    // This method is called for each of the four cams. Even
    // though they are all looking at the same scene, some
    // things have to be changed for each cam.

    let pos;
    this.cube.updateForCam(id);
    this.userBoundingBox.updateForCam(id);
    Utils.__guard__(this.taskBoundingBox, x => x.updateForCam(id));
    Utils.__guard__(this.skeleton, x1 => x1.updateForCam(id));

    if (id !== OrthoViews.TDView) {
      let ind;
      this.volumeMeshes.visible = false;
      for (const planeId of OrthoViewValuesWithoutTDView) {
        if (planeId === id) {
          this.planes[planeId].setOriginalCrosshairColor();
          this.planes[planeId].setVisible(true);
          pos = _.clone(getPosition(Store.getState().flycam));
          ind = Dimensions.getIndices(planeId);
          // Offset the plane so the user can see the skeletonTracing behind the plane
          pos[ind[2]] += planeId === OrthoViews.PLANE_XY ? this.planeShift[ind[2]] : -this.planeShift[ind[2]];
          this.planes[planeId].setPosition(new THREE.Vector3(...pos));
        } else {
          this.planes[planeId].setVisible(false);
        }
      }
    } else {
      this.volumeMeshes.visible = true;
      for (const planeId of OrthoViewValuesWithoutTDView) {
        pos = getPosition(Store.getState().flycam);
        this.planes[planeId].setPosition(new THREE.Vector3(pos[0], pos[1], pos[2]));
        this.planes[planeId].setGrayCrosshairColor();
        this.planes[planeId].setVisible(true);
        this.planes[planeId].plane.visible = this.displayPlane[planeId];
      }
    }
  }


  update = (): void => {
    const gPos = getPosition(Store.getState().flycam);
    const globalPosVec = new THREE.Vector3(...gPos);
    const planeScale = getPlaneScalingFactor(Store.getState().flycam);
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
    const voxelPerNMVector = getVoxelPerNM(Store.getState().dataset.scale);
    V3.scale(voxelPerNMVector, value, this.planeShift);

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


  getRootNode(): THREE.Object3D {
    return this.rootNode;
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
    if (Model.binary[dataLayerName].category === "color") {
      return this.pingBinary;
    }
    if (Model.binary[dataLayerName].category === "segmentation") {
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
  }


  start(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(true);
    }
    this.cube.setVisibility(true);
    this.userBoundingBox.setVisibility(true);
    Utils.__guard__(this.taskBoundingBox, x => x.setVisibility(true));
  }


  bindToEvents(): void {
    Store.subscribe(() => {
      const { clippingDistance, displayCrosshair, tdViewDisplayPlanes } = Store.getState().userConfiguration;
      const { segmentationOpacity } = Store.getState().datasetConfiguration;
      this.setSegmentationAlpha(segmentationOpacity);
      this.setClippingDistance(clippingDistance);
      this.setDisplayCrosshair(displayCrosshair);
      this.setDisplayPlanes(tdViewDisplayPlanes);
      this.setInterpolation(Store.getState().datasetConfiguration.interpolation);
    });
    listenToStoreProperty(
      storeState => storeState.temporaryConfiguration.userBoundingBox,
      bb => this.setUserBoundingBox(Utils.computeBoundingBoxFromArray(bb)),
    );
  }
}
SceneController.initClass();

export default SceneController;
