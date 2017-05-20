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
import Model from "oxalis/model";
import Store from "oxalis/store";
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
import View from "oxalis/view";
import SkeletonTracingView from "oxalis/view/skeletontracing_view";
import VolumeTracingView from "oxalis/view/volumetracing_view";
import constants from "oxalis/constants";
import Request from "libs/request";
import { wkReadyAction } from "oxalis/model/actions/actions";
import { saveNowAction } from "oxalis/model/actions/save_actions";
import messages from "messages";

import type { ToastType } from "libs/toast";
import type { ModeType } from "oxalis/constants";

class Controller {

  model: Model;
  urlManager: UrlManager;
  sceneController: SceneController;
  view: View;
  annotationController: SkeletonTracingController | VolumeTracingController;
  planeController: PlaneController;
  arbitraryController: ArbitraryController;
  zoomStepWarningToast: ToastType;
  keyboardNoLoop: InputKeyboardNoLoop;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;

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

  constructor(options: Object) {
    app.router.showLoadingSpinner();
    this.model = options.model;

    _.extend(this, Backbone.Events);

    this.urlManager = new UrlManager(this.model);
    this.model.set("state", this.urlManager.initialState);

    this.model.fetch()
        .then(() => this.modelFetchDone());
        // .catch((error) => {
        //   // Don't throw errors for errors already handled by the model.
        //   if (error !== this.model.HANDLED_ERROR) {
        //     throw error;
        //   }
        // },
        // );
  }


  modelFetchDone() {
    if (!this.model.tracing.restrictions.allowAccess) {
      Toast.Error("You are not allowed to access this tracing");
      return;
    }

    app.router.on("beforeunload", () => {
      if (this.model.get("controlMode") === constants.CONTROL_MODE_TRACE) {
        const state = Store.getState();
        const stateSaved = this.model.stateSaved();
        if (!stateSaved && state.tracing.restrictions.allowUpdate) {
          Store.dispatch(saveNowAction());
          return messages["save.leave_page_unfinished"];
        }
      }
      return null;
    });

    this.urlManager.startUrlUpdater();

    this.sceneController = new SceneController(this.model);

    // TODO: Replace with skeletonTracing from Store (which is non-null currently)
    if (this.model.get("controlMode") === constants.CONTROL_MODE_TRACE) {
      if (this.model.isVolumeTracing()) {
        // VOLUME MODE
        this.view = new VolumeTracingView(this.model);
        this.annotationController = new VolumeTracingController(
          this.model, this.view, this.sceneController);
        this.planeController = new VolumeTracingPlaneController(
          this.model, this.view, this.sceneController, this.annotationController);
      } else {
        // SKELETONRACING MODE
        this.view = new SkeletonTracingView(this.model);
        this.annotationController = new SkeletonTracingController(
          this.model, this.view, this.sceneController);
        this.planeController = new SkeletonTracingPlaneController(
          this.model, this.view, this.sceneController, this.annotationController);

        const ArbitraryControllerClass = this.model.tracing.content.settings.advancedOptionsAllowed ? SkeletonTracingArbitraryController : MinimalSkeletonTracingArbitraryController;
        this.arbitraryController = new ArbitraryControllerClass(
          this.model, this.view, this.sceneController, this.annotationController);
      }
    } else {
      // VIEW MODE
      this.view = new View(this.model);
      this.planeController = new PlaneController(
        this.model, this.view, this.sceneController);
    }

    // FPS stats
    const stats = new Stats();
    $("body").append(stats.domElement);
    if (this.arbitraryController) { this.listenTo(this.arbitraryController.arbitraryView, "render", () => stats.update()); }
    this.listenTo(this.planeController.planeView, "render", () => stats.update());

    this.initKeyboard();
    this.initTimeLimit();
    this.initTaskScript();

    for (const binaryName of Object.keys(this.model.binary)) {
      this.listenTo(this.model.binary[binaryName].cube, "bucketLoaded", () => app.vent.trigger("rerender"));
    }


    this.listenTo(this.model, "change:mode", this.loadMode);
    this.loadMode(this.model.get("mode"));


    // Zoom step warning
    this.zoomStepWarningToast = null;
    let lastZoomStep = Store.getState().flycam.zoomStep;
    Store.subscribe(() => {
      const { zoomStep } = Store.getState().flycam;
      if (lastZoomStep !== zoomStep) {
        this.onZoomStepChange();
        lastZoomStep = zoomStep;
      }
    });
    this.onZoomStepChange();

    app.router.hideLoadingSpinner();
    app.vent.trigger("webknossos:ready");
    Store.dispatch(wkReadyAction());
  }

  initTaskScript() {
    // Loads a Gist from GitHub with a user script if there is a
    // script assigned to the task
    if (this.model.tracing.task && this.model.tracing.task.script) {
      const script = this.model.tracing.task.script;
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
          Toast.error(`Unable to retrieve script ${script.name}`);
        }
      });
    }
  }

  initKeyboard() {
    // avoid scrolling while pressing space
    $(document).keydown((event) => {
      if ((event.which === 32 || event.which === 18 || event.which >= 37 && event.which <= 40) && !$(":focus").length) { event.preventDefault(); }
    });

    const keyboardControls = {};

    if (this.model.get("controlMode") === constants.CONTROL_MODE_TRACE) {
      _.extend(keyboardControls, {
        // Set Mode, outcomment for release
        "shift + 1": () => this.model.setMode(constants.MODE_PLANE_TRACING),
        "shift + 2": () => this.model.setMode(constants.MODE_ARBITRARY),
        "shift + 3": () => this.model.setMode(constants.MODE_ARBITRARY_PLANE),

        t: () => this.view.toggleTheme(),

        m: () => {
          // rotate allowed modes
          const index = (this.model.allowedModes.indexOf(this.model.get("mode")) + 1) % this.model.allowedModes.length;
          this.model.setMode(this.model.allowedModes[index]);
        },

        "super + s": (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.model.save();
        },

        "ctrl + s": (event) => {
          event.preventDefault();
          event.stopPropagation();
          this.model.save();
        },

      });
    }

    this.keyboardNoLoop = new InputKeyboardNoLoop(keyboardControls);
  }


  loadMode(newMode: ModeType, force: boolean = false) {
    if ((newMode === constants.MODE_ARBITRARY || newMode === constants.MODE_ARBITRARY_PLANE) && (this.model.allowedModes.includes(newMode) || force)) {
      Utils.__guard__(this.planeController, x => x.stop());
      this.arbitraryController.start(newMode);
    } else if ((newMode === constants.MODE_PLANE_TRACING || newMode === constants.MODE_VOLUME) && (this.model.allowedModes.includes(newMode) || force)) {
      Utils.__guard__(this.arbitraryController, x1 => x1.stop());
      this.planeController.start(newMode);
    }
  }


  initTimeLimit() {
    // only enable hard time limit for anonymous users so far
    if (!this.model.tracing.task || !this.model.tracing.user.isAnonymous) {
      return;
    }

    // TODO move that somewhere else
    const finishTracing = async () => {
      // save the progress
      await this.model.save();
      const url = `/annotations/${this.model.tracingType}/${this.model.tracingId}/finishAndRedirect`;
      app.router.loadURL(url);
    };

    // parse hard time limit and convert from min to ms
    const { expectedTime } = this.model.tracing.task.type;
    let timeLimit = (expectedTime.maxHard * 60 * 1000) || 0;

    // setTimeout uses signed 32-bit integers, an overflow would cause immediate timeout execution
    if (timeLimit >= Math.pow(2, 32) / 2) {
      Toast.error("Time limit was reduced as it cannot be bigger than 35791 minutes.");
      timeLimit = (Math.pow(2, 32) / 2) - 1;
    }
    console.log(`TimeLimit is ${timeLimit / 60 / 1000} min`);

    if (timeLimit) {
      setTimeout(() => {
        window.alert("Time limit is reached, thanks for tracing!");
        finishTracing();
      }
      , timeLimit);
    }
  }

  onZoomStepChange() {
    const shouldWarn = !this.model.canDisplaySegmentationData();
    if (shouldWarn && (this.zoomStepWarningToast == null)) {
      const toastType = this.model.isVolumeTracing() ? "danger" : "info";
      this.zoomStepWarningToast = Toast.message(toastType,
        "Segmentation data and volume tracing is only fully supported at a smaller zoom level.", true);
    } else if (!shouldWarn && (this.zoomStepWarningToast != null)) {
      this.zoomStepWarningToast.remove();
      this.zoomStepWarningToast = null;
    }
  }
}


export default Controller;
