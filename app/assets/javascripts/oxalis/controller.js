/**
 * controller.js
 * @flow
 */

import $ from "jquery";
import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import Backbone from "backbone";
import Stats from "stats.js";
import { InputKeyboardNoLoop } from "libs/input";
import Toast from "libs/toast";
import Store from "oxalis/store";
import View from "oxalis/view";
import PlaneController from "oxalis/controller/viewmodes/plane_controller";
import SkeletonTracingController from "oxalis/controller/annotations/skeletontracing_controller";
import VolumeTracingController from "oxalis/controller/annotations/volumetracing_controller";
import SkeletonTracingArbitraryController from "oxalis/controller/combinations/skeletontracing_arbitrary_controller";
import SkeletonTracingPlaneController from "oxalis/controller/combinations/skeletontracing_plane_controller";
import VolumeTracingPlaneController from "oxalis/controller/combinations/volumetracing_plane_controller";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";
import MinimalSkeletonTracingArbitraryController from "oxalis/controller/combinations/minimal_skeletontracing_arbitrary_controller";
import SceneController from "oxalis/controller/scene_controller";
import UrlManager from "oxalis/controller/url_manager";
import constants, { ControlModeEnum } from "oxalis/constants";
import Request from "libs/request";
import OxalisApi from "oxalis/api/api_loader";
import { wkReadyAction, restartSagaAction } from "oxalis/model/actions/actions";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import { setViewModeAction } from "oxalis/model/actions/settings_actions";
import { listenToStoreProperty } from "oxalis/model/helpers/listener_helpers";
import Model from "oxalis/model";
import Modal from "oxalis/view/modal";
import messages from "messages";

import type { ToastType } from "libs/toast";
import type { ModeType, ControlModeType } from "oxalis/constants";
import type { SkeletonTracingTypeTracingType } from "oxalis/store";

class Controller {
  sceneController: SceneController;
  annotationController: SkeletonTracingController | VolumeTracingController;
  planeController: PlaneController;
  arbitraryController: ArbitraryController;
  zoomStepWarningToast: ToastType;
  keyboardNoLoop: InputKeyboardNoLoop;
  view: View;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  stopListening: Function;

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

  constructor(tracingType: SkeletonTracingTypeTracingType, tracingId: string, controlMode: ControlModeType) {
    app.router.showLoadingSpinner();

    _.extend(this, Backbone.Events);

    UrlManager.initialize();

    Model.fetch(tracingType, tracingId, controlMode, true)
      .then(() => this.modelFetchDone())
      .catch((error) => {
        // Don't throw errors for errors already handled by the model.
        if (error !== Model.HANDLED_ERROR) {
          throw error;
        }
      });
  }

  modelFetchDone() {
    const state = Store.getState();
    app.router.on("beforeunload", () => {
      const stateSaved = Model.stateSaved();
      if (!stateSaved && Store.getState().tracing.restrictions.allowUpdate) {
        Store.dispatch(saveNowAction());
        return messages["save.leave_page_unfinished"];
      }
      return null;
    });

    UrlManager.startUrlUpdater();

    this.view = new View();
    this.sceneController = new SceneController();
    switch (state.tracing.type) {
      case "volume": {
        this.annotationController = new VolumeTracingController(
          this.view, this.sceneController);
        this.planeController = new VolumeTracingPlaneController(
          this.view, this.sceneController, this.annotationController);
        break;
      }
      case "skeleton": {
        this.annotationController = new SkeletonTracingController(
          this.view, this.sceneController);
        this.planeController = new SkeletonTracingPlaneController(
          this.view, this.sceneController, this.annotationController);
        const ArbitraryControllerClass = state.tracing.restrictions.advancedOptionsAllowed ?
          SkeletonTracingArbitraryController :
          MinimalSkeletonTracingArbitraryController;
        this.arbitraryController = new ArbitraryControllerClass(
          this.view, this.sceneController, this.annotationController);
        break;
      }
      default: {
        this.planeController = new PlaneController(
          this.view, this.sceneController);
        break;
      }
    }

    // FPS stats
    const stats = new Stats();
    $("body").append(stats.domElement);
    if (this.arbitraryController) { this.listenTo(this.arbitraryController.arbitraryView, "render", () => stats.update()); }
    this.listenTo(this.planeController.planeView, "render", () => stats.update());

    this.initKeyboard();
    this.initTaskScript();
    this.maybeShowNewTaskTypeModal();

    for (const binaryName of Object.keys(Model.binary)) {
      this.listenTo(Model.binary[binaryName].cube, "bucketLoaded", () => app.vent.trigger("rerender"));
    }

    listenToStoreProperty(store => store.temporaryConfiguration.viewMode, mode => this.loadMode(mode), true);

    // Zoom step warning
    let lastZoomStep = Store.getState().flycam.zoomStep;
    Store.subscribe(() => {
      const { zoomStep } = Store.getState().flycam;
      if (lastZoomStep !== zoomStep) {
        this.onZoomStepChange();
        lastZoomStep = zoomStep;
      }
    });
    this.onZoomStepChange();

    window.webknossos = new OxalisApi(Model);

    app.router.hideLoadingSpinner();
    app.vent.trigger("webknossos:ready");
    Store.dispatch(wkReadyAction());
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


  initKeyboard() {
    // avoid scrolling while pressing space
    $(document).keydown((event) => {
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

        t: () => this.view.toggleTheme(),

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


  loadMode(newMode: ModeType) {
    const allowedModes = Store.getState().tracing.restrictions.allowedModes;
    if (
      (newMode === constants.MODE_ARBITRARY || newMode === constants.MODE_ARBITRARY_PLANE) &&
      allowedModes.includes(newMode)
    ) {
      Utils.__guard__(this.planeController, x => x.stop());
      this.arbitraryController.start(newMode);
    } else if (
      (newMode === constants.MODE_PLANE_TRACING || newMode === constants.MODE_VOLUME) &&
      allowedModes.includes(newMode)
    ) {
      Utils.__guard__(this.arbitraryController, x1 => x1.stop());
      this.planeController.start(newMode);
    }

    // Hide/show zoomstep warning if appropriate
    this.onZoomStepChange();
  }

  onZoomStepChange() {
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
}


export default Controller;
