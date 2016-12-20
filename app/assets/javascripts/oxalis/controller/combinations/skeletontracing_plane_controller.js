import app from "app";
import THREE from "three";
import TWEEN from "tween.js";
import _ from "lodash";
import PlaneController from "../viewmodes/plane_controller";
import constants from "../../constants";
import dimensions from "../../model/dimensions";

class SkeletonTracingPlaneController extends PlaneController {

  // See comment in Controller class on general controller architecture.
  //
  // Skeleton Tracing Plane Controller:
  // Extends Plane controller to add controls that are specific to Skeleton
  // Tracing.


  constructor(model, view, sceneController, skeletonTracingController) {

    super(model, view, sceneController);
    // TODO: These lines were before super in coffee, which is not allowed in
    // ES6. Check if this is ok respectively fix it.
    this.model = model;
    this.view = view;
    this.sceneController = sceneController;
    this.skeletonTracingController = skeletonTracingController;

    this.popBranch = this.popBranch.bind(this);
    this.scrollPlanes = this.scrollPlanes.bind(this);
    this.onClick = this.onClick.bind(this);
    this.setWaypoint = this.setWaypoint.bind(this);
    this.addNode = this.addNode.bind(this);
  }


  start() {

    super.start();
    return $('.skeleton-plane-controls').show();
  }


  stop() {

    super.stop();
    return $('.skeleton-plane-controls').hide();
  }


  getPlaneMouseControls(planeId) {

    return _.extend(super.getPlaneMouseControls(planeId), {

      leftClick : (pos, plane, event) => {

        return this.onClick(pos, event.shiftKey, event.altKey, plane);
      },


      rightClick : (pos, plane, event) => {

        return this.setWaypoint(this.calculateGlobalPos( pos ), event.ctrlKey);
      }
    }
    );
  }


  getTDViewMouseControls() {

    return _.extend(super.getTDViewMouseControls(), {

      leftClick : (position, plane, event) => {
        return this.onClick(position, event.shiftKey, event.altKey, constants.TDView);
      }
    }
    );
  }


  getKeyboardControls() {

    return _.extend(super.getKeyboardControls(), {

      "1" : () => this.skeletonTracingController.toggleSkeletonVisibility(),
      "2" : () => this.sceneController.skeleton.toggleInactiveTreeVisibility(),

      //Delete active node
      "delete" : () => {
        return _.defer(() => this.model.skeletonTracing.deleteActiveNode());
      },
      "c" : () => this.model.skeletonTracing.createNewTree(),

      //Branches
      "b" : () => this.model.skeletonTracing.pushBranch(),
      "j" : () => this.popBranch(),

      "s" : () => {
        this.skeletonTracingController.centerActiveNode();
        return this.cameraController.centerTDView();
      }
    }
    );
  }


  popBranch() {

    return _.defer(() => this.model.skeletonTracing.popBranch().then(id => {
      return this.skeletonTracingController.setActiveNode(id, false, true);
    }
    )
    );
  }


  scrollPlanes(delta, type) {

    super.scrollPlanes(delta, type);

    if (type === "shift") {
      return this.skeletonTracingController.setRadius(delta);
    }
  }


  onClick(position, shiftPressed, altPressed, plane) {

    if (!shiftPressed) { // do nothing
      return;
    }

    const { scaleFactor } = this.planeView;
    const camera      = this.planeView.getCameras()[plane];
    // vector with direction from camera position to click position
    const vector = new THREE.Vector3(((position.x / (384 * scaleFactor) ) * 2) - 1, (- (position.y / (384 * scaleFactor)) * 2) + 1, 0.5);

    // create a ray with the direction of this vector, set ray threshold depending on the zoom of the 3D-view
    const projector = new THREE.Projector();
    const raycaster = projector.pickingRay(vector, camera);
    raycaster.ray.threshold = this.model.flycam.getRayThreshold(plane);

    raycaster.ray.__scalingFactors = app.scaleInfo.nmPerVoxel;

    // identify clicked object
    const intersects = raycaster.intersectObjects(this.sceneController.skeleton.getAllNodes());

    return (() => {
      const result = [];
      for (let intersect of intersects) {

        let item;
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
            (Math.abs(globalPos[ind[2]] - intersectsCoord[ind[2]]) < this.cameraController.getClippingDistance(ind[2])+1))) {

          // set the active Node to the one that has the ID stored in the vertex
          // center the node if click was in 3d-view
          const centered = plane === constants.TDView;
          this.skeletonTracingController.setActiveNode(nodeID, shiftPressed && altPressed, centered);
          break;
        }
        result.push(item);
      }
      return result;
    })();
  }


  setWaypoint(position, ctrlPressed) {

    const activeNode = this.model.skeletonTracing.getActiveNode();
    // set the new trace direction
    if (activeNode) {
      this.model.flycam.setDirection([
        position[0] - activeNode.pos[0],
        position[1] - activeNode.pos[1],
        position[2] - activeNode.pos[2]
      ]);
    }

    const rotation = this.model.flycam.getRotation(this.activeViewport);
    this.addNode(position, rotation, !ctrlPressed);

    // Strg + Rightclick to set new not active branchpoint
    if (ctrlPressed && !this.model.user.get("newNodeNewTree")) {

      this.model.skeletonTracing.pushBranch();
      return this.skeletonTracingController.setActiveNode(activeNode.id);
    }
  }


  addNode(position, rotation, centered) {

    if (this.model.settings.somaClickingAllowed && this.model.user.get("newNodeNewTree")) {
      this.model.skeletonTracing.createNewTree();
    }

    if (this.model.skeletonTracing.getActiveNode() == null) {
      centered = true;
    }

    const datasetConfig = this.model.get("datasetConfiguration");

    this.model.skeletonTracing.addNode(
      position,
      rotation,
      this.activeViewport,
      this.model.flycam.getIntegerZoomStep(),
      datasetConfig.get("fourBit") ? 4 : 8,
      datasetConfig.get("interpolation")
    );

    if (centered) {
      return this.centerPositionAnimated(this.model.skeletonTracing.getActiveNodePos());
    }
  }


  centerPositionAnimated(position) {

    // Let the user still manipulate the "third dimension" during animation
    const dimensionToSkip = dimensions.thirdDimensionForPlane(this.activeViewport);

    const curGlobalPos = this.flycam.getPosition();

    return (new TWEEN.Tween({
        globalPosX: curGlobalPos[0],
        globalPosY: curGlobalPos[1],
        globalPosZ: curGlobalPos[2],
        flycam: this.flycam,
        dimensionToSkip
    }))
    .to({
        globalPosX: position[0],
        globalPosY: position[1],
        globalPosZ: position[2]
      }, 200)
    .onUpdate( function() {
        position = [this.globalPosX, this.globalPosY, this.globalPosZ];
        position[this.dimensionToSkip] = null;
        return this.flycam.setPosition(position);
      })
    .start();
  }
}


export default SkeletonTracingPlaneController;
