/**
 * scene_controller.js
 * @flow
 */

import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
import { V3 } from "libs/mjs";
import {
  getPosition,
  getPlaneScalingFactor,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import { getBoundaries } from "oxalis/model/accessors/dataset_accessor";
import Model from "oxalis/model";
import Store from "oxalis/store";
import { getVoxelPerNM } from "oxalis/model/scaleinfo";
import Plane from "oxalis/geometries/plane";
import Skeleton from "oxalis/geometries/skeleton";
import Cube from "oxalis/geometries/cube";
import ContourGeometry from "oxalis/geometries/contourgeometry";
import Dimensions from "oxalis/model/dimensions";
import { OrthoViews, OrthoViewValues, OrthoViewValuesWithoutTDView } from "oxalis/constants";
import type { Vector3, OrthoViewType, OrthoViewMapType, BoundingBoxType } from "oxalis/constants";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { getRenderer } from "oxalis/controller/renderer";
import ArbitraryPlane from "oxalis/geometries/arbitrary_plane";

const CUBE_COLOR = 0x999999;

class SceneController {
  skeleton: Skeleton;
  current: number;
  displayPlane: OrthoViewMapType<boolean>;
  planeShift: Vector3;
  cube: Cube;
  userBoundingBox: Cube;
  taskBoundingBox: ?Cube;
  contour: ContourGeometry;
  planes: OrthoViewMapType<Plane>;
  rootNode: THREE.Object3D;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  rootGroup: THREE.Object3D;

  // This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
  // element depending on the provided flycam.
  constructor() {
    _.extend(this, BackboneEvents);
    this.current = 0;
    this.displayPlane = {
      [OrthoViews.PLANE_XY]: true,
      [OrthoViews.PLANE_YZ]: true,
      [OrthoViews.PLANE_XZ]: true,
    };
    this.planeShift = [0, 0, 0];
  }

  initialize() {
    this.renderer = getRenderer();

    this.createMeshes();
    this.bindToEvents();
    this.scene = new THREE.Scene();

    // Because the voxel coordinates do not have a cube shape but are distorted,
    // we need to distort the entire scene to provide an illustration that is
    // proportional to the actual size in nm.
    // For some reason, all objects have to be put into a group object. Changing
    // scene.scale does not have an effect.
    this.rootGroup = new THREE.Object3D();
    this.rootGroup.add(this.getRootNode());

    // The dimension(s) with the highest resolution will not be distorted
    this.rootGroup.scale.copy(new THREE.Vector3(...Store.getState().dataset.dataSource.scale));
    // Add scene to the group, all Geometries are then added to group
    this.scene.add(this.rootGroup);
  }

  createMeshes(): void {
    this.rootNode = new THREE.Object3D();

    // Cubes
    const { lowerBoundary, upperBoundary } = getBoundaries(Store.getState().dataset);
    this.cube = new Cube({
      min: lowerBoundary,
      max: upperBoundary,
      color: CUBE_COLOR,
      showCrossSections: true,
    });
    this.cube.getMeshes().forEach(mesh => this.rootNode.add(mesh));

    this.userBoundingBox = new Cube({
      max: [0, 0, 0],
      color: 0xffaa00,
      showCrossSections: true,
    });
    this.userBoundingBox.getMeshes().forEach(mesh => this.rootNode.add(mesh));

    const taskBoundingBox = Store.getState().tracing.boundingBox;
    this.buildTaskingBoundingBox(taskBoundingBox);

    if (Store.getState().tracing.type === "volume") {
      this.contour = new ContourGeometry();
      this.contour.getMeshes().forEach(mesh => this.rootNode.add(mesh));
    }

    if (Store.getState().tracing.type === "skeleton") {
      this.skeleton = new Skeleton();
      this.rootNode.add(this.skeleton.getRootNode());
    }

    this.planes = {
      [OrthoViews.PLANE_XY]: new Plane(OrthoViews.PLANE_XY),
      [OrthoViews.PLANE_YZ]: new Plane(OrthoViews.PLANE_YZ),
      [OrthoViews.PLANE_XZ]: new Plane(OrthoViews.PLANE_XZ),
    };

    this.planes[OrthoViews.PLANE_XY].setRotation(new THREE.Euler(Math.PI, 0, 0));
    this.planes[OrthoViews.PLANE_YZ].setRotation(new THREE.Euler(Math.PI, 1 / 2 * Math.PI, 0));
    this.planes[OrthoViews.PLANE_XZ].setRotation(new THREE.Euler(-1 / 2 * Math.PI, 0, 0));

    for (const plane of _.values(this.planes)) {
      plane.getMeshes().forEach(mesh => this.rootNode.add(mesh));
    }
  }

  buildTaskingBoundingBox(taskBoundingBox: ?BoundingBoxType): void {
    if (taskBoundingBox != null) {
      if (this.taskBoundingBox != null) {
        this.taskBoundingBox.getMeshes().forEach(mesh => this.rootNode.remove(mesh));
      }

      this.taskBoundingBox = new Cube({
        min: taskBoundingBox.min,
        max: taskBoundingBox.max,
        color: 0x00ff00,
        showCrossSections: true,
      });
      this.taskBoundingBox.getMeshes().forEach(mesh => this.rootNode.add(mesh));
    }
  }

  updateSceneForCam = (id: OrthoViewType): void => {
    // This method is called for each of the four cams. Even
    // though they are all looking at the same scene, some
    // things have to be changed for each cam.

    this.cube.updateForCam(id);
    this.userBoundingBox.updateForCam(id);
    Utils.__guard__(this.taskBoundingBox, x => x.updateForCam(id));

    if (id !== OrthoViews.TDView) {
      let ind;
      for (const planeId of OrthoViewValuesWithoutTDView) {
        if (planeId === id) {
          this.planes[planeId].setOriginalCrosshairColor();
          this.planes[planeId].setVisible(true);
          const pos = _.clone(getPosition(Store.getState().flycam));
          ind = Dimensions.getIndices(planeId);
          // Offset the plane so the user can see the skeletonTracing behind the plane
          pos[ind[2]] +=
            planeId === OrthoViews.PLANE_XY ? this.planeShift[ind[2]] : -this.planeShift[ind[2]];
          this.planes[planeId].setPosition(new THREE.Vector3(...pos));
        } else {
          this.planes[planeId].setVisible(false);
        }
      }
    } else {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        const pos = getPosition(Store.getState().flycam);
        this.planes[planeId].setPosition(new THREE.Vector3(pos[0], pos[1], pos[2]));
        this.planes[planeId].setGrayCrosshairColor();
        this.planes[planeId].setVisible(true);
        this.planes[planeId].plane.visible = this.displayPlane[planeId];
      }
    }
  };

  update = (optPlane?: ArbitraryPlane): void => {
    const gPos = getPosition(Store.getState().flycam);
    const globalPosVec = new THREE.Vector3(...gPos);
    const planeScale = getPlaneScalingFactor(Store.getState().flycam);

    // The anchor point refers to the top-left-front bucket of the bounding box
    // which covers all three rendered planes. Relative to this anchor point,
    // all buckets necessary for rendering are addressed. The anchorPoint is
    // defined with bucket indices for the coordinate system of the current zoomStep.
    let anchorPoint;
    // The fallbackAnchorPoint is similar to the anchorPoint, but refers to the
    // coordinate system of the next zoomStep which is used for fallback rendering.
    let fallbackAnchorPoint;

    const zoomStep = getRequestLogZoomStep(Store.getState());
    for (const dataLayer of Model.getAllLayers()) {
      [anchorPoint, fallbackAnchorPoint] = dataLayer.layerRenderingManager.updateDataTextures(
        gPos,
        zoomStep,
      );
    }

    if (optPlane) {
      optPlane.updateAnchorPoints(anchorPoint, fallbackAnchorPoint);
      optPlane.setPosition(globalPosVec);
    } else {
      for (const currentPlane of _.values(this.planes)) {
        currentPlane.updateAnchorPoints(anchorPoint, fallbackAnchorPoint);
        currentPlane.setPosition(globalPosVec);
        currentPlane.setScale(planeScale);
      }
    }
  };

  setDisplayCrosshair(value: boolean): void {
    for (const plane of _.values(this.planes)) {
      plane.setDisplayCrosshair(value);
    }
    app.vent.trigger("rerender");
  }

  setClippingDistance(value: number): void {
    // convert nm to voxel
    const voxelPerNMVector = getVoxelPerNM(Store.getState().dataset.dataSource.scale);
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
  };

  getRootNode(): THREE.Object3D {
    return this.rootNode;
  }

  setUserBoundingBox(bb: ?BoundingBoxType): void {
    if (bb == null) bb = { min: [0, 0, 0], max: [0, 0, 0] };
    this.userBoundingBox.setCorners(bb.min, bb.max);
  }

  setSegmentationAlpha(alpha: number): void {
    for (const plane of _.values(this.planes)) {
      plane.setSegmentationAlpha(alpha);
    }
  }

  setIsMappingEnabled(isMappingEnabled: boolean): void {
    for (const plane of _.values(this.planes)) {
      plane.setIsMappingEnabled(isMappingEnabled);
    }
    app.vent.trigger("rerender");
  }

  stopPlaneMode(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(false);
    }
    this.cube.setVisibility(false);
    this.userBoundingBox.setVisibility(false);
    Utils.__guard__(this.taskBoundingBox, x => x.setVisibility(false));
  }

  startPlaneMode(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(true);
    }
    this.cube.setVisibility(true);
    this.userBoundingBox.setVisibility(true);
    Utils.__guard__(this.taskBoundingBox, x => x.setVisibility(true));
  }

  bindToEvents(): void {
    listenToStoreProperty(
      storeState => storeState.userConfiguration.clippingDistance,
      clippingDistance => this.setClippingDistance(clippingDistance),
    );

    listenToStoreProperty(
      storeState => storeState.userConfiguration.displayCrosshair,
      displayCrosshair => this.setDisplayCrosshair(displayCrosshair),
    );

    listenToStoreProperty(
      storeState => storeState.userConfiguration.tdViewDisplayPlanes,
      tdViewDisplayPlanes => this.setDisplayPlanes(tdViewDisplayPlanes),
    );

    listenToStoreProperty(
      storeState => storeState.datasetConfiguration.segmentationOpacity,
      segmentationOpacity => this.setSegmentationAlpha(segmentationOpacity),
    );

    listenToStoreProperty(
      storeState => storeState.datasetConfiguration.interpolation,
      interpolation => this.setInterpolation(interpolation),
    );

    listenToStoreProperty(
      storeState => storeState.tracing.userBoundingBox,
      bb => this.setUserBoundingBox(bb),
    );

    listenToStoreProperty(
      storeState => storeState.tracing.boundingBox,
      bb => this.buildTaskingBoundingBox(bb),
    );

    listenToStoreProperty(
      storeState => storeState.temporaryConfiguration.activeMapping.isMappingEnabled,
      isMappingEnabled => this.setIsMappingEnabled(isMappingEnabled),
    );
  }
}

export default new SceneController();
