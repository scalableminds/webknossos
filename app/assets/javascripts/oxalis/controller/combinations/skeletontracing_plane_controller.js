/**
 * skeletontracing_plane_controller.js
 * @flow weak
 */

import $ from "jquery";
import * as THREE from "three";
import TWEEN from "tween.js";
import _ from "lodash";
import Store from "oxalis/store";
import SkeletonTracingController from "oxalis/controller/annotations/skeletontracing_controller";
import PlaneController from "../viewmodes/plane_controller";
import constants from "../../constants";
import dimensions from "../../model/dimensions";

class SkeletonTracingPlaneController extends PlaneController {

  // See comment in Controller class on general controller architecture.
  //
  // Skeleton Tracing Plane Controller:
  // Extends Plane controller to add controls that are specific to Skeleton
  // Tracing.

  skeletonTracingController: SkeletonTracingController;

  constructor(model, view, sceneController, skeletonTracingController) {
    super(model, view, sceneController);
    this.skeletonTracingController = skeletonTracingController;
  }


  simulateTracing(nodesPerTree = -1, nodesAlreadySet = 0) {
    // For debugging purposes.
    if (nodesPerTree === nodesAlreadySet) {
      this.model.skeletonTracing.createNewTree();
      nodesAlreadySet = 0;
    }

    const [x, y, z] = this.flycam.getPosition();
    this.setWaypoint([x + 1, y + 1, z], false);
    _.defer(() => this.simulateTracing(nodesPerTree, nodesAlreadySet + 1));
  }


  start() {
    super.start();
    return $(".skeleton-plane-controls").show();
  }


  stop() {
    super.stop();
    return $(".skeleton-plane-controls").hide();
  }


  getPlaneMouseControls(planeId) {
    return _.extend(super.getPlaneMouseControls(planeId), {

      leftClick: (pos, plane, event) => this.onClick(pos, event.shiftKey, event.altKey, plane),


      rightClick: (pos, plane, event) => this.setWaypoint(this.calculateGlobalPos(pos), event.ctrlKey),
    },
    );
  }


  getTDViewMouseControls() {
    return _.extend(super.getTDViewMouseControls(), {

      leftClick: (position, plane, event) => this.onClick(position, event.shiftKey, event.altKey, constants.TDView),
    },
    );
  }


  getKeyboardControls() {
    return _.extend(super.getKeyboardControls(), {

      "1": () => this.skeletonTracingController.toggleSkeletonVisibility(),
      "2": () => this.sceneController.skeleton.toggleInactiveTreeVisibility(),

      // Delete active node
      delete: () => _.defer(() => this.model.skeletonTracing.deleteActiveNode()),
      c: () => this.model.skeletonTracing.createNewTree(),

      // Branches
      b: () => this.model.skeletonTracing.pushBranch(),
      j: () => this.popBranch(),

      s: () => {
        this.skeletonTracingController.centerActiveNode();
        return this.cameraController.centerTDView();
      },
    },
    );
  }


  popBranch = () => _.defer(
    () => {
      this.model.skeletonTracing.popBranch().then(
        id => this.skeletonTracingController.setActiveNode(id, false, true),
      );
    },
  );


  scrollPlanes(delta, type) {
    super.scrollPlanes(delta, type);

    if (type === "shift") {
      this.skeletonTracingController.setRadius(delta);
    }
  }


  onClick = (position, shiftPressed, altPressed, plane) => {
    if (!shiftPressed) { // do nothing
      return;
    }

    const { scaleFactor } = this.planeView;
    const camera = this.planeView.getCameras()[plane];
    // vector with direction from camera position to click position
    const normalizedMousePos = new THREE.Vector2(
        ((position.x / (constants.VIEWPORT_WIDTH * scaleFactor)) * 2) - 1,
        (-(position.y / (constants.VIEWPORT_WIDTH * scaleFactor)) * 2) + 1);

    // create a ray with the direction of this vector, set ray threshold depending on the zoom of the 3D-view
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(normalizedMousePos, camera);
    raycaster.params.Points.threshold = this.model.flycam.getRayThreshold(plane);

    // identify clicked object
    let intersects = raycaster.intersectObjects(this.sceneController.skeleton.getAllNodes());

    // Also look backwards: We want to detect object even when they are behind
    // the camera. Later, we filter out invisible objects.
    raycaster.ray.direction.multiplyScalar(-1);
    intersects = intersects.concat(raycaster.intersectObjects(this.sceneController.skeleton.getAllNodes()));

    intersects = _.sortBy(intersects, intersect => intersect.distanceToRay);

    for (const intersect of intersects) {
      const { index } = intersect;
      const { geometry } = intersect.object;

      // Raycaster also intersects with vertices that have an
      // index larger than numItems
      if (geometry.nodeIDs.getLength() <= index) {
        continue;
      }

      const nodeID = geometry.nodeIDs.getAllElements()[index];

      const posArray = geometry.attributes.position.array;
      const intersectsCoord = [posArray[3 * index], posArray[(3 * index) + 1], posArray[(3 * index) + 2]];
      const globalPos = this.model.flycam.getPosition();

      // make sure you can't click nodes, that are clipped away (one can't see)
      const ind = dimensions.getIndices(plane);
      if (intersect.object.visible &&
        (plane === constants.TDView ||
          (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < this.cameraController.getClippingDistance(ind[2]) + 1))) {
        // set the active Node to the one that has the ID stored in the vertex
        // center the node if click was in 3d-view
        const centered = plane === constants.TDView;
        this.skeletonTracingController.setActiveNode(nodeID, shiftPressed && altPressed, centered);
        break;
      }
    }
  };


  setWaypoint(position, ctrlPressed) {
    const activeNode = this.model.skeletonTracing.getActiveNode();
    // set the new trace direction
    if (activeNode) {
      this.model.flycam.setDirection([
        position[0] - activeNode.pos[0],
        position[1] - activeNode.pos[1],
        position[2] - activeNode.pos[2],
      ]);
    }

    const rotation = this.model.flycam.getRotation(this.activeViewport);
    this.addNode(position, rotation, !ctrlPressed);

    // Strg + Rightclick to set new not active branchpoint
    if (ctrlPressed && !this.model.user.get("newNodeNewTree")) {
      this.model.skeletonTracing.pushBranch();
      this.skeletonTracingController.setActiveNode(activeNode.id);
    }
  }


  addNode = (position, rotation, centered) => {
    if (this.model.settings.somaClickingAllowed && this.model.user.get("newNodeNewTree")) {
      this.model.skeletonTracing.createNewTree();
    }

    if (this.model.skeletonTracing.getActiveNode() == null) {
      centered = true;
    }

    const datasetConfig = Store.getState().datasetConfiguration;

    this.model.skeletonTracing.addNode(
      position,
      rotation,
      this.activeViewport,
      this.model.flycam.getIntegerZoomStep(),
      datasetConfig.fourBit ? 4 : 8,
      datasetConfig.interpolation,
    );

    if (centered) {
      this.centerPositionAnimated(this.model.skeletonTracing.getActiveNodePos());
    }
  };


  centerPositionAnimated(position) {
    // Let the user still manipulate the "third dimension" during animation
    const dimensionToSkip = dimensions.thirdDimensionForPlane(this.activeViewport);

    const curGlobalPos = this.flycam.getPosition();

    return (new TWEEN.Tween({
      globalPosX: curGlobalPos[0],
      globalPosY: curGlobalPos[1],
      globalPosZ: curGlobalPos[2],
      flycam: this.flycam,
      dimensionToSkip,
    }))
    .to({
      globalPosX: position[0],
      globalPosY: position[1],
      globalPosZ: position[2],
    }, 200)
    .onUpdate(function () {
      const curPos = [this.globalPosX, this.globalPosY, this.globalPosZ];
      curPos[this.dimensionToSkip] = null;
      this.flycam.setPosition(curPos);
    })
    .start();
  }
}


export default SkeletonTracingPlaneController;
