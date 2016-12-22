import $ from "jquery";
import _ from "lodash";
import app from "app";
import Backbone from "backbone";
import Stats from "stats.js";
import PlaneController from "./controller/viewmodes/plane_controller";
import SkeletonTracingController from "./controller/annotations/skeletontracing_controller";
import VolumeTracingController from "./controller/annotations/volumetracing_controller";
import SkeletonTracingArbitraryController from "./controller/combinations/skeletontracing_arbitrary_controller";
import SkeletonTracingPlaneController from "./controller/combinations/skeletontracing_plane_controller";
import VolumeTracingPlaneController from "./controller/combinations/volumetracing_plane_controller";
import MinimalArbitraryController from "./controller/combinations/minimal_skeletontracing_arbitrary_controller";
import SceneController from "./controller/scene_controller";
import UrlManager from "./controller/url_manager";
import Model from "./model";
import View from "./view";
import SkeletonTracingView from "./view/skeletontracing/skeletontracing_view";
import VolumeTracingView from "./view/volumetracing/volumetracing_view";
import constants from "./constants";
import Input from "../libs/input";
import Toast from "../libs/toast";

class Controller {

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

  constructor(options) {
    this.model = options.model;

    _.extend(this, {
      view : null,
      planeController : null,
      arbitraryController : null
    }
    );

    _.extend(this, Backbone.Events);

    this.fullScreen = false;

    this.urlManager = new UrlManager(this.model);
    this.model.set("state", this.urlManager.initialState);

    this.model.fetch()
        .then( () => this.modelFetchDone())
        .catch( error => {
          // Don't throw errors for errors already handled by the model.
          if (error !== this.model.HANDLED_ERROR) {
            throw error;
          }
        }
        );
  }


  modelFetchDone() {

    if (!this.model.tracing.restrictions.allowAccess) {
      Toast.Error("You are not allowed to access this tracing");
      return;
    }

    app.router.on("beforeunload", () => {
      if (this.model.get("controlMode") === constants.CONTROL_MODE_TRACE) {
        const { stateLogger } = this.model.annotationModel;
        if (!stateLogger.stateSaved() && stateLogger.allowUpdate) {
          stateLogger.pushNow();
          return "You haven't saved your progress, please give us 2 seconds to do so and and then leave this site.";
        }
      }
    }
    );

    this.urlManager.startUrlUpdater();

    this.sceneController = new SceneController(
      this.model.upperBoundary, this.model.flycam, this.model);


    if (this.model.skeletonTracing != null) {

      this.view = new SkeletonTracingView(this.model);
      this.annotationController = new SkeletonTracingController(
        this.model, this.view, this.sceneController);
      this.planeController = new SkeletonTracingPlaneController(
        this.model, this.view, this.sceneController, this.annotationController);

      const ArbitraryController = this.model.tracing.content.settings.advancedOptionsAllowed ? SkeletonTracingArbitraryController : MinimalArbitraryController;
      this.arbitraryController = new ArbitraryController(
        this.model, this.view, this.sceneController, this.annotationController);

    } else if (this.model.volumeTracing != null) {

      this.view = new VolumeTracingView(this.model);
      this.annotationController = new VolumeTracingController(
        this.model, this.view, this.sceneController);
      this.planeController = new VolumeTracingPlaneController(
        this.model, this.view, this.sceneController, this.annotationController);

    } else { // View mode

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

    for (let binaryName in this.model.binary) {
      this.listenTo(this.model.binary[binaryName].cube, "bucketLoaded", () => app.vent.trigger("rerender"));
    }


    this.listenTo(this.model, "change:mode", this.loadMode);
    this.loadMode(this.model.get("mode"));


    // Zoom step warning
    this.zoomStepWarningToast = null;
    return this.model.flycam.on({
      zoomStepChanged : () => {
        const shouldWarn = !this.model.canDisplaySegmentationData();
        if (shouldWarn && (this.zoomStepWarningToast == null)) {
          const toastType = (this.model.volumeTracing != null) ? "danger" : "info";
          return this.zoomStepWarningToast = Toast.message(toastType,
            "Segmentation data is only fully supported at a smaller zoom level.", true);
        } else if (!shouldWarn && (this.zoomStepWarningToast != null)) {
          this.zoomStepWarningToast.remove();
          return this.zoomStepWarningToast = null;
        }
      }
    });
  }


  initKeyboard() {

    // avoid scrolling while pressing space
    $(document).keydown(function(event) {
      if ((event.which === 32 || event.which === 18 || 37 <= event.which && event.which <= 40) && !$(":focus").length) { event.preventDefault(); }
    });

    const keyboardControls = {};

    if (this.model.get("controlMode") === constants.CONTROL_MODE_TRACE) {
      _.extend( keyboardControls, {
        //Set Mode, outcomment for release
        "shift + 1" : () => {
          return this.model.setMode(constants.MODE_PLANE_TRACING);
        },
        "shift + 2" : () => {
          return this.model.setMode(constants.MODE_ARBITRARY);
        },
        "shift + 3" : () => {
          return this.model.setMode(constants.MODE_ARBITRARY_PLANE);
        },

        "t" : () => {
          return this.view.toggleTheme();
        },

        "m" : () => { // rotate allowed modes

          const index = (this.model.allowedModes.indexOf(this.model.get("mode")) + 1) % this.model.allowedModes.length;
          return this.model.setMode(this.model.allowedModes[index]);
        },

        "super + s" : event => {
          event.preventDefault();
          event.stopPropagation();
          return this.model.save();
        },

        "ctrl + s" : event => {
          event.preventDefault();
          event.stopPropagation();
          return this.model.save();
        }

      } );
    }

    return new Input.KeyboardNoLoop( keyboardControls );
  }


  loadMode(newMode, force) {

    if (force == null) { force = false; }
    if ((newMode === constants.MODE_ARBITRARY || newMode === constants.MODE_ARBITRARY_PLANE) && (this.model.allowedModes.includes(newMode) || force)) {
      __guard__(this.planeController, x => x.stop());
      return this.arbitraryController.start(newMode);

    } else if ((newMode === constants.MODE_PLANE_TRACING || newMode === constants.MODE_VOLUME) && (this.model.allowedModes.includes(newMode) || force)) {
      __guard__(this.arbitraryController, x1 => x1.stop());
      return this.planeController.start(newMode);

    } else { // newMode not allowed or invalid
      return;
    }
  }


  initTimeLimit() {

    // only enable hard time limit for anonymous users so far
    let model;
    if (!this.model.tracing.task || !this.model.tracing.user.isAnonymous) {
      return;
    }

    // TODO move that somehwere else
    const finishTracing = () => {
      // save the progress
      model = this.model;

      const tracingType = model.skeletonTracing || model.volumeTracing;
      return tracingType.stateLogger.pushNow().then( function() {
        const url = `/annotations/${model.tracingType}/${model.tracingId}/finishAndRedirect`;
        return app.router.loadURL(url);
      });
    };

    // parse hard time limit and convert from min to ms
    const { expectedTime } = this.model.tracing.task.type;
    let timeLimit = (expectedTime.maxHard * 60 * 1000) || 0;

    // setTimeout uses signed 32-bit integers, an overflow would cause immediate timeout execution
    if (timeLimit >= Math.pow(2, 32) / 2) {
      Toast.error("Time limit was reduced as it cannot be bigger than 35791 minutes.");
      timeLimit = (Math.pow(2, 32) / 2) - 1;
    }
    console.log(`TimeLimit is ${timeLimit/60/1000} min`);

    if (timeLimit) {
      return setTimeout( function() {
        window.alert("Time limit is reached, thanks for tracing!");
        return finishTracing();
      }
      , timeLimit);
    }
  }
}


export default Controller;

function __guard__(value, transform) {
  return (typeof value !== 'undefined' && value !== null) ? transform(value) : undefined;
}
