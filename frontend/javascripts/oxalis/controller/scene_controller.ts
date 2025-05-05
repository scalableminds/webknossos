import app from "app";
import type Maybe from "data.maybe";
import { V3 } from "libs/mjs";
import Toast from "libs/toast";
import * as Utils from "libs/utils";
import window from "libs/window";
import _ from "lodash";

import type {
  BoundingBoxType,
  OrthoView,
  OrthoViewMap,
  OrthoViewWithoutTDMap,
  Vector3,
} from "oxalis/constants";
import constants, {
  OrthoViews,
  OrthoViewValuesWithoutTDView,
  TDViewDisplayModeEnum,
} from "oxalis/constants";
import { destroyRenderer, getRenderer } from "oxalis/controller/renderer";
import { setSceneController } from "oxalis/controller/scene_controller_provider";
import type ArbitraryPlane from "oxalis/geometries/arbitrary_plane";
import computeSplitBoundaryMeshWithSplines from "oxalis/geometries/compute_split_boundary_mesh_with_splines";
import Cube from "oxalis/geometries/cube";
import {
  ContourGeometry,
  LineMeasurementGeometry,
  QuickSelectGeometry,
} from "oxalis/geometries/helper_geometries";
import Plane from "oxalis/geometries/plane";
import Skeleton from "oxalis/geometries/skeleton";
import { reuseInstanceOnEquality } from "oxalis/model/accessors/accessor_helpers";
import {
  getDataLayers,
  getDatasetBoundingBox,
  getLayerBoundingBox,
  getLayerByName,
  getLayerNameToIsDisabled,
  getSegmentationLayers,
  getVisibleSegmentationLayers,
} from "oxalis/model/accessors/dataset_accessor";
import {
  getTransformsForLayer,
  getTransformsForLayerOrNull,
  getTransformsForSkeletonLayer,
} from "oxalis/model/accessors/dataset_layer_transformation_accessor";
import { getActiveMagIndicesForLayers, getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { getPlaneScalingFactor } from "oxalis/model/accessors/view_mode_accessor";
import { sceneControllerReadyAction } from "oxalis/model/actions/actions";
import Dimensions from "oxalis/model/dimensions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import type { Transform } from "oxalis/model/helpers/transformation_helpers";
import { getVoxelPerUnit } from "oxalis/model/scaleinfo";
import { Model } from "oxalis/singletons";
import type { OxalisState, SkeletonTracing, UserBoundingBox } from "oxalis/store";
import Store from "oxalis/store";
import * as THREE from "three";
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree } from "three-mesh-bvh";
import type CustomLOD from "./custom_lod";
import SegmentMeshController from "./segment_mesh_controller";

// Add the extension functions
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

const CUBE_COLOR = 0x999999;
const LAYER_CUBE_COLOR = 0xffff99;

export const OrthoBaseRotations = {
  [OrthoViews.PLANE_XY]: new THREE.Euler(Math.PI, 0, 0),
  [OrthoViews.PLANE_YZ]: new THREE.Euler(Math.PI, (1 / 2) * Math.PI, 0),
  [OrthoViews.PLANE_XZ]: new THREE.Euler((-1 / 2) * Math.PI, 0, 0),
  [OrthoViews.TDView]: new THREE.Euler(Math.PI / 4, Math.PI / 4, Math.PI / 4),
};

const getVisibleSegmentationLayerNames = reuseInstanceOnEquality((storeState: OxalisState) =>
  getVisibleSegmentationLayers(storeState).map((l) => l.name),
);

class SceneController {
  skeletons: Record<number, Skeleton> = {};
  isPlaneVisible: OrthoViewMap<boolean>;
  planeShift: Vector3;
  datasetBoundingBox!: Cube;
  userBoundingBoxGroup!: THREE.Group;
  layerBoundingBoxGroup!: THREE.Group;
  userBoundingBoxes!: Array<Cube>;
  layerBoundingBoxes!: { [layerName: string]: Cube };
  annotationToolsGeometryGroup!: THREE.Group;
  highlightedBBoxId: number | null | undefined;
  taskBoundingBox: Cube | null | undefined;
  contour!: ContourGeometry;
  quickSelectGeometry!: QuickSelectGeometry;
  lineMeasurementGeometry!: LineMeasurementGeometry;
  areaMeasurementGeometry!: ContourGeometry;
  planes!: OrthoViewWithoutTDMap<Plane>;
  rootNode!: THREE.Group;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  rootGroup!: THREE.Group;
  segmentMeshController: SegmentMeshController;
  storePropertyUnsubscribers: Array<() => void>;
  splitBoundaryMesh: THREE.Mesh | null = null;

  // This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
  // element depending on the provided flycam.
  constructor() {
    this.isPlaneVisible = {
      [OrthoViews.PLANE_XY]: true,
      [OrthoViews.PLANE_YZ]: true,
      [OrthoViews.PLANE_XZ]: true,
      [OrthoViews.TDView]: true,
    };
    this.planeShift = [0, 0, 0];
    this.segmentMeshController = new SegmentMeshController();
    this.storePropertyUnsubscribers = [];
  }

  initialize() {
    this.renderer = getRenderer();
    this.createMeshes();
    this.bindToEvents();
    this.scene = new THREE.Scene();
    this.highlightedBBoxId = null;
    this.rootGroup = new THREE.Group();
    this.scene.add(
      this.rootGroup.add(
        this.rootNode,
        this.segmentMeshController.meshesLayerLODRootGroup,
        this.segmentMeshController.lightsGroup,
      ),
    );
    // Because the voxel coordinates do not have a cube shape but are distorted,
    // we need to distort the entire scene to provide an illustration that is
    // proportional to the actual size in nm.
    // For some reason, all objects have to be put into a group object. Changing
    // scene.scale does not have an effect.
    // The dimension(s) with the highest mag will not be distorted.
    this.rootGroup.scale.copy(
      new THREE.Vector3(...Store.getState().dataset.dataSource.scale.factor),
    );
    this.setupDebuggingMethods();
  }

  setupDebuggingMethods() {
    // These methods are attached to window, since we would run into circular import errors
    // otherwise.
    // @ts-ignore
    window.addBucketMesh = (
      position: Vector3,
      zoomStep: number,
      mag: Vector3,
      optColor?: string,
    ) => {
      const bucketSize = [
        constants.BUCKET_WIDTH * mag[0],
        constants.BUCKET_WIDTH * mag[1],
        constants.BUCKET_WIDTH * mag[2],
      ];
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

    // @ts-ignore
    window.addVoxelMesh = (position: Vector3, _cubeLength: Vector3, optColor?: string) => {
      // Shrink voxels a bit so that it's easier to identify individual voxels.
      const cubeLength = _cubeLength.map((el) => el * 0.9);

      const boxGeometry = new THREE.BoxGeometry(...cubeLength);
      const material = new THREE.MeshBasicMaterial({
        color: optColor || 0xff00ff,
        opacity: 0.5,
      });
      const cube = new THREE.Mesh(boxGeometry, material);
      cube.position.x = position[0] + cubeLength[0] / 2;
      cube.position.y = position[1] + cubeLength[1] / 2;
      cube.position.z = position[2] + cubeLength[2] / 2;
      this.rootNode.add(cube);
      return cube;
    };

    let renderedLines: THREE.Line[] = [];

    // Utility function for visual debugging
    // @ts-ignore
    window.addLine = (a: Vector3, b: Vector3) => {
      const material = new THREE.LineBasicMaterial({
        color: 0x0000ff,
      });
      const points = [];
      points.push(new THREE.Vector3(...a));
      points.push(new THREE.Vector3(...b));
      const geometry = new THREE.BufferGeometry().setFromPoints(points);
      const line = new THREE.Line(geometry, material);
      this.rootNode.add(line);
      renderedLines.push(line);
    };

    // Utility function for visual debugging
    // @ts-ignore
    window.removeLines = () => {
      for (const line of renderedLines) {
        this.rootNode.remove(line);
      }

      renderedLines = [];
    };

    // @ts-ignore
    window.removeBucketMesh = (mesh: THREE.LineSegments) => this.rootNode.remove(mesh);
  }

  createMeshes(): void {
    this.userBoundingBoxes = [];
    this.userBoundingBoxGroup = new THREE.Group();
    this.layerBoundingBoxGroup = new THREE.Group();
    this.annotationToolsGeometryGroup = new THREE.Group();
    const state = Store.getState();
    // Cubes
    const { min, max } = getDatasetBoundingBox(state.dataset);
    this.datasetBoundingBox = new Cube({
      min,
      max,
      color: CUBE_COLOR,
      showCrossSections: true,
      isHighlighted: false,
    });

    this.contour = new ContourGeometry();
    this.quickSelectGeometry = new QuickSelectGeometry();
    this.lineMeasurementGeometry = new LineMeasurementGeometry();
    this.areaMeasurementGeometry = new ContourGeometry(true);

    this.planes = {
      [OrthoViews.PLANE_XY]: new Plane(OrthoViews.PLANE_XY),
      [OrthoViews.PLANE_YZ]: new Plane(OrthoViews.PLANE_YZ),
      [OrthoViews.PLANE_XZ]: new Plane(OrthoViews.PLANE_XZ),
    };
    this.planes[OrthoViews.PLANE_XY].setBaseRotation(OrthoBaseRotations[OrthoViews.PLANE_XY]);
    this.planes[OrthoViews.PLANE_YZ].setBaseRotation(OrthoBaseRotations[OrthoViews.PLANE_YZ]);
    this.planes[OrthoViews.PLANE_XZ].setBaseRotation(OrthoBaseRotations[OrthoViews.PLANE_XZ]);

    const planeMeshes = _.values(this.planes).flatMap((plane) => plane.getMeshes());
    this.rootNode = new THREE.Group().add(
      this.userBoundingBoxGroup,
      this.layerBoundingBoxGroup,
      this.annotationToolsGeometryGroup.add(
        ...this.contour.getMeshes(),
        this.quickSelectGeometry.getMeshGroup(),
        ...this.lineMeasurementGeometry.getMeshes(),
        ...this.areaMeasurementGeometry.getMeshes(),
      ),
      ...this.datasetBoundingBox.getMeshes(),
      ...planeMeshes,
    );

    const taskBoundingBox = getSomeTracing(state.annotation).boundingBox;
    this.buildTaskingBoundingBox(taskBoundingBox);
    if (state.annotation.skeleton != null) {
      this.addSkeleton((_state) => getSkeletonTracing(_state.annotation), true);
    }
    // Hide all objects at first, they will be made visible later if needed
    this.stopPlaneMode();
  }

  addSplitBoundaryMesh(points: Vector3[]) {
    if (points.length === 0) {
      return () => {};
    }

    let splitBoundaryMesh: THREE.Mesh | null = null;
    let splines: THREE.Object3D[] = [];
    try {
      const objects = computeSplitBoundaryMeshWithSplines(points);
      splitBoundaryMesh = objects.splitBoundaryMesh;
      splines = objects.splines;
    } catch (exc) {
      console.error(exc);
      Toast.error("Could not compute surface");
      return () => {};
    }

    const surfaceGroup = new THREE.Group();
    if (splitBoundaryMesh != null) {
      surfaceGroup.add(splitBoundaryMesh);
    }
    for (const spline of splines) {
      surfaceGroup.add(spline);
    }

    this.rootGroup.add(surfaceGroup);
    this.splitBoundaryMesh = splitBoundaryMesh;

    return () => {
      this.rootGroup.remove(surfaceGroup);
      this.splitBoundaryMesh = null;
    };
  }

  getSplitBoundaryMesh() {
    return this.splitBoundaryMesh;
  }

  addSkeleton(
    skeletonTracingSelector: (arg0: OxalisState) => Maybe<SkeletonTracing>,
    supportsPicking: boolean,
  ): number {
    const skeleton = new Skeleton(skeletonTracingSelector, supportsPicking);
    const skeletonGroup = skeleton.getRootGroup();
    this.skeletons[skeletonGroup.id] = skeleton;
    this.rootNode.add(skeletonGroup);
    return skeletonGroup.id;
  }

  removeSkeleton(skeletonId: number) {
    const skeleton = this.skeletons[skeletonId];
    const skeletonGroup = skeleton.getRootGroup();
    skeleton.destroy();
    delete this.skeletons[skeletonId];
    this.rootNode.remove(skeletonGroup);
  }

  buildTaskingBoundingBox(taskBoundingBox: BoundingBoxType | null | undefined): void {
    if (taskBoundingBox != null) {
      if (this.taskBoundingBox != null) {
        this.taskBoundingBox.getMeshes().forEach((mesh) => this.rootNode.remove(mesh));
      }

      const { viewMode } = Store.getState().temporaryConfiguration;
      this.taskBoundingBox = new Cube({
        min: taskBoundingBox.min,
        max: taskBoundingBox.max,
        color: 0x00ff00,
        showCrossSections: true,
        isHighlighted: false,
      });
      this.taskBoundingBox.getMeshes().forEach((mesh) => this.rootNode.add(mesh));

      if (constants.MODES_ARBITRARY.includes(viewMode)) {
        this.taskBoundingBox?.setVisibility(false);
      }
    }
  }

  updateSceneForCam = (id: OrthoView, hidePlanes: boolean = false): void => {
    // This method is called for each of the four cams. Even
    // though they are all looking at the same scene, some
    // things have to be changed for each cam.
    const { tdViewDisplayPlanes, tdViewDisplayDatasetBorders, tdViewDisplayLayerBorders } =
      Store.getState().userConfiguration;
    // Only set the visibility of the dataset bounding box for the TDView.
    // This has to happen before updateForCam is called as otherwise cross section visibility
    // might be changed unintentionally.
    this.datasetBoundingBox.setVisibility(id !== OrthoViews.TDView || tdViewDisplayDatasetBorders);
    this.datasetBoundingBox.updateForCam(id);
    this.userBoundingBoxes.forEach((bbCube) => bbCube.updateForCam(id));
    const layerNameToIsDisabled = getLayerNameToIsDisabled(Store.getState().datasetConfiguration);
    Object.keys(this.layerBoundingBoxes).forEach((layerName) => {
      const bbCube = this.layerBoundingBoxes[layerName];
      const visible =
        id === OrthoViews.TDView && tdViewDisplayLayerBorders && !layerNameToIsDisabled[layerName];
      bbCube.setVisibility(visible);
      bbCube.updateForCam(id);
    });

    this.taskBoundingBox?.updateForCam(id);

    this.segmentMeshController.meshesLayerLODRootGroup.visible = id === OrthoViews.TDView;
    if (this.splitBoundaryMesh != null) {
      this.splitBoundaryMesh.visible = id === OrthoViews.TDView;
    }
    this.annotationToolsGeometryGroup.visible = id !== OrthoViews.TDView;
    this.lineMeasurementGeometry.updateForCam(id);

    const originalPosition = getPosition(Store.getState().flycam);
    if (id !== OrthoViews.TDView) {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        if (planeId === id) {
          this.planes[planeId].setOriginalCrosshairColor();
          this.planes[planeId].setVisible(!hidePlanes);

          const pos = _.clone(originalPosition);
          //TODOM: adjust rotation of the plane

          const ind = Dimensions.getIndices(planeId);
          // Offset the plane so the user can see the skeletonTracing behind the plane
          // TODO: Fix z positioning!!!
          pos[ind[2]] +=
            planeId === OrthoViews.PLANE_XY ? this.planeShift[ind[2]] : -this.planeShift[ind[2]];
          // this.planes[planeId].setPosition(pos, originalPosition);

          this.quickSelectGeometry.adaptVisibilityForRendering(originalPosition, ind[2]);
        } else {
          this.planes[planeId].setVisible(false);
        }
        this.planes[planeId].materialFactory.uniforms.is3DViewBeingRendered.value = false;
      }
    } else {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        // this.planes[planeId].setPosition(originalPosition);
        this.planes[planeId].setGrayCrosshairColor();
        this.planes[planeId].setVisible(
          tdViewDisplayPlanes !== TDViewDisplayModeEnum.NONE,
          this.isPlaneVisible[planeId] && tdViewDisplayPlanes === TDViewDisplayModeEnum.DATA,
        );
        this.planes[planeId].materialFactory.uniforms.is3DViewBeingRendered.value = true;
      }
    }
  };

  update(optArbitraryPlane?: ArbitraryPlane): void {
    const state = Store.getState();
    const { flycam } = state;
    const globalPosition = getPosition(flycam);

    const magIndices = getActiveMagIndicesForLayers(Store.getState());
    for (const dataLayer of Model.getAllLayers()) {
      dataLayer.layerRenderingManager.updateDataTextures(
        globalPosition,
        magIndices[dataLayer.name],
      );
    }

    // TODO: maybe this needs to be removed!!!
    if (!optArbitraryPlane) {
      for (const currentPlane of _.values<Plane>(this.planes)) {
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

    app.vent.emit("rerender");
  }

  setClippingDistance(value: number): void {
    // convert nm to voxel
    const voxelPerNMVector = getVoxelPerUnit(Store.getState().dataset.dataSource.scale);
    V3.scale(voxelPerNMVector, value, this.planeShift);
    app.vent.emit("rerender");
  }

  setInterpolation(value: boolean): void {
    for (const plane of _.values(this.planes)) {
      plane.setLinearInterpolationEnabled(value);
    }

    app.vent.emit("rerender");
  }

  getRootNode(): THREE.Object3D {
    return this.rootNode;
  }

  setUserBoundingBoxes(bboxes: Array<UserBoundingBox>): void {
    const newUserBoundingBoxGroup = new THREE.Group();
    this.userBoundingBoxes = bboxes.map(({ boundingBox, isVisible, color, id }) => {
      const { min, max } = boundingBox;
      const bbColor: Vector3 = [color[0] * 255, color[1] * 255, color[2] * 255];
      const bbCube = new Cube({
        min,
        max,
        color: Utils.rgbToInt(bbColor),
        showCrossSections: true,
        id,
        isHighlighted: this.highlightedBBoxId === id,
      });
      bbCube.setVisibility(isVisible);
      bbCube.getMeshes().forEach((mesh) => newUserBoundingBoxGroup.add(mesh));
      return bbCube;
    });
    this.rootNode.remove(this.userBoundingBoxGroup);
    this.userBoundingBoxGroup = newUserBoundingBoxGroup;
    this.rootNode.add(this.userBoundingBoxGroup);
  }

  private applyTransformToGroup(transform: Transform, group: THREE.Group | CustomLOD) {
    if (transform.affineMatrix) {
      const matrix = new THREE.Matrix4();
      // @ts-ignore
      matrix.set(...transform.affineMatrix);
      // We need to disable matrixAutoUpdate as otherwise the update to the matrix will be lost.
      group.matrixAutoUpdate = false;
      group.matrix = matrix;
    }
  }

  updateUserBoundingBoxesAndMeshesAccordingToTransforms(): void {
    const state = Store.getState();
    const tracingStoringUserBBoxes = getSomeTracing(state.annotation);
    const transformForBBoxes =
      tracingStoringUserBBoxes.type === "volume"
        ? getTransformsForLayer(
            state.dataset,
            getLayerByName(state.dataset, tracingStoringUserBBoxes.tracingId),
            state.datasetConfiguration.nativelyRenderedLayerName,
          )
        : getTransformsForSkeletonLayer(
            state.dataset,
            state.datasetConfiguration.nativelyRenderedLayerName,
          );
    this.applyTransformToGroup(transformForBBoxes, this.userBoundingBoxGroup);
    const visibleSegmentationLayers = getVisibleSegmentationLayers(state);
    if (visibleSegmentationLayers.length === 0) {
      return;
    }
    // Use transforms of active segmentation layer to transform the meshes.
    // All meshes not belonging to this layer should be hidden via updateMeshesAccordingToLayerVisibility anyway.
    const transformForMeshes = getTransformsForLayer(
      state.dataset,
      visibleSegmentationLayers[0],
      state.datasetConfiguration.nativelyRenderedLayerName,
    );
    this.applyTransformToGroup(
      transformForMeshes,
      this.segmentMeshController.meshesLayerLODRootGroup,
    );
  }

  updateMeshesAccordingToLayerVisibility(): void {
    const state = Store.getState();
    const visibleSegmentationLayers = getVisibleSegmentationLayers(state);
    const allSegmentationLayers = getSegmentationLayers(state.dataset);
    allSegmentationLayers.forEach((layer) => {
      const layerName = layer.name;
      const isLayerVisible =
        visibleSegmentationLayers.find((layer) => layer.name === layerName) !== undefined;
      this.segmentMeshController.setVisibilityOfMeshesOfLayer(layerName, isLayerVisible);
    });
  }

  updateLayerBoundingBoxes(): void {
    const state = Store.getState();
    const dataset = state.dataset;
    const layers = getDataLayers(dataset);

    const newLayerBoundingBoxGroup = new THREE.Group();
    this.layerBoundingBoxes = Object.fromEntries(
      layers.map((layer) => {
        const boundingBox = getLayerBoundingBox(dataset, layer.name);
        const { min, max } = boundingBox;
        const bbCube = new Cube({
          min,
          max,
          color: LAYER_CUBE_COLOR,
          showCrossSections: false,
          isHighlighted: false,
        });
        bbCube.getMeshes().forEach((mesh) => {
          const transformMatrix = getTransformsForLayerOrNull(
            dataset,
            layer,
            state.datasetConfiguration.nativelyRenderedLayerName,
          )?.affineMatrix;
          if (transformMatrix) {
            const matrix = new THREE.Matrix4();
            // @ts-ignore
            matrix.set(...transformMatrix);
            mesh.applyMatrix4(matrix);
          }
          newLayerBoundingBoxGroup.add(mesh);
        });
        return [layer.name, bbCube];
      }),
    );
    this.rootNode.remove(this.layerBoundingBoxGroup);
    this.layerBoundingBoxGroup = newLayerBoundingBoxGroup;
    this.rootNode.add(this.layerBoundingBoxGroup);
  }

  highlightUserBoundingBox(bboxId: number | null | undefined): void {
    if (this.highlightedBBoxId === bboxId) {
      return;
    }

    const setIsHighlighted = (id: number, isHighlighted: boolean) => {
      const bboxToChangeHighlighting = this.userBoundingBoxes.find((bbCube) => bbCube.id === id);

      if (bboxToChangeHighlighting != null) {
        bboxToChangeHighlighting.setIsHighlighted(isHighlighted);
      }
    };

    if (this.highlightedBBoxId != null) {
      setIsHighlighted(this.highlightedBBoxId, false);
    }

    if (bboxId != null) {
      setIsHighlighted(bboxId, true);
    }

    this.highlightedBBoxId = bboxId;
  }

  setSkeletonGroupVisibility(isVisible: boolean) {
    Object.values(this.skeletons).forEach((skeleton: Skeleton) => {
      skeleton.getRootGroup().visible = isVisible;
    });
  }

  stopPlaneMode(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(false);
    }

    this.datasetBoundingBox.setVisibility(false);
    this.userBoundingBoxGroup.visible = false;

    this.taskBoundingBox?.setVisibility(false);

    if (this.segmentMeshController.meshesLayerLODRootGroup != null) {
      this.segmentMeshController.meshesLayerLODRootGroup.visible = false;
    }
  }

  startPlaneMode(): void {
    for (const plane of _.values(this.planes)) {
      plane.setVisible(true);
    }

    this.datasetBoundingBox.setVisibility(true);
    this.userBoundingBoxGroup.visible = true;

    this.taskBoundingBox?.setVisibility(true);
  }

  destroy() {
    // @ts-ignore
    window.addBucketMesh = undefined;
    // @ts-ignore
    window.addVoxelMesh = undefined;
    // @ts-ignore
    window.addLine = undefined;
    // @ts-ignore
    window.removeLines = undefined;
    // @ts-ignore
    window.removeBucketMesh = undefined;

    for (const skeletonId of Object.keys(this.skeletons)) {
      this.removeSkeleton(Number.parseInt(skeletonId, 10));
    }

    for (const fn of this.storePropertyUnsubscribers) {
      fn();
    }
    this.storePropertyUnsubscribers = [];

    destroyRenderer();
    // @ts-ignore
    this.renderer = null;

    this.datasetBoundingBox.destroy();
    this.userBoundingBoxes.forEach((cube) => cube.destroy());
    Object.values(this.layerBoundingBoxes).forEach((cube) => cube.destroy());
    this.taskBoundingBox?.destroy();

    for (const plane of _.values(this.planes)) {
      plane.destroy();
    }

    this.rootNode = new THREE.Group();
  }

  bindToEvents(): void {
    this.storePropertyUnsubscribers = [
      listenToStoreProperty(
        (storeState) => storeState.userConfiguration.clippingDistance,
        (clippingDistance) => this.setClippingDistance(clippingDistance),
      ),
      listenToStoreProperty(
        (storeState) => storeState.userConfiguration.displayCrosshair,
        (displayCrosshair) => this.setDisplayCrosshair(displayCrosshair),
      ),
      listenToStoreProperty(
        (storeState) => storeState.datasetConfiguration.interpolation,
        (interpolation) => this.setInterpolation(interpolation),
      ),
      listenToStoreProperty(
        (storeState) => getSomeTracing(storeState.annotation).userBoundingBoxes,
        (bboxes) => this.setUserBoundingBoxes(bboxes),
      ),
      listenToStoreProperty(
        (storeState) => getDataLayers(storeState.dataset),
        () => this.updateLayerBoundingBoxes(),
      ),
      listenToStoreProperty(
        (storeState) => storeState.datasetConfiguration.nativelyRenderedLayerName,
        () => {
          this.updateLayerBoundingBoxes();
          this.updateUserBoundingBoxesAndMeshesAccordingToTransforms();
        },
      ),
      listenToStoreProperty(getVisibleSegmentationLayerNames, () =>
        this.updateMeshesAccordingToLayerVisibility(),
      ),
      listenToStoreProperty(
        (storeState) => getSomeTracing(storeState.annotation).boundingBox,
        (bb) => this.buildTaskingBoundingBox(bb),
      ),
      listenToStoreProperty(
        (storeState) =>
          storeState.annotation.skeleton ? storeState.annotation.skeleton.showSkeletons : false,
        (showSkeletons) => this.setSkeletonGroupVisibility(showSkeletons),
        true,
      ),
    ];
  }
}

export type SceneControllerType = SceneController;
export function initializeSceneController() {
  const controller = new SceneController();
  setSceneController(controller);
  controller.initialize();
  Store.dispatch(sceneControllerReadyAction());
}

// Please use scene_controller_provider to get a reference to SceneController. This avoids
// problems with circular dependencies.
export default {};
