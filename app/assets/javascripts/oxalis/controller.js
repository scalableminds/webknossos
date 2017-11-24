/**
 * controller.js
 * @flow
 */
/* globals JQueryInputEventObject:false */

import * as React from "react";
import { connect } from "react-redux";
import { withRouter } from "react-router-dom";
import { Spin } from "antd";
import $ from "jquery";
import _ from "lodash";
import app from "app";
import Utils from "libs/utils";
import Backbone from "backbone";
import Stats from "stats.js";
import { InputKeyboardNoLoop, InputKeyboard } from "libs/input";
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
import ApiLoader from "oxalis/api/api_loader";
import api from "oxalis/api/internal_api";
import { wkReadyAction } from "oxalis/model/actions/actions";
import { saveNowAction, undoAction, redoAction } from "oxalis/model/actions/save_actions";
import { setViewModeAction, updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import Model from "oxalis/model";
import Modal from "oxalis/view/modal";
import messages from "messages";
import { fetchGistContent } from "libs/gist";

import type { ModeType, ControlModeType } from "oxalis/constants";
import type { ReactRouterHistoryType } from "react_router";
import type { OxalisState, TracingTypeTracingType } from "oxalis/store";

type StateProps = {
  viewMode: ModeType,
};

type Props = {
  history: ReactRouterHistoryType,
  initialTracingType: TracingTypeTracingType,
  initialAnnotationId: string,
  initialControlmode: ControlModeType,
} & StateProps;

type State = {
  ready: boolean,
};

class Controller extends React.PureComponent<Props, State> {
  keyboard: InputKeyboard;
  keyboardNoLoop: InputKeyboardNoLoop;
  stats: Stats;

  // Copied from backbone events (TODO: handle this better)
  listenTo: Function;
  stopListening: Function;

  state = {
    ready: false,
  };

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
    _.extend(this, Backbone.Events);

    UrlManager.initialize();

    if (!this.isWebGlSupported()) {
      Toast.error(messages["webgl.disabled"]);
    }

    Model.fetch(
      this.props.initialTracingType,
      this.props.initialAnnotationId,
      this.props.initialControlmode,
      true,
    )
      .then(() => this.modelFetchDone())
      .catch(error => {
        // Don't throw errors for errors already handled by the model.
        if (error !== Model.HANDLED_ERROR) {
          throw error;
        }
      });
  }

  modelFetchDone() {
    this.props.history.block(() => {
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
      this.listenTo(Model.binary[binaryName].cube, "bucketLoaded", () =>
        app.vent.trigger("rerender"),
      );
    }

    window.webknossos = new ApiLoader(Model);

    app.vent.trigger("webknossos:ready");
    Store.dispatch(wkReadyAction());
    this.setState({ ready: true });
  }

  async initTaskScript() {
    // Loads a Gist from GitHub with a user script if there is a
    // script assigned to the task
    const task = Store.getState().task;
    if (task != null && task.script != null) {
      const script = task.script;
      const content = await fetchGistContent(script.gist, script.name);
      try {
        // eslint-disable-next-line no-eval
        eval(content);
      } catch (error) {
        console.error(error);
        Toast.error(
          `Error executing the task script "${script.name}". See console for more information.`,
        );
      }
    }
  }

  // TODO find a new home
  maybeShowNewTaskTypeModal() {
    // Users can aquire new tasks directly in the tracing view. Occasionally,
    // they start working on a new TaskType and need to be instructed.
    let text;
    const task = Store.getState().task;
    if (!Utils.hasUrlParam("differentTaskType") || task == null) {
      return;
    }

    const taskType = task.type;
    const title = `Attention, new Task Type: ${taskType.summary}`;
    if (taskType.description) {
      text = `${messages["task.new_description"]}:<br>${taskType.description}`;
    } else {
      text = messages["task.no_description"];
    }
    Modal.show(text, title);
  }

  scaleTrianglesPlane(delta: number): void {
    let scale = Store.getState().userConfiguration.scale + delta;
    scale = Math.min(constants.MAX_SCALE, scale);
    scale = Math.max(constants.MIN_SCALE, scale);

    Store.dispatch(updateUserSettingAction("scale", scale));
  }

  isWebGlSupported() {
    return (
      window.WebGLRenderingContext &&
      document.createElement("canvas").getContext("experimental-webgl")
    );
  }

  initKeyboard() {
    // avoid scrolling while pressing space
    $(document).keydown((event: JQueryInputEventObject) => {
      if (
        (event.which === 32 || event.which === 18 || (event.which >= 37 && event.which <= 40)) &&
        !$(":focus").length
      ) {
        event.preventDefault();
      }
    });

    const controlMode = Store.getState().temporaryConfiguration.controlMode;
    const keyboardControls = {};
    let prevSegAlpha = 20;
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

        "super + s": event => {
          event.preventDefault();
          event.stopPropagation();
          Model.save();
        },

        "ctrl + s": event => {
          event.preventDefault();
          event.stopPropagation();
          Model.save();
        },

        // Undo
        "super + z": event => {
          event.preventDefault();
          event.stopPropagation();
          Store.dispatch(undoAction());
        },
        "ctrl + z": () => Store.dispatch(undoAction()),

        // Redo
        "super + y": event => {
          event.preventDefault();
          event.stopPropagation();
          Store.dispatch(redoAction());
        },
        "ctrl + y": () => Store.dispatch(redoAction()),
      });
    }

    _.extend(keyboardControls, {
      // In the long run this should probably live in a user script
      "3": function toggleSegmentationOpacity() {
        // Flow cannot infer the return type of getConfiguration :(
        // Should be fixed once this is fixed: https://github.com/facebook/flow/issues/4513
        const curSegAlpha = Number(api.data.getConfiguration("segmentationOpacity"));
        let newSegAlpha = 0;

        if (curSegAlpha > 0) {
          prevSegAlpha = curSegAlpha;
        } else {
          newSegAlpha = prevSegAlpha;
        }

        api.data.setConfiguration("segmentationOpacity", newSegAlpha);
      },
    });

    this.keyboardNoLoop = new InputKeyboardNoLoop(keyboardControls);

    this.keyboard = new InputKeyboard({
      // Scale planes
      l: timeFactor => {
        const scaleValue = Store.getState().userConfiguration.scaleValue;
        this.scaleTrianglesPlane(-scaleValue * timeFactor);
      },

      k: timeFactor => {
        const scaleValue = Store.getState().userConfiguration.scaleValue;
        this.scaleTrianglesPlane(scaleValue * timeFactor);
      },
    });
  }

  updateStats = () => this.stats.update();

  render() {
    if (!this.state.ready) {
      return (
        <Spin
          spinning
          size="large"
          style={{
            position: "fixed",
            top: "64px",
            left: "0px",
            right: "0px",
            bottom: "0px",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            zIndex: 1000,
          }}
        />
      );
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
        return (
          <MinimalSkeletonTracingArbitraryController onRender={this.updateStats} viewMode={mode} />
        );
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

function mapStateToProps(state: OxalisState): StateProps {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
  };
}

export default withRouter(connect(mapStateToProps)(Controller));
