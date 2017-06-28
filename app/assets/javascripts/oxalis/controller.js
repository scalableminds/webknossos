/**
 * controller.js
 * @flow
 */
 /* globals JQueryInputEventObject:false */

import React from "react";
import $ from "jquery";
import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import Backbone from "backbone";
import Stats from "stats.js";
import { InputKeyboardNoLoop } from "libs/input";
import Toast from "libs/toast";
import Store from "oxalis/store";
import PlaneController from "oxalis/controller/viewmodes/plane_controller";
import SkeletonTracingPlaneController from "oxalis/controller/combinations/skeletontracing_plane_controller";
import VolumeTracingPlaneController from "oxalis/controller/combinations/volumetracing_plane_controller";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";
import MinimalSkeletonTracingArbitraryController from "oxalis/controller/combinations/minimal_skeletontracing_arbitrary_controller";
import SceneController from "oxalis/controller/scene_controller";
import UrlManager from "oxalis/controller/url_manager";
import constants, { ControlModeEnum } from "oxalis/constants";
import Request from "libs/request";
import api from "oxalis/api/internal_api";
import { wkReadyAction, restartSagaAction } from "oxalis/model/actions/actions";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import { setViewModeAction } from "oxalis/model/actions/settings_actions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import Model from "oxalis/model";
import Modal from "oxalis/view/modal";
import { connect } from "react-redux";
import messages from "messages";

import type { ToastType } from "libs/toast";
import type { ModeType, ControlModeType } from "oxalis/constants";
import type { OxalisState, SkeletonTracingTypeTracingType } from "oxalis/store";

class Controller extends React.PureComponent {
  props: {
    initialTracingType: SkeletonTracingTypeTracingType,
    initialTracingId: string,
    initialControlmode: ControlModeType,
    // Delivered by connect()
    viewMode: ModeType,
  }

  zoomStepWarningToast: ToastType;
  keyboardNoLoop: InputKeyboardNoLoop;
  stats: Stats;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  stopListening: Function;

  state: {
    ready: boolean,
  } = {
    ready: false,
  }

  // Main controller, responsible for setting modes and everything
  // that has to be controlled in any mode.
  //
  // We have a matrix of modes like this:
  //
  //   Annotation Mode \ View mode    Plane       Arbitrary
  //              Skeleton Tracing      X             X
  //                Volume Tracing      X             /
  //
  // In order to maximize code reuse, there is - besides the main
  // controller - a controller for each row, each column and each
  // cross in this matrix.

  componentDidMount() {
    app.router.showLoadingSpinner();

    _.extend(this, Backbone.Events);

    UrlManager.initialize();

    if (!this.isWebGlSupported()) {
      Toast.error(messages["webgl.disabled"]);
    }

    Model.fetch(this.props.initialTracingType, this.props.initialTracingId, this.props.initialControlmode, true)
      .then(() => this.modelFetchDone())
      .catch((error) => {
        // Don't throw errors for errors already handled by the model.
        if (error !== Model.HANDLED_ERROR) {
          throw error;
        }
      });
  }

  modelFetchDone() {
    app.router.on("beforeunload", () => {
      const stateSaved = Model.stateSaved();
      if (!stateSaved && Store.getState().tracing.restrictions.allowUpdate) {
        Store.dispatch(saveNowAction());
        return messages["save.leave_page_unfinished"];
      }
      return null;
    });

    UrlManager.startUrlUpdater();
    SceneController.initialize();

    // FPS stats
    this.stats = new Stats();
    $("body").append(this.stats.domElement);

    this.initKeyboard();
    this.initTaskScript();
    this.maybeShowNewTaskTypeModal();

    for (const binaryName of Object.keys(Model.binary)) {
      this.listenTo(Model.binary[binaryName].cube, "bucketLoaded", () => app.vent.trigger("rerender"));
    }

    listenToStoreProperty(store => store.flycam.zoomStep, () => this.maybeWarnAboutZoomStep(), true);

    window.webknossos = api;

    app.router.hideLoadingSpinner();
    app.vent.trigger("webknossos:ready");
    Store.dispatch(wkReadyAction());
    this.setState({ ready: true });
  }

  // For tracing swap testing, call
  // app.oxalis.restart("Explorational", "5909b5aa3e0000d4009d4d15", "TRACE")
  // with a tracing id of your choice from the dev console
  async restart(newTracingType: SkeletonTracingTypeTracingType, newTracingId: string, newControlMode: ControlModeType) {
    Store.dispatch(restartSagaAction());
    UrlManager.reset();
    await Model.fetch(newTracingType, newTracingId, newControlMode, false);
    Store.dispatch(wkReadyAction());
  }

  initTaskScript() {
    // Loads a Gist from GitHub with a user script if there is a
    // script assigned to the task
    const task = Store.getState().task;
    if (task != null && task.script != null) {
      const script = task.script;
      const gistId = _.last(script.gist.split("/"));

      Request.receiveJSON(`https://api.github.com/gists/${gistId}`).then((gist) => {
        const firstFile = gist.files[Object.keys(gist.files)[0]];

        if (firstFile && firstFile.content) {
          try {
            // eslint-disable-next-line no-eval
            eval(firstFile.content);
          } catch (error) {
            console.error(error);
            Toast.error(`Error executing the task script "${script.name}". See console for more information.`);
          }
        } else {
          Toast.error(`${messages["task.user_script_retrieval_error"]} ${script.name}`);
        }
      });
    }
  }

  // TODO find a new home
  maybeShowNewTaskTypeModal() {
    // Users can aquire new tasks directly in the tracing view. Occasionally,
    // they start working on a new TaskType and need to be instructed.
    let text;
    const task = Store.getState().task;
    if (!Utils.getUrlParams("differentTaskType") || (task == null)) { return; }

    const taskType = task.type;
    const title = `Attention, new Task Type: ${taskType.summary}`;
    if (taskType.description) {
      text = `${messages["task.new_description"]}:<br>${taskType.description}`;
    } else {
      text = messages["task.no_description"];
    }
    Modal.show(text, title);
  }

  isWebGlSupported() {
    return window.WebGLRenderingContext && document.createElement("canvas").getContext("experimental-webgl");
  }

  initKeyboard() {
    // avoid scrolling while pressing space
    $(document).keydown((event: JQueryInputEventObject) => {
      if ((event.which === 32 || event.which === 18 || event.which >= 37 && event.which <= 40) && !$(":focus").length) { event.preventDefault(); }
    });

    const controlMode = Store.getState().temporaryConfiguration.controlMode;
    const keyboardControls = {};
    if (controlMode === ControlModeEnum.TRACE) {
      _.extend(keyboardControls, {
        // Set Mode, outcomment for release
        "shift + 1": () => Store.dispatch(setViewModeAction(constants.MODE_PLANE_TRACING)),
        "shift + 2": () => Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY)),
        "shift + 3": () => Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY_PLANE)),

        m: () => {
          // rotate allowed modes
          const currentViewMode = Store.getState().temporaryConfiguration.viewMode;
          const allowedModes = Store.getState().tracing.restrictions.allowedModes;
          const index = (allowedModes.indexOf(currentViewMode) + 1) % allowedModes.length;
          Store.dispatch(setViewModeAction(allowedModes[index]));
        },

        "super + s": (event) => {
          event.preventDefault();
          event.stopPropagation();
          Model.save();
        },

        "ctrl + s": (event) => {
          event.preventDefault();
          event.stopPropagation();
          Model.save();
        },

      });
    }

    this.keyboardNoLoop = new InputKeyboardNoLoop(keyboardControls);
  }

  maybeWarnAboutZoomStep() {
    const shouldWarn = Model.shouldDisplaySegmentationData() && !Model.canDisplaySegmentationData();
    if (shouldWarn && (this.zoomStepWarningToast == null)) {
      const toastType = Store.getState().tracing.type === "volume" ? "danger" : "info";
      this.zoomStepWarningToast = Toast.message(toastType,
        "Segmentation data and volume tracing is only fully supported at a smaller zoom level.", true);
    } else if (!shouldWarn && (this.zoomStepWarningToast != null)) {
      this.zoomStepWarningToast.remove();
      this.zoomStepWarningToast = null;
    }
  }

  updateStats = () => this.stats.update();

  render() {
    if (!this.state.ready) {
      return null;
    }
    const state = Store.getState();
    const allowedModes = Store.getState().tracing.restrictions.allowedModes;
    const mode = this.props.viewMode;

    if (!allowedModes.includes(mode)) {
      // Since this mode is not allowed, render nothing. A warning about this will be
      // triggered in the model. Don't throw an error since the store might change so that
      // the render function can succeed.
      return null;
    }

    const isArbitrary = constants.MODES_ARBITRARY.includes(mode);
    const isPlane = constants.MODES_PLANE.includes(mode);

    if (isArbitrary) {
      if (state.tracing.restrictions.advancedOptionsAllowed) {
        return <ArbitraryController onRender={this.updateStats} viewMode={mode} />;
      } else {
        return <MinimalSkeletonTracingArbitraryController onRender={this.updateStats} viewMode={mode} />;
      }
    } else if (isPlane) {
      switch (state.tracing.type) {
        case "volume": {
          return <VolumeTracingPlaneController onRender={this.updateStats} />;
        }
        case "skeleton": {
          return <SkeletonTracingPlaneController onRender={this.updateStats} />;
        }
        default: {
          return <PlaneController onRender={this.updateStats} />;
        }
      }
    } else {
      // At the moment, all possible view modes consist of the union of MODES_ARBITRARY and MODES_PLANE
      // In case we add new viewmodes, the following error will be thrown.
      throw new Error("The current mode is none of the four known mode types");
    }
  }
}

function mapStateToProps(state: OxalisState) {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
  };
}

export default connect(mapStateToProps)(Controller);
