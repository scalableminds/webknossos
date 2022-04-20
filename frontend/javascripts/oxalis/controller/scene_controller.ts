// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'back... Remove this comment to see the full error message
import BackboneEvents from "backbone-events-standalone";
import * as THREE from "three";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'twee... Remove this comment to see the full error message
import TWEEN from "tween.js";
import _ from "lodash";
import Maybe from "data.maybe";
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
import { getSkeletonTracing } from "oxalis/model/accessors/skeletontracing_accessor";
import { getVoxelPerNM } from "oxalis/model/scaleinfo";
import { jsConvertCellIdToHSLA } from "oxalis/shaders/segmentation.glsl";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import { sceneControllerReadyAction } from "oxalis/model/actions/actions";
import ArbitraryPlane from "oxalis/geometries/arbitrary_plane";
import ContourGeometry from "oxalis/geometries/contourgeometry";
import Cube from "oxalis/geometries/cube";
import Dimensions from "oxalis/model/dimensions";
import Model from "oxalis/model";
import Plane from "oxalis/geometries/plane";
import Skeleton from "oxalis/geometries/skeleton";
import type { UserBoundingBox, OxalisState, SkeletonTracing } from "oxalis/store";
import Store from "oxalis/store";
import * as Utils from "libs/utils";
import app from "app";
import type { BoundingBoxType, OrthoView, OrthoViewMap, Vector3 } from "oxalis/constants";
import constants, {
  OrthoViewValuesWithoutTDView,
  OrthoViews,
  TDViewDisplayModeEnum,
} from "oxalis/constants";
import window from "libs/window";
import { setSceneController } from "./scene_controller_provider";
const CUBE_COLOR = 0x999999;

class SceneController {
  skeletons: Record<number, Skeleton> = {};
  current: number;
  isPlaneVisible: OrthoViewMap<boolean>;
  planeShift: Vector3;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'datasetBoundingBox' has no initializer a... Remove this comment to see the full error message
  datasetBoundingBox: Cube;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'userBoundingBoxGroup' has no initializer... Remove this comment to see the full error message
  userBoundingBoxGroup: THREE.Group;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'userBoundingBoxes' has no initializer an... Remove this comment to see the full error message
  userBoundingBoxes: Array<Cube>;
  highlightedBBoxId: number | null | undefined;
  taskBoundingBox: Cube | null | undefined;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'contour' has no initializer and is not d... Remove this comment to see the full error message
  contour: ContourGeometry;
  // @ts-expect-error ts-migrate(2304) FIXME: Cannot find name 'OrthoViewWithoutTDMap'.
  planes: OrthoViewWithoutTDMap<Plane>;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'rootNode' has no initializer and is not ... Remove this comment to see the full error message
  rootNode: THREE.Object3D;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'renderer' has no initializer and is not ... Remove this comment to see the full error message
  renderer: THREE.WebGLRenderer;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'scene' has no initializer and is not def... Remove this comment to see the full error message
  scene: THREE.Scene;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'rootGroup' has no initializer and is not... Remove this comment to see the full error message
  rootGroup: THREE.Object3D;
  // Group for all meshes including a light.
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'meshesRootGroup' has no initializer and ... Remove this comment to see the full error message
  meshesRootGroup: THREE.Object3D;
  stlMeshes: Record<string, THREE.Mesh> = {};
  // isosurfacesRootGroup holds lights and one group per segmentation id.
  // Each group can hold multiple meshes.
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'isosurfacesRootGroup' has no initializer... Remove this comment to see the full error message
  isosurfacesRootGroup: THREE.Group;
  isosurfacesGroupsPerSegmentationId: Record<number, THREE.Group> = {};

  // This class collects all the meshes displayed in the Skeleton View and updates position and scale of each
  // element depending on the provided flycam.
  constructor() {
    _.extend(this, BackboneEvents);

    this.current = 0;
    this.isPlaneVisible = {
      [OrthoViews.PLANE_XY]: true,
      [OrthoViews.PLANE_YZ]: true,
      [OrthoViews.PLANE_XZ]: true,
      [OrthoViews.TDView]: true,
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
    this.meshesRootGroup = new THREE.Group();
    this.highlightedBBoxId = null;
    // The dimension(s) with the highest resolution will not be distorted
    this.rootGroup.scale.copy(new THREE.Vector3(...Store.getState().dataset.dataSource.scale));
    // Add scene to the group, all Geometries are then added to group
    this.scene.add(this.rootGroup);
    this.scene.add(this.isosurfacesRootGroup);
    this.scene.add(this.meshesRootGroup);
    this.rootGroup.add(new THREE.DirectionalLight());
    this.addLights();
    this.setupDebuggingMethods();
  }

  setupDebuggingMethods() {
    // These methods are attached to window, since we would run into circular import errors
    // otherwise.
    // @ts-ignore
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

  getIsosurfaceGeometry(cellId: number): THREE.Group {
    return this.isosurfacesGroupsPerSegmentationId[cellId];
  }

  constructSceneMesh(cellId: number, geometry: THREE.Geometry | THREE.BufferGeometry) {
    const [hue] = jsConvertCellIdToHSLA(cellId);
    const color = new THREE.Color().setHSL(hue, 0.75, 0.05);
    const meshMaterial = new THREE.MeshLambertMaterial({
      color,
    });
    meshMaterial.side = THREE.DoubleSide;
    meshMaterial.transparent = true;
    const mesh = new THREE.Mesh(geometry, meshMaterial);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    const tweenAnimation = new TWEEN.Tween({
      opacity: 0,
    });
    tweenAnimation
      .to(
        {
          opacity: 0.95,
        },
        500,
      )
      .onUpdate(function onUpdate() {
        // @ts-expect-error ts-migrate(2683) FIXME: 'this' implicitly has type 'any' because it does n... Remove this comment to see the full error message
        meshMaterial.opacity = this.opacity;
        app.vent.trigger("rerender");
      })
      .start();
    return mesh;
  }

  addSTL(meshMetaData: MeshMetaData, geometry: THREE.Geometry): void {
    const { id, position } = meshMetaData;

    if (this.stlMeshes[id] != null) {
      console.warn(`Mesh with id ${id} has already been added to the scene.`);
      return;
    }

    geometry.computeVertexNormals();
    geometry.computeFaceNormals();

    const meshNumber = _.size(this.stlMeshes);

    const mesh = this.constructSceneMesh(meshNumber, geometry);
    this.meshesRootGroup.add(mesh);
    this.stlMeshes[id] = mesh;
    this.updateMeshPostion(id, position);
  }

  addIsosurfaceFromVertices(vertices: Float32Array, segmentationId: number): void {
    let bufferGeometry = new THREE.BufferGeometry();
    bufferGeometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
    // convert to normal (unbuffered) geometry to merge vertices
    const geometry = new THREE.Geometry().fromBufferGeometry(bufferGeometry);

    // @ts-ignore
    if (window.__isosurfaceMergeVertices) {
      geometry.mergeVertices();
    }

    geometry.computeVertexNormals();
    geometry.computeFaceNormals();
    // and back to a BufferGeometry
    bufferGeometry = new THREE.BufferGeometry().fromGeometry(geometry);
    this.addIsosurfaceFromGeometry(bufferGeometry, segmentationId);
  }

  addIsosurfaceFromGeometry(
    geometry: THREE.Geometry | THREE.BufferGeometry,
    segmentationId: number,
  ): void {
    const mesh = this.constructSceneMesh(segmentationId, geometry);

    if (this.isosurfacesGroupsPerSegmentationId[segmentationId] == null) {
      const newGroup = new THREE.Group();
      this.isosurfacesGroupsPerSegmentationId[segmentationId] = newGroup;
      this.isosurfacesRootGroup.add(newGroup);
      // @ts-ignore
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
    // @ts-expect-error ts-migrate(2322) FIXME: Type 'null' is not assignable to type 'Group'.
    this.isosurfacesGroupsPerSegmentationId[segmentationId] = null;
  }

  addLights(): void {
    // At the moment, we only attach an AmbientLight for the isosurfaces group.
    // The PlaneView attaches a directional light directly to the TD camera,
    // so that the light moves along the cam.
    const ambientLightForIsosurfaces = new THREE.AmbientLight(0x404040, 15); // soft white light

    this.isosurfacesRootGroup.add(ambientLightForIsosurfaces);
    const ambientLightForMeshes = new THREE.AmbientLight(0x404040, 15); // soft white light

    this.meshesRootGroup.add(ambientLightForMeshes);
  }

  removeSTL(id: string): void {
    this.meshesRootGroup.remove(this.stlMeshes[id]);
  }

  setMeshVisibility(id: string, visibility: boolean): void {
    this.stlMeshes[id].visible = visibility;
  }

  setIsosurfaceVisibility(id: number, visibility: boolean): void {
    this.isosurfacesGroupsPerSegmentationId[id].visible = visibility;
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
    const state = Store.getState();
    // Cubes
    const { lowerBoundary, upperBoundary } = getBoundaries(state.dataset);
    this.datasetBoundingBox = new Cube({
      min: lowerBoundary,
      max: upperBoundary,
      color: CUBE_COLOR,
      showCrossSections: true,
      isHighlighted: false,
    });
    this.datasetBoundingBox.getMeshes().forEach((mesh) => this.rootNode.add(mesh));
    const taskBoundingBox = getSomeTracing(state.tracing).boundingBox;
    this.buildTaskingBoundingBox(taskBoundingBox);

    if (state.tracing.volumes.length > 0) {
      this.contour = new ContourGeometry();
      this.contour.getMeshes().forEach((mesh) => this.rootNode.add(mesh));
    }

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
        Utils.__guard__(this.taskBoundingBox, (bb) => bb.setVisibility(false));
      }
    }
  }

  updateSceneForCam = (id: OrthoView, hidePlanes: boolean = false): void => {
    // This method is called for each of the four cams. Even
    // though they are all looking at the same scene, some
    // things have to be changed for each cam.
    const { tdViewDisplayPlanes, tdViewDisplayDatasetBorders } = Store.getState().userConfiguration;
    // Only set the visibility of the dataset bounding box for the TDView.
    // This has to happen before updateForCam is called as otherwise cross section visibility
    // might be changed unintentionally.
    this.datasetBoundingBox.setVisibility(id !== OrthoViews.TDView || tdViewDisplayDatasetBorders);
    this.datasetBoundingBox.updateForCam(id);
    this.userBoundingBoxes.forEach((bbCube) => bbCube.updateForCam(id));

    Utils.__guard__(this.taskBoundingBox, (x) => x.updateForCam(id));

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
      for (const planeId of OrthoViewValuesWithoutTDView) {
        const pos = getPosition(Store.getState().flycam);
        this.planes[planeId].setPosition(pos);
        this.planes[planeId].setGrayCrosshairColor();
        this.planes[planeId].setVisible(
          tdViewDisplayPlanes !== TDViewDisplayModeEnum.NONE,
          this.isPlaneVisible[planeId] && tdViewDisplayPlanes === TDViewDisplayModeEnum.DATA,
        );
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
      for (const currentPlane of _.values<Plane>(this.planes)) {
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

    Utils.__guard__(this.taskBoundingBox, (x) => x.setVisibility(false));

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

    Utils.__guard__(this.taskBoundingBox, (x) => x.setVisibility(true));
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
} // Please use scene_controller_provider to get a reference to SceneController. This avoids
// problems with circular dependencies.

export default {};
