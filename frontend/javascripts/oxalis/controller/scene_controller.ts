import * as THREE from "three";
import app from "app";
import Maybe from "data.maybe";
import { V3 } from "libs/mjs";
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
import { getRenderer } from "oxalis/controller/renderer";
import { setSceneController } from "oxalis/controller/scene_controller_provider";
import ArbitraryPlane from "oxalis/geometries/arbitrary_plane";
import Cube from "oxalis/geometries/cube";
import {
  ContourGeometry,
  LineMeasurementGeometry,
  QuickSelectGeometry,
} from "oxalis/geometries/helper_geometries";
import Plane from "oxalis/geometries/plane";
import Skeleton from "oxalis/geometries/skeleton";
import {
  getDataLayers,
  getDatasetBoundingBox,
  getLayerBoundingBox,
  getLayerNameToIsDisabled,
  getTransformsForLayerOrNull,
} from "oxalis/model/accessors/dataset_accessor";
import { getActiveMagIndicesForLayers, getPosition } from "oxalis/model/accessors/flycam_accessor";
import { getSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getSomeTracing } from "oxalis/model/accessors/tracing_accessor";
import { getPlaneScalingFactor } from "oxalis/model/accessors/view_mode_accessor";
import { sceneControllerReadyAction } from "oxalis/model/actions/actions";
import Dimensions from "oxalis/model/dimensions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { getVoxelPerNM } from "oxalis/model/scaleinfo";
import { Model } from "oxalis/singletons";
import type { OxalisState, SkeletonTracing, UserBoundingBox } from "oxalis/store";
import Store from "oxalis/store";
import SegmentMeshController from "./segment_mesh_controller";

const CUBE_COLOR = 0x999999;
const LAYER_CUBE_COLOR = 0xffff99;

class SceneController {
  skeletons: Record<number, Skeleton> = {};
  current: number;
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
  rootNode!: THREE.Object3D;
  renderer!: THREE.WebGLRenderer;
  scene!: THREE.Scene;
  rootGroup!: THREE.Object3D;
  // Group for all meshes including a light.
  meshesRootGroup!: THREE.Object3D;
  segmentMeshController: SegmentMeshController;

  // This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
  // element depending on the provided flycam.
  constructor() {
    this.current = 0;
    this.isPlaneVisible = {
      [OrthoViews.PLANE_XY]: true,
      [OrthoViews.PLANE_YZ]: true,
      [OrthoViews.PLANE_XZ]: true,
      [OrthoViews.TDView]: true,
    };
    this.planeShift = [0, 0, 0];
    this.segmentMeshController = new SegmentMeshController();
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

    this.meshesRootGroup = new THREE.Group();
    this.highlightedBBoxId = null;
    // The dimension(s) with the highest resolution will not be distorted
    this.rootGroup.scale.copy(new THREE.Vector3(...Store.getState().dataset.dataSource.scale));
    // Add scene to the group, all Geometries are then added to group
    this.scene.add(this.rootGroup);
    this.scene.add(this.segmentMeshController.meshesLODRootGroup);
    this.scene.add(this.meshesRootGroup);
    this.rootGroup.add(new THREE.DirectionalLight());
    this.setupDebuggingMethods();
  }

  setupDebuggingMethods() {
    // These methods are attached to window, since we would run into circular import errors
    // otherwise.
    // @ts-ignore
    window.addBucketMesh = (
      position: Vector3,
      zoomStep: number,
      resolution: Vector3,
      optColor?: string,
    ) => {
      const bucketSize = [
        constants.BUCKET_WIDTH * resolution[0],
        constants.BUCKET_WIDTH * resolution[1],
        constants.BUCKET_WIDTH * resolution[2],
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
    this.rootNode = new THREE.Object3D();
    this.userBoundingBoxGroup = new THREE.Group();
    this.layerBoundingBoxGroup = new THREE.Group();
    this.rootNode.add(this.userBoundingBoxGroup);
    this.rootNode.add(this.layerBoundingBoxGroup);
    this.annotationToolsGeometryGroup = new THREE.Group();
    this.rootNode.add(this.annotationToolsGeometryGroup);
    this.userBoundingBoxes = [];
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
    this.datasetBoundingBox.getMeshes().forEach((mesh) => this.rootNode.add(mesh));
    const taskBoundingBox = getSomeTracing(state.tracing).boundingBox;
    this.buildTaskingBoundingBox(taskBoundingBox);

    this.contour = new ContourGeometry();
    this.contour.getMeshes().forEach((mesh) => this.annotationToolsGeometryGroup.add(mesh));

    this.quickSelectGeometry = new QuickSelectGeometry();
    this.annotationToolsGeometryGroup.add(this.quickSelectGeometry.getMeshGroup());

    this.lineMeasurementGeometry = new LineMeasurementGeometry();
    this.lineMeasurementGeometry
      .getMeshes()
      .forEach((mesh) => this.annotationToolsGeometryGroup.add(mesh));
    this.areaMeasurementGeometry = new ContourGeometry(true);
    this.areaMeasurementGeometry
      .getMeshes()
      .forEach((mesh) => this.annotationToolsGeometryGroup.add(mesh));

    if (state.tracing.skeleton != null) {
      this.addSkeleton((_state) => getSkeletonTracing(_state.tracing), true);
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
      plane.getMeshes().forEach((mesh: THREE.Object3D) => this.rootNode.add(mesh));
    }

    // Hide all objects at first, they will be made visible later if needed
    this.stopPlaneMode();
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

    this.segmentMeshController.meshesLODRootGroup.visible = id === OrthoViews.TDView;
    this.annotationToolsGeometryGroup.visible = id !== OrthoViews.TDView;
    this.lineMeasurementGeometry.updateForCam(id);

    const originalPosition = getPosition(Store.getState().flycam);
    if (id !== OrthoViews.TDView) {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        if (planeId === id) {
          this.planes[planeId].setOriginalCrosshairColor();
          this.planes[planeId].setVisible(!hidePlanes);

          const pos = _.clone(originalPosition);

          const ind = Dimensions.getIndices(planeId);
          // Offset the plane so the user can see the skeletonTracing behind the plane
          pos[ind[2]] +=
            planeId === OrthoViews.PLANE_XY ? this.planeShift[ind[2]] : -this.planeShift[ind[2]];
          this.planes[planeId].setPosition(pos, originalPosition);

          this.quickSelectGeometry.adaptVisibilityForRendering(originalPosition, ind[2]);
        } else {
          this.planes[planeId].setVisible(false);
        }
        this.planes[planeId].materialFactory.uniforms.is3DViewBeingRendered.value = false;
      }
    } else {
      for (const planeId of OrthoViewValuesWithoutTDView) {
        this.planes[planeId].setPosition(originalPosition);
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
    const voxelPerNMVector = getVoxelPerNM(Store.getState().dataset.dataSource.scale);
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

    if (this.segmentMeshController.meshesLODRootGroup != null) {
      this.segmentMeshController.meshesLODRootGroup.visible = false;
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

  bindToEvents(): void {
    listenToStoreProperty(
      (storeState) => storeState.userConfiguration.clippingDistance,
      (clippingDistance) => this.setClippingDistance(clippingDistance),
    );
    listenToStoreProperty(
      (storeState) => storeState.userConfiguration.displayCrosshair,
      (displayCrosshair) => this.setDisplayCrosshair(displayCrosshair),
    );
    listenToStoreProperty(
      (storeState) => storeState.datasetConfiguration.interpolation,
      (interpolation) => this.setInterpolation(interpolation),
    );
    listenToStoreProperty(
      (storeState) => getSomeTracing(storeState.tracing).userBoundingBoxes,
      (bboxes) => this.setUserBoundingBoxes(bboxes),
    );
    listenToStoreProperty(
      (storeState) => getDataLayers(storeState.dataset),
      () => this.updateLayerBoundingBoxes(),
    );
    listenToStoreProperty(
      (storeState) => storeState.datasetConfiguration.nativelyRenderedLayerName,
      () => this.updateLayerBoundingBoxes(),
    );
    listenToStoreProperty(
      (storeState) => getSomeTracing(storeState.tracing).boundingBox,
      (bb) => this.buildTaskingBoundingBox(bb),
    );
    listenToStoreProperty(
      (storeState) =>
        storeState.tracing.skeleton ? storeState.tracing.skeleton.showSkeletons : false,
      (showSkeletons) => this.setSkeletonGroupVisibility(showSkeletons),
      true,
    );
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
