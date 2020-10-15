/**
 * scene_controller.js
 * @flow
 */

import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
import TWEEN from "tween.js";
import _ from "lodash";

import type { MeshMetaData } from "types/api_flow_types";
import { V3 } from "libs/mjs";
import { getBoundaries } from "oxalis/model/accessors/dataset_accessor";
import {
  getPosition,
  getPlaneScalingFactor,
  getRequestLogZoomStep,
} from "oxalis/model/accessors/flycam_accessor";
import { getRenderer } from "oxalis/controller/renderer";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { getVoxelPerNM } from "oxalis/model/scaleinfo";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import ArbitraryPlane from "oxalis/geometries/arbitrary_plane";
import ContourGeometry from "oxalis/geometries/contourgeometry";
import Cube from "oxalis/geometries/cube";
import Dimensions from "oxalis/model/dimensions";
import Model from "oxalis/model";
import Plane from "oxalis/geometries/plane";
import Skeleton from "oxalis/geometries/skeleton";
import Store, { type UserBoundingBox } from "oxalis/store";
import * as Utils from "libs/utils";
import app from "app";
import constants, {
  type BoundingBoxType,
  type OrthoView,
  type OrthoViewMap,
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  type Vector3,
} from "oxalis/constants";
import window from "libs/window";

import { jsConvertCellIdToHSLA } from "oxalis/shaders/segmentation.glsl.js";
import { setSceneController } from "./scene_controller_provider";

const CUBE_COLOR = 0x999999;

class SceneController {
  skeleton: Skeleton;
  current: number;
  isPlaneVisible: OrthoViewMap<boolean>;
  planeShift: Vector3;
  datasetBoundingBox: Cube;
  userBoundingBoxGroup: typeof THREE.Group;
  userBoundingBoxes: Array<Cube>;
  taskBoundingBox: ?Cube;
  contour: ContourGeometry;
  planes: OrthoViewMap<Plane>;
  rootNode: typeof THREE.Object3D;
  renderer: typeof THREE.WebGLRenderer;
  scene: typeof THREE.Scene;
  rootGroup: typeof THREE.Object3D;
  stlMeshes: { [key: string]: typeof THREE.Mesh } = {};

  // isosurfacesRootGroup holds lights and one group per segmentation id.
  // Each group can hold multiple meshes.
  isosurfacesRootGroup: typeof THREE.Group;
  isosurfacesGroupsPerSegmentationId: { [key: number]: typeof THREE.Group } = {};

  // This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
  // element depending on the provided flycam.
  constructor() {
    _.extend(this, BackboneEvents);
    this.current = 0;
    this.isPlaneVisible = {
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
    this.isosurfacesRootGroup = new THREE.Group();

    // The dimension(s) with the highest resolution will not be distorted
    this.rootGroup.scale.copy(new THREE.Vector3(...Store.getState().dataset.dataSource.scale));
    // Add scene to the group, all Geometries are then added to group
    this.scene.add(this.rootGroup);
    this.scene.add(this.isosurfacesRootGroup);

    this.rootGroup.add(new THREE.DirectionalLight());
    this.addLights();

    this.setupDebuggingMethods();
  }

  setupDebuggingMethods() {
    // These methods are attached to window, since we would run into circular import errors
    // otherwise.
    window.addBucketMesh = (position: Vector3, zoomStep: number, optColor?: string) => {
      const bucketExtent = constants.BUCKET_WIDTH * 2 ** zoomStep;
      const bucketSize = [bucketExtent, bucketExtent, bucketExtent];
      const boxGeometry = new THREE.BoxGeometry(...bucketSize);
      const edgesGeometry = new THREE.EdgesGeometry(boxGeometry);
      const material = new THREE.LineBasicMaterial({
        color: optColor || (zoomStep === 0 ? 0xff00ff : 0x00ffff),
        linewidth: 1,
      });
      const cube = new THREE.LineSegments(edgesGeometry, material);
      cube.position.x = position[0] + bucketSize[0] / 2;
      cube.position.y = position[1] + bucketSize[1] / 2;
      cube.position.z = position[2] + bucketSize[2] / 2;
      this.rootNode.add(cube);
      return cube;
    };

    window.removeBucketMesh = (mesh: typeof THREE.LineSegments) => this.rootNode.remove(mesh);
  }

  getIsosurfaceGeometry(cellId: number): typeof THREE.Geometry {
    return this.isosurfacesGroupsPerSegmentationId[cellId];
  }

  addSTL(meshMetaData: MeshMetaData, geometry: typeof THREE.Geometry): void {
    const { id, position } = meshMetaData;
    if (this.stlMeshes[id] != null) {
      console.warn(`Mesh with id ${id} has already been added to the scene.`);
      return;
    }
    geometry.computeVertexNormals();

    const meshMaterial = new THREE.MeshNormalMaterial();
    const mesh = new THREE.Mesh(geometry, meshMaterial);
    this.scene.add(mesh);
    this.stlMeshes[id] = mesh;
    this.updateMeshPostion(id, position);
  }

  addIsosurfaceFromVertices(vertices: Float32Array, segmentationId: number): void {
    let geometry = new THREE.BufferGeometry();
    geometry.addAttribute("position", new THREE.BufferAttribute(vertices, 3));

    // convert to normal (unbuffered) geometry to merge vertices
    geometry = new THREE.Geometry().fromBufferGeometry(geometry);
    if (window.__isosurfaceMergeVertices) {
      geometry.mergeVertices();
    }
    geometry.computeVertexNormals();
    geometry.computeFaceNormals();

    // and back to a BufferGeometry
    geometry = new THREE.BufferGeometry().fromGeometry(geometry);

    this.addIsosurfaceFromGeometry(geometry, segmentationId);
  }

  addIsosurfaceFromGeometry(geometry: typeof THREE.Geometry, segmentationId: number): void {
    const [hue] = jsConvertCellIdToHSLA(segmentationId);
    const color = new THREE.Color().setHSL(hue, 0.5, 0.1);

    const meshMaterial = new THREE.MeshLambertMaterial({ color });
    meshMaterial.side = THREE.DoubleSide;
    meshMaterial.transparent = true;

    const mesh = new THREE.Mesh(geometry, meshMaterial);

    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const tweenAnimation = new TWEEN.Tween({ opacity: 0 });
    tweenAnimation
      .to({ opacity: 0.95 }, 500)
      .onUpdate(function onUpdate() {
        meshMaterial.opacity = this.opacity;
        app.vent.trigger("rerender");
      })
      .start();

    if (this.isosurfacesGroupsPerSegmentationId[segmentationId] == null) {
      const newGroup = new THREE.Group();
      this.isosurfacesGroupsPerSegmentationId[segmentationId] = newGroup;
      this.isosurfacesRootGroup.add(newGroup);
      newGroup.cellId = segmentationId;
    }
    this.isosurfacesGroupsPerSegmentationId[segmentationId].add(mesh);
  }

  removeIsosurfaceById(segmentationId: number): void {
    if (this.isosurfacesGroupsPerSegmentationId[segmentationId] == null) {
      return;
    }

    const group = this.isosurfacesGroupsPerSegmentationId[segmentationId];
    this.isosurfacesRootGroup.remove(group);
    this.isosurfacesGroupsPerSegmentationId[segmentationId] = null;
  }

  addLights(): void {
    // At the moment, we only attach an AmbientLight for the isosurfaces group.
    // The PlaneView attaches a directional light directly to the TD camera,
    // so that the light moves along the cam.

    const ambientLight = new THREE.AmbientLight(0x404040, 15); // soft white light
    this.isosurfacesRootGroup.add(ambientLight);
  }

  removeSTL(id: string): void {
    this.rootGroup.remove(this.stlMeshes[id]);
  }

  setMeshVisibility(id: string, visibility: boolean): void {
    this.stlMeshes[id].visible = visibility;
  }

  updateMeshPostion(id: string, position: Vector3): void {
    const [x, y, z] = position;
    const mesh = this.stlMeshes[id];
    mesh.position.x = x;
    mesh.position.y = y;
    mesh.position.z = z;
  }

  createMeshes(): void {
    this.rootNode = new THREE.Object3D();
    this.userBoundingBoxGroup = new THREE.Group();
    this.rootNode.add(this.userBoundingBoxGroup);
    this.userBoundingBoxes = [];

    // Cubes
    const { lowerBoundary, upperBoundary } = getBoundaries(Store.getState().dataset);
    this.datasetBoundingBox = new Cube({
      min: lowerBoundary,
      max: upperBoundary,
      color: CUBE_COLOR,
      showCrossSections: true,
    });
    this.datasetBoundingBox.getMeshes().forEach(mesh => this.rootNode.add(mesh));

    const taskBoundingBox = getSomeTracing(Store.getState().tracing).boundingBox;
    this.buildTaskingBoundingBox(taskBoundingBox);

    if (Store.getState().tracing.volume != null) {
      this.contour = new ContourGeometry();
      this.contour.getMeshes().forEach(mesh => this.rootNode.add(mesh));
    }

    if (Store.getState().tracing.skeleton != null) {
      this.skeleton = new Skeleton();
      this.rootNode.add(this.skeleton.getRootNode());
    }

    this.planes = {
      [OrthoViews.PLANE_XY]: new Plane(OrthoViews.PLANE_XY),
      [OrthoViews.PLANE_YZ]: new Plane(OrthoViews.PLANE_YZ),
      [OrthoViews.PLANE_XZ]: new Plane(OrthoViews.PLANE_XZ),
    };

    this.planes[OrthoViews.PLANE_XY].setRotation(new THREE.Euler(Math.PI, 0, 0));
    this.planes[OrthoViews.PLANE_YZ].setRotation(new THREE.Euler(Math.PI, (1 / 2) * Math.PI, 0));
    this.planes[OrthoViews.PLANE_XZ].setRotation(new THREE.Euler((-1 / 2) * Math.PI, 0, 0));

    for (const plane of _.values(this.planes)) {
      plane.getMeshes().forEach(mesh => this.rootNode.add(mesh));
    }

    // Hide all objects at first, they will be made visible later if needed
    this.stopPlaneMode();
  }

  buildTaskingBoundingBox(taskBoundingBox: ?BoundingBoxType): void {
    if (taskBoundingBox != null) {
      if (this.taskBoundingBox != null) {
        this.taskBoundingBox.getMeshes().forEach(mesh => this.rootNode.remove(mesh));
      }

      const { viewMode } = Store.getState().temporaryConfiguration;
      this.taskBoundingBox = new Cube({
        min: taskBoundingBox.min,
        max: taskBoundingBox.max,
        color: 0x00ff00,
        showCrossSections: true,
      });
      this.taskBoundingBox.getMeshes().forEach(mesh => this.rootNode.add(mesh));
      if (constants.MODES_ARBITRARY.includes(viewMode)) {
        Utils.__guard__(this.taskBoundingBox, bb => bb.setVisibility(false));
      }
    }
  }

  updateSceneForCam = (id: OrthoView, hidePlanes: boolean = false): void => {
    // This method is called for each of the four cams. Even
    // though they are all looking at the same scene, some
    // things have to be changed for each cam.

    this.datasetBoundingBox.updateForCam(id);
    this.userBoundingBoxes.forEach(bbCube => bbCube.updateForCam(id));
    Utils.__guard__(this.taskBoundingBox, x => x.updateForCam(id));

    this.isosurfacesRootGroup.visible = id === OrthoViews.TDView;
    if (id !== OrthoViews.TDView) {
      let ind;
      for (const planeId of OrthoViewValuesWithoutTDView) {
        if (planeId === id) {
          this.planes[planeId].setOriginalCrosshairColor();
          this.planes[planeId].setVisible(!hidePlanes);
          const originalPosition = getPosition(Store.getState().flycam);
          const pos = _.clone(originalPosition);
          ind = Dimensions.getIndices(planeId);
          // Offset the plane so the user can see the skeletonTracing behind the plane
          pos[ind[2]] +=
            planeId === OrthoViews.PLANE_XY ? this.planeShift[ind[2]] : -this.planeShift[ind[2]];
          this.planes[planeId].setPosition(pos, originalPosition);
        } else {
          this.planes[planeId].setVisible(false);
        }
      }
    } else {
      const { tdViewDisplayPlanes } = Store.getState().userConfiguration;
      for (const planeId of OrthoViewValuesWithoutTDView) {
        const pos = getPosition(Store.getState().flycam);
        this.planes[planeId].setPosition(pos);
        this.planes[planeId].setGrayCrosshairColor();
        this.planes[planeId].setVisible(true);
        this.planes[planeId].plane.visible = this.isPlaneVisible[planeId] && tdViewDisplayPlanes;
      }
    }
  };

  update(optArbitraryPlane?: ArbitraryPlane): void {
    const state = Store.getState();
    const { flycam } = state;
    const globalPosition = getPosition(flycam);

    // The anchor point refers to the top-left-front bucket of the bounding box
    // which covers all three rendered planes. Relative to this anchor point,
    // all buckets necessary for rendering are addressed. The anchorPoint is
    // defined with bucket indices for the coordinate system of the current zoomStep.
    let anchorPoint;

    const zoomStep = getRequestLogZoomStep(Store.getState());
    for (const dataLayer of Model.getAllLayers()) {
      anchorPoint = dataLayer.layerRenderingManager.updateDataTextures(globalPosition, zoomStep);
    }

    if (optArbitraryPlane) {
      optArbitraryPlane.updateAnchorPoints(anchorPoint);
    } else {
      for (const currentPlane of _.values(this.planes)) {
        currentPlane.updateAnchorPoints(anchorPoint);
        const [scaleX, scaleY] = getPlaneScalingFactor(state, flycam, currentPlane.planeID);
        const isVisible = scaleX > 0 && scaleY > 0;
        if (isVisible) {
          this.isPlaneVisible[currentPlane.planeID] = true;
          currentPlane.setScale(scaleX, scaleY);
        } else {
          this.isPlaneVisible[currentPlane.planeID] = false;
          // Set the scale to non-zero values, since threejs will otherwise
          // complain about non-invertible matrices.
          currentPlane.setScale(1, 1);
        }
      }
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

  getRootNode(): typeof THREE.Object3D {
    return this.rootNode;
  }

  setUserBoundingBoxes(bboxes: Array<UserBoundingBox>): void {
    const newUserBoundingBoxGroup = new THREE.Group();
    this.userBoundingBoxes = bboxes.map(({ boundingBox, isVisible, color }) => {
      const { min, max } = boundingBox;
      const bbColor = [color[0] * 255, color[1] * 255, color[2] * 255];
      const bbCube = new Cube({
        min,
        max,
        color: Utils.rgbToInt(bbColor),
        showCrossSections: true,
      });
      bbCube.setVisibility(isVisible);
      bbCube.getMeshes().forEach(mesh => newUserBoundingBoxGroup.add(mesh));
      return bbCube;
    });
    this.rootNode.remove(this.userBoundingBoxGroup);
    this.userBoundingBoxGroup = newUserBoundingBoxGroup;
    this.rootNode.add(this.userBoundingBoxGroup);
  }

  stopPlaneMode(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(false);
    }
    this.datasetBoundingBox.setVisibility(false);
    this.userBoundingBoxGroup.visible = false;
    Utils.__guard__(this.taskBoundingBox, x => x.setVisibility(false));
    if (this.isosurfacesRootGroup != null) {
      this.isosurfacesRootGroup.visible = false;
    }
  }

  startPlaneMode(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(true);
    }
    this.datasetBoundingBox.setVisibility(true);
    this.userBoundingBoxGroup.visible = true;
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
      storeState => storeState.datasetConfiguration.interpolation,
      interpolation => this.setInterpolation(interpolation),
    );

    listenToStoreProperty(
      storeState => getSomeTracing(storeState.tracing).userBoundingBoxes,
      bboxes => this.setUserBoundingBoxes(bboxes),
    );

    listenToStoreProperty(
      storeState => getSomeTracing(storeState.tracing).boundingBox,
      bb => this.buildTaskingBoundingBox(bb),
    );
  }
}

export type SceneControllerType = SceneController;

export function initializeSceneController() {
  const controller = new SceneController();
  setSceneController(controller);
  controller.initialize();
}

// Please use scene_controller_provider to get a reference to SceneController. This avoids
// problems with circular dependencies.
export default {};
