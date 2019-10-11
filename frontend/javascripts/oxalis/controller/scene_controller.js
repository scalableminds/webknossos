/**
 * scene_controller.js
 * @flow
 */

import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
import TWEEN from "tween.js";
import _ from "lodash";

import type { MeshMetaData } from "admin/api_flow_types";
import { type Matrix4x4, V3 } from "libs/mjs";
import { getBoundaries } from "oxalis/model/accessors/dataset_accessor";
import {
  getPosition,
  getPlaneScalingFactor,
  getRequestLogZoomStep,
  getZoomedMatrix,
} from "oxalis/model/accessors/flycam_accessor";
import {
  enforceSkeletonTracing,
  getActiveNode,
} from "oxalis/model/accessors/skeletontracing_accessor";
import { setDiameterProperties } from "oxalis/model/actions/settings_actions";
import { setNodeDiameterPropertiesAction } from "oxalis/model/actions/skeletontracing_actions";
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
import Store from "oxalis/store";
import { defaultDiameterProperties } from "oxalis/default_state";
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

import { convertCellIdToHSLA } from "../view/right-menu/mapping_info_view";
import { setSceneController } from "./scene_controller_provider";

const CUBE_COLOR = 0x999999;
const numbOfVerticesInEllipse = 100;

class SceneController {
  skeleton: Skeleton;
  current: number;
  isPlaneVisible: OrthoViewMap<boolean>;
  planeShift: Vector3;
  cube: Cube;
  userBoundingBox: Cube;
  taskBoundingBox: ?Cube;
  contour: ContourGeometry;
  planes: OrthoViewMap<Plane>;
  rootNode: THREE.Object3D;
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  rootGroup: THREE.Object3D;

  stlMeshes: { [key: string]: THREE.Mesh } = {};
  diameter: ?THREE.Line;
  diameterProperties: Object;
  // We need to ignore the first calls of setDiameterForNode as it is called each time when loading a tracing. This might cause the
  isInitialSetDiameterForNodeCall: boolean;
  // isosurfacesRootGroup holds lights and one group per segmentation id.
  // Each group can hold multiple meshes.
  isosurfacesRootGroup: THREE.Group;
  isosurfacesGroupsPerSegmentationId: { [key: number]: THREE.Group } = {};

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
    this.diameter = null;
    // TODO: Load diameter from active cell
    // TODO: Listen to active cell property
    this.diameterProperties = Store.getState().temporaryConfiguration.diameterProperties;
    this.isInitialSetDiameterForNodeCall = true;
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

    window.removeBucketMesh = (mesh: THREE.LineSegments) => this.rootNode.remove(mesh);
  }

  getActiveNode = () => {
    const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
    let currentNode = null;
    getActiveNode(skeletonTracing).map(activeNode => {
      currentNode = activeNode;
    });
    return currentNode;
  };

  getActiveTreeId = () => {
    const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
    return skeletonTracing.activeTreeId;
  };

  getDiameter = () => this.diameter;

  showDiameter = () => {
    const currentNode = this.getActiveNode();
    this.diameterProperties =
      (currentNode && currentNode.diameterProperties) || defaultDiameterProperties;
    this.updateDiameter();
  };

  hideDiameter = () => {
    if (this.diameter) {
      this.rootGroup.remove(this.diameter);
      this.diameter = null;
      window.needsRerender = true;
    }
  };

  setDiameterVisibility = visible => {
    if (visible && !this.diameter) {
      this.showDiameter();
    } else if (!visible && this.diameter) {
      this.hideDiameter();
    }
  };

  changeXRadiusOfDiameterBy = (value: number) => {
    if (!Store.getState().userConfiguration.showDiameter) {
      return;
    }
    this.diameterProperties = {
      ...this.diameterProperties,
      xRadius: this.diameterProperties.xRadius + value,
    };
    this.updateDiameter();
  };

  changeYRadiusOfDiameterBy = (value: number) => {
    if (!Store.getState().userConfiguration.showDiameter) {
      return;
    }
    this.diameterProperties = {
      ...this.diameterProperties,
      yRadius: this.diameterProperties.yRadius + value,
    };
    this.updateDiameter();
  };

  changeRotationAngleOfDiameterBy = (value: number) => {
    this.diameterProperties = {
      ...this.diameterProperties,
      rotationAngle: this.diameterProperties.rotationAngle + value,
    };
    this.updateDiameter();
  };

  updateDiameterToCameraMatrix = (cameraMatrix: Matrix4x4) => {
    const { diameter } = this;
    if (!cameraMatrix || !diameter) {
      return;
    }
    const currentMatrix = diameter.matrix.elements;
    const currentPosition = new THREE.Vector3(
      currentMatrix[12],
      currentMatrix[13],
      currentMatrix[14],
    );
    diameter.matrix.set(
      cameraMatrix[0],
      cameraMatrix[4],
      cameraMatrix[8],
      cameraMatrix[12],
      cameraMatrix[1],
      cameraMatrix[5],
      cameraMatrix[9],
      cameraMatrix[13],
      cameraMatrix[2],
      cameraMatrix[6],
      cameraMatrix[10],
      cameraMatrix[14],
      cameraMatrix[3],
      cameraMatrix[7],
      cameraMatrix[11],
      cameraMatrix[15],
    );
    diameter.matrix.multiply(new THREE.Matrix4().makeRotationY(Math.PI));
    diameter.matrix.setPosition(currentPosition);
    const { position } = diameter.geometry.attributes;
    const pointWithXRadius = new THREE.Vector3();
    pointWithXRadius.fromBufferAttribute(position, 0);
    const pointWithYRadius = new THREE.Vector3();
    pointWithYRadius.fromBufferAttribute(position, Math.floor(numbOfVerticesInEllipse / 4));
    pointWithXRadius.applyMatrix4(diameter.matrix);
    pointWithYRadius.applyMatrix4(diameter.matrix);
    // Calculation
    const xExtent = new THREE.Vector3().subVectors(pointWithXRadius, currentPosition);
    const yExtent = new THREE.Vector3().subVectors(pointWithYRadius, currentPosition);
    // multiply with dataset resolution and then take the length
    const datasetScale = Store.getState().dataset.dataSource.scale;
    const scaleAsVector = new THREE.Vector3(...datasetScale);
    xExtent.multiply(scaleAsVector);
    yExtent.multiply(scaleAsVector);
    // TODO display this information somehow to the user
    this.diameterProperties = {
      ...this.diameterProperties,
      scaledXRadius: xExtent.length(),
      scaledYRadius: yExtent.length(),
    };
    Store.dispatch(setDiameterProperties(this.diameterProperties));
    // hier auch die node aktualisieren
    const { id } = this.getActiveNode();
    const treeId = this.getActiveTreeId();
    Store.dispatch(setNodeDiameterPropertiesAction(id, treeId, this.diameterProperties));
    diameter.matrixWorldNeedsUpdate = true;
  };

  updateDiameter(): void {
    const { xRadius, yRadius, rotationAngle } = this.diameterProperties;

    const activeNode = this.getActiveNode();
    if (!activeNode) {
      return;
    }

    const { position } = activeNode;
    const curve = new THREE.EllipseCurve(
      0, // posX
      0, // posY
      xRadius, // xRadius
      yRadius, // yRadius
      0, // aStartAngle
      2 * Math.PI, // aEndAngle
      false, // aClockwise
      (rotationAngle / 180) * Math.PI, // aRotation
    );
    const points = curve.getPoints(numbOfVerticesInEllipse);
    const geometrycirc = new THREE.BufferGeometry().setFromPoints(points);
    const materialcirc = new THREE.LineBasicMaterial({
      color: 0xff0000,
    });
    // to change axis -> replace the old shape with a new one
    // rotation is handled in radian (not degrees)
    // Create the final object to add to the scene
    this.hideDiameter();
    const ellipse = new THREE.Line(geometrycirc, materialcirc);
    this.diameter = ellipse;
    // const lookAt = [0, 0, 0]; // etUp(Store.getState().flycam);
    const transformationMartix = new THREE.Matrix4().makeTranslation(
      position[0],
      position[1],
      position[2],
    );
    // transform the diameter to its correct position
    ellipse.matrix.multiply(transformationMartix);

    // adjust rotation of diameter to current camera matrix
    const matrix = getZoomedMatrix(Store.getState().flycam);
    this.updateDiameterToCameraMatrix(matrix);

    // maybe remove line 1 and 3 (2 is a must have :) )
    ellipse.rotation.x = Math.PI;
    ellipse.matrixAutoUpdate = false;
    ellipse.material.side = THREE.DoubleSide;

    this.rootGroup.add(ellipse);
    window.needsRerender = true;
  }

  setDiameterForNode(nodeId: number) {
    if (nodeId == null) {
      return;
    }
    const { id, diameterProperties } = this.getActiveNode();
    if (this.isInitialSetDiameterForNodeCall) {
      /* When a tracing is loaded the following problem might occure:
       * If the "showDiameter" option is active and the there is an active cell,
       * the functions setDiameterForNode and setDiameterVisibility get called due to listening to those store properties.
       * Both functions call updateDiameter asynchronosly which might cause a creation of two diameters / ellipses causing a visual bug.
       * To avoid this, we ignore the inital call of setDiameterForNode. */
      this.isInitialSetDiameterForNodeCall = false;
      return;
    }
    if (id !== nodeId) {
      return;
    }
    this.diameterProperties = diameterProperties || defaultDiameterProperties;
    const isVisible = Store.getState().userConfiguration.showDiameter;
    if (isVisible) {
      this.updateDiameter();
    }
  }

  getIsosurfaceGeometry(cellId: number): THREE.Geometry {
    return this.isosurfacesGroupsPerSegmentationId[cellId];
  }

  addSTL(meshMetaData: MeshMetaData, geometry: THREE.Geometry): void {
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

  addIsosurfaceFromVertices(vertices, segmentationId): void {
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

  addIsosurfaceFromGeometry(geometry, segmentationId): void {
    const [hue] = convertCellIdToHSLA(segmentationId);
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

  removeIsosurfaceById(segmentationId): void {
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

      this.taskBoundingBox = new Cube({
        min: taskBoundingBox.min,
        max: taskBoundingBox.max,
        color: 0x00ff00,
        showCrossSections: true,
      });
      this.taskBoundingBox.getMeshes().forEach(mesh => this.rootNode.add(mesh));
    }
  }

  updateSceneForCam = (id: OrthoView, hidePlanes: boolean = false): void => {
    // This method is called for each of the four cams. Even
    // though they are all looking at the same scene, some
    // things have to be changed for each cam.

    this.cube.updateForCam(id);
    this.userBoundingBox.updateForCam(id);
    Utils.__guard__(this.taskBoundingBox, x => x.updateForCam(id));

    this.isosurfacesRootGroup.visible = id === OrthoViews.TDView;
    if (id !== OrthoViews.TDView) {
      let ind;
      for (const planeId of OrthoViewValuesWithoutTDView) {
        if (planeId === id) {
          this.planes[planeId].setOriginalCrosshairColor();
          this.planes[planeId].setVisible(!hidePlanes);
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
      const { tdViewDisplayPlanes } = Store.getState().userConfiguration;
      for (const planeId of OrthoViewValuesWithoutTDView) {
        const pos = getPosition(Store.getState().flycam);
        this.planes[planeId].setPosition(new THREE.Vector3(pos[0], pos[1], pos[2]));
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
    const globalPosVec = new THREE.Vector3(...globalPosition);

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
      optArbitraryPlane.setPosition(globalPosVec);
    } else {
      for (const currentPlane of _.values(this.planes)) {
        currentPlane.updateAnchorPoints(anchorPoint);
        currentPlane.setPosition(globalPosVec);
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

  setSegmentationVisibility(isVisible: boolean): void {
    for (const plane of _.values(this.planes)) {
      plane.setSegmentationVisibility(isVisible);
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
    if (this.isosurfacesRootGroup != null) {
      this.isosurfacesRootGroup.visible = false;
    }
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
      storeState => storeState.userConfiguration.showDiameter,
      showDiameter => this.setDiameterVisibility(showDiameter),
    );

    listenToStoreProperty(
      storeState => storeState.userConfiguration.displayCrosshair,
      displayCrosshair => this.setDisplayCrosshair(displayCrosshair),
    );

    listenToStoreProperty(
      storeState => storeState.datasetConfiguration.segmentationOpacity,
      segmentationOpacity => this.setSegmentationAlpha(segmentationOpacity),
    );

    listenToStoreProperty(
      storeState => storeState.datasetConfiguration.isSegmentationDisabled,
      isSegmentationDisabled => this.setSegmentationVisibility(!isSegmentationDisabled),
    );

    listenToStoreProperty(
      storeState => storeState.datasetConfiguration.interpolation,
      interpolation => this.setInterpolation(interpolation),
    );

    listenToStoreProperty(
      storeState => getSomeTracing(storeState.tracing).userBoundingBox,
      bb => this.setUserBoundingBox(bb),
    );

    listenToStoreProperty(
      storeState => getSomeTracing(storeState.tracing).boundingBox,
      bb => this.buildTaskingBoundingBox(bb),
    );

    listenToStoreProperty(
      storeState => storeState.temporaryConfiguration.activeMapping.isMappingEnabled,
      isMappingEnabled => this.setIsMappingEnabled(isMappingEnabled),
    );

    listenToStoreProperty(
      storeState => enforceSkeletonTracing(storeState.tracing).activeNodeId,
      activeNodeId => this.setDiameterForNode(activeNodeId),
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
