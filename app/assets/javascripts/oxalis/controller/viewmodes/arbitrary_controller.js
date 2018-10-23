/**
 * arbitrary_controller.js
 * @flow
 */

import * as React from "react";
import BackboneEvents from "backbone-events-standalone";
import { connect } from "react-redux";
import _ from "lodash";
import { InputKeyboard, InputMouse, InputKeyboardNoLoop } from "libs/input";
import type { ModifierKeys } from "libs/input";
import { V3 } from "libs/mjs";
import * as Utils from "libs/utils";
import Toast from "libs/toast";
import type { Mode, Point2 } from "oxalis/constants";
import Store from "oxalis/store";
import { getViewportScale, getInputCatcherRect } from "oxalis/model/accessors/view_mode_accessor";
import CameraController from "oxalis/controller/camera_controller";
import { voxelToNm, getBaseVoxel, getBaseVoxelFactors } from "oxalis/model/scaleinfo";
import TrackballControls from "libs/trackball_controls";
import Model from "oxalis/model";
import * as THREE from "three";
import constants, {
  OrthoViews,
  ArbitraryViewport,
  OrthoViewValues,
  OrthoViewValuesWithoutTDView,
  VolumeToolEnum,
} from "oxalis/constants";
import {
  setViewportAction,
  setTDCameraAction,
  zoomTDViewAction,
  moveTDViewXAction,
  moveTDViewYAction,
  moveTDViewByVectorAction,
} from "oxalis/model/actions/view_mode_actions";
import {
  updateUserSettingAction,
  setFlightmodeRecordingAction,
} from "oxalis/model/actions/settings_actions";
import {
  setActiveNodeAction,
  deleteActiveNodeAsUserAction,
  createNodeAction,
  createBranchPointAction,
  requestDeleteBranchPointAction,
  toggleAllTreesAction,
  toggleInactiveTreesAction,
} from "oxalis/model/actions/skeletontracing_actions";
import ArbitraryPlane from "oxalis/geometries/arbitrary_plane";
import { threeCameraToCameraData } from "./plane_controller";
import Crosshair from "oxalis/geometries/crosshair";
import app from "app";
import ArbitraryView from "oxalis/view/arbitrary_view";

import type { Matrix4x4 } from "libs/mjs";
import {
  yawFlycamAction,
  pitchFlycamAction,
  zoomInAction,
  zoomOutAction,
  moveFlycamAction,
  movePlaneFlycamOrthoAction,
  moveFlycamOrthoAction,
  zoomByDeltaAction,
} from "oxalis/model/actions/flycam_actions";
import { getRotation, getPosition } from "oxalis/model/accessors/flycam_accessor";
import {
  enforceSkeletonTracing,
  getActiveNode,
  getMaxNodeId,
} from "oxalis/model/accessors/skeletontracing_accessor";
import messages from "messages";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import SceneController from "oxalis/controller/scene_controller";
import api from "oxalis/api/internal_api";

const arbitraryViewportSelector = "#inputcatcher_arbitraryViewport";

type Props = {
  onRender: () => void,
  viewMode: Mode,
};

class ArbitraryController extends React.PureComponent<Props> {
  // See comment in Controller class on general controller architecture.
  //
  // Arbitrary Controller: Responsible for Arbitrary Modes
  arbitraryView: ArbitraryView;
  isStarted: boolean;
  plane: ArbitraryPlane;
  crosshair: Crosshair;
  lastNodeMatrix: Matrix4x4;
  input: {
    mouse?: InputMouse,
    keyboard?: InputKeyboard,
    keyboardLoopDelayed?: InputKeyboard,
    keyboardNoLoop?: InputKeyboardNoLoop,
  };
  storePropertyUnsubscribers: Array<Function>;
  controls: TrackballControls;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  stopListening: Function;

  componentDidMount() {
    _.extend(this, BackboneEvents);
    this.input = {};
    this.storePropertyUnsubscribers = [];
    this.start();
  }

  componentWillUnmount() {
    this.stop();
  }

  initMouse(): void {
    Utils.waitForSelector(arbitraryViewportSelector).then(() => {
      this.input.mouse = new InputMouse(arbitraryViewportSelector, {
        leftDownMove: (delta: Point2) => {
          if (this.props.viewMode === constants.MODE_ARBITRARY) {
            Store.dispatch(
              yawFlycamAction(delta.x * Store.getState().userConfiguration.mouseRotateValue, true),
            );
            Store.dispatch(
              pitchFlycamAction(
                delta.y * -1 * Store.getState().userConfiguration.mouseRotateValue,
                true,
              ),
            );
          } else if (this.props.viewMode === constants.MODE_ARBITRARY_PLANE) {
            const f = Store.getState().flycam.zoomStep / getViewportScale(ArbitraryViewport);
            Store.dispatch(moveFlycamAction([delta.x * f, delta.y * f, 0]));
          }
        },
        scroll: this.scroll,
        pinch: (delta: number) => {
          if (delta < 0) {
            Store.dispatch(zoomOutAction());
          } else {
            Store.dispatch(zoomInAction());
          }
        },
      });
    });

    const tdView = OrthoViews.TDView;
    const inputcatcherSelector = `#inputcatcher_${tdView}`;

    setTimeout(() => {
      console.log("attaching mouse");
      Utils.waitForSelector(inputcatcherSelector).then(domElement => {
        this.input.mouseControllers = {
          [tdView]: new InputMouse(inputcatcherSelector, this.getTDViewMouseControls(), tdView),
        };
      });
      this.initTrackballControls();
    }, 2000);
  }

  initTrackballControls(): void {
    Utils.waitForSelector("#inputcatcher_TDView").then(view => {
      const pos = voxelToNm(this.props.scale, getPosition(this.props.flycam));
      const tdCamera = this.arbitraryView.getCameras()[OrthoViews.TDView];
      this.controls = new TrackballControls(tdCamera, view, new THREE.Vector3(...pos), () => {
        // write threeJS camera into store
        Store.dispatch(setTDCameraAction(threeCameraToCameraData(tdCamera)));
      });

      this.controls.noZoom = true;
      this.controls.noPan = true;
      this.controls.staticMoving = true;

      this.controls.target.set(...pos);

      // This is necessary, since we instantiated this.controls now. This should be removed
      // when the workaround with requestAnimationFrame(initInputHandlers) is removed.
      this.forceUpdate();
    });
  }

  initKeyboard(): void {
    const getRotateValue = () => Store.getState().userConfiguration.rotateValue;
    const isArbitrary = () => this.props.viewMode === constants.MODE_ARBITRARY;

    this.input.keyboard = new InputKeyboard({
      // KeyboardJS is sensitive to ordering (complex combos first)

      // Move
      space: timeFactor => {
        this.setRecord(true);
        this.move(timeFactor);
      },
      "ctrl + space": timeFactor => {
        this.setRecord(true);
        this.move(-timeFactor);
      },

      f: timeFactor => {
        this.setRecord(false);
        this.move(timeFactor);
      },
      d: timeFactor => {
        this.setRecord(false);
        this.move(-timeFactor);
      },

      // Rotate at centre
      "shift + left": timeFactor => {
        Store.dispatch(yawFlycamAction(getRotateValue() * timeFactor));
      },
      "shift + right": timeFactor => {
        Store.dispatch(yawFlycamAction(-getRotateValue() * timeFactor));
      },
      "shift + up": timeFactor => {
        Store.dispatch(pitchFlycamAction(getRotateValue() * timeFactor));
      },
      "shift + down": timeFactor => {
        Store.dispatch(pitchFlycamAction(-getRotateValue() * timeFactor));
      },

      // Rotate in distance
      left: timeFactor => {
        Store.dispatch(yawFlycamAction(getRotateValue() * timeFactor, isArbitrary()));
      },
      right: timeFactor => {
        Store.dispatch(yawFlycamAction(-getRotateValue() * timeFactor, isArbitrary()));
      },
      up: timeFactor => {
        Store.dispatch(pitchFlycamAction(-getRotateValue() * timeFactor, isArbitrary()));
      },
      down: timeFactor => {
        Store.dispatch(pitchFlycamAction(getRotateValue() * timeFactor, isArbitrary()));
      },

      // Zoom in/out
      i: () => {
        Store.dispatch(zoomInAction());
      },
      o: () => {
        Store.dispatch(zoomOutAction());
      },
    });

    // Own InputKeyboard with delay for changing the Move Value, because otherwise the values changes to drastically
    this.input.keyboardLoopDelayed = new InputKeyboard(
      {
        h: () => this.changeMoveValue(25),
        g: () => this.changeMoveValue(-25),
      },
      { delay: Store.getState().userConfiguration.keyboardDelay },
    );

    this.input.keyboardNoLoop = new InputKeyboardNoLoop({
      "1": () => {
        Store.dispatch(toggleAllTreesAction());
      },
      "2": () => {
        Store.dispatch(toggleInactiveTreesAction());
      },

      // Branches
      b: () => this.pushBranch(),
      j: () => {
        Store.dispatch(requestDeleteBranchPointAction());
      },

      // Recenter active node
      s: () => {
        const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
        getActiveNode(skeletonTracing).map(activeNode =>
          api.tracing.centerPositionAnimated(activeNode.position, false, activeNode.rotation),
        );
      },

      ".": () => this.nextNode(true),
      ",": () => this.nextNode(false),

      // Rotate view by 180 deg
      r: () => {
        Store.dispatch(yawFlycamAction(Math.PI));
        window.needsRerender = true;
      },

      // Delete active node and recenter last node
      "shift + space": () => {
        Store.dispatch(deleteActiveNodeAsUserAction(Store.getState()));
      },
    });
  }

  setRecord(record: boolean): void {
    if (record !== Store.getState().temporaryConfiguration.flightmodeRecording) {
      Store.dispatch(setFlightmodeRecordingAction(record));
      this.setWaypoint();
    }
  }

  nextNode(nextOne: boolean): void {
    const skeletonTracing = enforceSkeletonTracing(Store.getState().tracing);
    Utils.zipMaybe(getActiveNode(skeletonTracing), getMaxNodeId(skeletonTracing)).map(
      ([activeNode, maxNodeId]) => {
        if ((nextOne && activeNode.id === maxNodeId) || (!nextOne && activeNode.id === 1)) {
          return;
        }
        Store.dispatch(setActiveNodeAction(activeNode.id + 2 * Number(nextOne) - 1)); // implicit cast from boolean to int
      },
    );
  }

  getVoxelOffset(timeFactor: number): number {
    const state = Store.getState();
    const { moveValue3d } = state.userConfiguration;
    const baseVoxel = getBaseVoxel(state.dataset.dataSource.scale);
    return (moveValue3d * timeFactor) / baseVoxel / constants.FPS;
  }

  move(timeFactor: number): void {
    if (!this.isStarted) {
      return;
    }
    Store.dispatch(moveFlycamAction([0, 0, this.getVoxelOffset(timeFactor)]));
    this.moved();
  }

  init(): void {
    const { clippingDistanceArbitrary } = Store.getState().userConfiguration;
    this.setClippingDistance(clippingDistanceArbitrary);
  }

  bindToEvents(): void {
    this.listenTo(this.arbitraryView, "render", this.props.onRender);

    const onBucketLoaded = () => {
      this.arbitraryView.draw();
      app.vent.trigger("rerender");
    };

    for (const dataLayer of Model.getAllLayers()) {
      this.listenTo(dataLayer.cube, "bucketLoaded", onBucketLoaded);
    }

    this.storePropertyUnsubscribers.push(
      listenToStoreProperty(
        state => state.userConfiguration,
        userConfiguration => {
          const { clippingDistanceArbitrary, displayCrosshair, crosshairSize } = userConfiguration;
          this.setClippingDistance(clippingDistanceArbitrary);
          this.crosshair.setScale(crosshairSize);
          this.crosshair.setVisibility(displayCrosshair);
          this.arbitraryView.resizeThrottled();
        },
      ),
      listenToStoreProperty(
        state => state.temporaryConfiguration.flightmodeRecording,
        isRecording => {
          if (isRecording) {
            // This listener is responsible for setting a new waypoint, when the user enables
            // the "flightmode recording" toggle in the top-left corner of the flight canvas.
            this.setWaypoint();
          }
        },
      ),
      listenToStoreProperty(
        state => state.userConfiguration.keyboardDelay,
        keyboardDelay => {
          const { keyboardLoopDelayed } = this.input;
          if (keyboardLoopDelayed != null) {
            keyboardLoopDelayed.delay = keyboardDelay;
          }
        },
      ),
    );
  }

  start(): void {
    this.arbitraryView = new ArbitraryView();
    window.printy = () => {
      this.arbitraryView.getRenderedBuckets();
      window.useRenderedBucketsInNextFrame = true;
      window.redetermineBuckets();
    };
    this.arbitraryView.start();

    this.plane = new ArbitraryPlane();
    this.crosshair = new Crosshair(Store.getState().userConfiguration.crosshairSize);
    this.crosshair.setVisibility(Store.getState().userConfiguration.displayCrosshair);

    this.arbitraryView.addGeometry(this.plane);
    this.arbitraryView.setArbitraryPlane(this.plane);
    this.arbitraryView.addGeometry(this.crosshair);

    this.bindToEvents();

    this.initKeyboard();
    this.initMouse();
    this.init();

    const { clippingDistance } = Store.getState().userConfiguration;
    SceneController.setClippingDistance(clippingDistance);

    this.arbitraryView.draw();

    this.isStarted = true;
  }

  unsubscribeStoreListeners() {
    this.storePropertyUnsubscribers.forEach(unsubscribe => unsubscribe());
    this.storePropertyUnsubscribers = [];
  }

  stop(): void {
    this.stopListening();
    this.unsubscribeStoreListeners();

    if (this.isStarted) {
      this.destroyInput();
    }

    this.arbitraryView.stop();
    this.plane.destroy();

    this.isStarted = false;
  }

  scroll = (delta: number, type: ?ModifierKeys) => {
    if (type === "shift") {
      this.setParticleSize(Utils.clamp(-1, delta, 1));
    }
  };

  destroyInput() {
    Utils.__guard__(this.input.mouse, x => x.destroy());
    Utils.__guard__(this.input.keyboard, x => x.destroy());
    Utils.__guard__(this.input.keyboardLoopDelayed, x => x.destroy());
    Utils.__guard__(this.input.keyboardNoLoop, x => x.destroy());
  }

  setWaypoint(): void {
    if (!Store.getState().temporaryConfiguration.flightmodeRecording) {
      return;
    }
    const position = getPosition(Store.getState().flycam);
    const rotation = getRotation(Store.getState().flycam);

    Store.dispatch(createNodeAction(position, rotation, constants.ARBITRARY_VIEW, 0));
  }

  changeMoveValue(delta: number): void {
    let moveValue = Store.getState().userConfiguration.moveValue3d + delta;
    moveValue = Math.min(constants.MAX_MOVE_VALUE, moveValue);
    moveValue = Math.max(constants.MIN_MOVE_VALUE, moveValue);

    Store.dispatch(updateUserSettingAction("moveValue3d", moveValue));

    const moveValueMessage = messages["tracing.changed_move_value"] + moveValue;
    Toast.success(moveValueMessage, { key: "CHANGED_MOVE_VALUE" });
  }

  setParticleSize(delta: number): void {
    let particleSize = Store.getState().userConfiguration.particleSize + delta;
    particleSize = Math.min(constants.MAX_PARTICLE_SIZE, particleSize);
    particleSize = Math.max(constants.MIN_PARTICLE_SIZE, particleSize);

    Store.dispatch(updateUserSettingAction("particleSize", particleSize));
  }

  setClippingDistance(value: number): void {
    this.arbitraryView.setClippingDistance(value);
  }

  pushBranch(): void {
    // Consider for deletion
    this.setWaypoint();
    Store.dispatch(createBranchPointAction());
    Toast.success(messages["tracing.branchpoint_set"]);
  }

  moved(): void {
    const matrix = Store.getState().flycam.currentMatrix;

    if (this.lastNodeMatrix == null) {
      this.lastNodeMatrix = matrix;
    }

    const { lastNodeMatrix } = this;

    const vector = [
      lastNodeMatrix[12] - matrix[12],
      lastNodeMatrix[13] - matrix[13],
      lastNodeMatrix[14] - matrix[14],
    ];
    const vectorLength = V3.length(vector);

    if (vectorLength > 10) {
      this.setWaypoint();
      this.lastNodeMatrix = matrix;
    }
  }

  updateControls = () => this.controls.update(true);

  render() {
    if (!this.controls) {
      return null;
    }
    return (
      <CameraController
        cameras={this.arbitraryView.getCameras()}
        onCameraPositionChanged={this.updateControls}
      />
    );
  }

  getTDViewMouseControls(): Object {
    // todo
    const baseControls = {
      leftDownMove: (delta: Point2) => this.moveTDView(delta),
      scroll: (value: number) => this.zoomTDView(Utils.clamp(-1, value, 1), true),
      over: () => {
        Store.dispatch(setViewportAction(OrthoViews.TDView));
        // Fix the rotation target of the TrackballControls
        this.setTargetAndFixPosition();
      },
      pinch: delta => this.zoomTDView(delta, true),
    };

    const skeletonControls =
      // this.props.tracing.skeleton != null
      //   ? skeletonController.getTDViewMouseControls(this.planeView) :
      {};

    return {
      ...baseControls,
      ...skeletonControls,
    };
  }

  setTargetAndFixPosition(): void {
    return;
    // const position = getPosition(this.props.flycam);
    // const nmPosition = voxelToNm(this.props.scale, position);

    // this.controls.target.set(...nmPosition);
    // this.controls.update();

    // // The following code is a dirty hack. If someone figures out
    // // how the trackball control's target can be set without affecting
    // // the camera position, go ahead.
    // // As the previous step will also move the camera, we need to
    // // fix this by offsetting the viewport

    // const invertedDiff = [];
    // for (let i = 0; i <= 2; i++) {
    //   invertedDiff.push(this.oldNmPos[i] - nmPosition[i]);
    // }

    // if (invertedDiff.every(el => el === 0)) return;

    // this.oldNmPos = nmPosition;

    // const nmVector = new THREE.Vector3(...invertedDiff);
    // // moves camera by the nm vector
    // const camera = this.planeView.getCameras()[OrthoViews.TDView];

    // const rotation = THREE.Vector3.prototype.multiplyScalar.call(camera.rotation.clone(), -1);
    // // reverse euler order
    // rotation.order = rotation.order
    //   .split("")
    //   .reverse()
    //   .join("");

    // nmVector.applyEuler(rotation);

    // Store.dispatch(moveTDViewByVectorAction(nmVector.x, nmVector.y));
  }

  movePlane = (v: Vector3, increaseSpeedWithZoom: boolean = true) => {
    const { activeViewport } = Store.getState().viewModeData.plane;
    Store.dispatch(movePlaneFlycamOrthoAction(v, activeViewport, increaseSpeedWithZoom));
  };

  moveX = (x: number): void => {
    this.movePlane([x, 0, 0]);
  };

  moveY = (y: number): void => {
    this.movePlane([0, y, 0]);
  };

  moveZ = (z: number, oneSlide: boolean): void => {
    const { activeViewport } = Store.getState().viewModeData.plane;
    if (activeViewport === OrthoViews.TDView) {
      return;
    }

    if (oneSlide) {
      const logZoomStep = getRequestLogZoomStep(Store.getState());
      const w = Dimensions.getIndices(activeViewport)[2];
      const zStep = getResolutions(Store.getState().dataset)[logZoomStep][w];

      Store.dispatch(
        moveFlycamOrthoAction(
          Dimensions.transDim([0, 0, (z < 0 ? -1 : 1) * Math.max(1, zStep)], activeViewport),
          activeViewport,
        ),
      );
    } else {
      this.movePlane([0, 0, z], false);
    }
  };

  zoom(value: number, zoomToMouse: boolean): void {
    const { activeViewport } = Store.getState().viewModeData.plane;
    if (OrthoViewValuesWithoutTDView.includes(activeViewport)) {
      this.zoomPlanes(value, zoomToMouse);
    } else {
      this.zoomTDView(value, zoomToMouse);
    }
  }

  zoomPlanes(value: number, zoomToMouse: boolean): void {
    if (zoomToMouse) {
      this.zoomPos = this.getMousePosition();
    }

    Store.dispatch(zoomByDeltaAction(value));

    if (zoomToMouse) {
      this.finishZoom();
    }
  }

  zoomTDView(value: number, zoomToMouse: boolean = true): void {
    let zoomToPosition;
    if (zoomToMouse) {
      zoomToPosition = this.input.mouseControllers[OrthoViews.TDView].position;
    }
    const { width } = getInputCatcherRect(OrthoViews.TDView);
    Store.dispatch(zoomTDViewAction(value, zoomToPosition, width));
  }

  moveTDView(delta: Point2): void {
    const scale = getViewportScale(OrthoViews.TDView);
    Store.dispatch(moveTDViewXAction((delta.x / scale) * -1));
    Store.dispatch(moveTDViewYAction((delta.y / scale) * -1));
  }

  finishZoom = (): void => {
    // Move the plane so that the mouse is at the same position as
    // before the zoom
    const { activeViewport } = Store.getState().viewModeData.plane;
    if (this.isMouseOver() && activeViewport !== OrthoViews.TDView) {
      const mousePos = this.getMousePosition();
      const moveVector = [
        this.zoomPos[0] - mousePos[0],
        this.zoomPos[1] - mousePos[1],
        this.zoomPos[2] - mousePos[2],
      ];
      Store.dispatch(moveFlycamOrthoAction(moveVector, activeViewport));
    }
  };
}

export function mapStateToProps(state: OxalisState, ownProps: OwnProps): Props {
  return {
    flycam: state.flycam,
    scale: state.dataset.dataSource.scale,
    onRender: ownProps.onRender,
    tracing: state.tracing,
  };
}

export { ArbitraryController as ArbitraryControllerClass };
export default connect(mapStateToProps)(ArbitraryController);
