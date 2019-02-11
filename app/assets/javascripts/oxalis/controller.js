/**
 * controller.js
 * @flow
 */

import { type RouterHistory, withRouter } from "react-router-dom";
import { Spin } from "antd";
import { connect } from "react-redux";
import BackboneEvents from "backbone-events-standalone";
import * as React from "react";
import Stats from "stats.js";
import _ from "lodash";

import { HANDLED_ERROR } from "oxalis/model_initialization";
import { InputKeyboardNoLoop, InputKeyboard } from "libs/input";
import { fetchGistContent } from "libs/gist";
import { saveNowAction, undoAction, redoAction } from "oxalis/model/actions/save_actions";
import { setViewModeAction, updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { wkReadyAction } from "oxalis/model/actions/actions";
import ApiLoader from "oxalis/api/api_loader";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";
import { initializeSceneController } from "oxalis/controller/scene_controller";
import Model from "oxalis/model";
import PlaneController from "oxalis/controller/viewmodes/plane_controller";
import Store, {
  type OxalisState,
  type TraceOrViewCommand,
  type AnnotationType,
} from "oxalis/store";
import Toast from "libs/toast";
import UrlManager from "oxalis/controller/url_manager";
import * as Utils from "libs/utils";
import api from "oxalis/api/internal_api";
import app from "app";
import constants, { ControlModeEnum, type ViewMode } from "oxalis/constants";
import messages from "messages";
import window, { document } from "libs/window";

type OwnProps = {|
  initialAnnotationType: AnnotationType,
  initialCommandType: TraceOrViewCommand,
|};
type StateProps = {|
  viewMode: ViewMode,
|};
type Props = {| ...OwnProps, ...StateProps |};
type PropsWithRouter = {| ...Props, history: RouterHistory |};

type State = {
  ready: boolean,
};

class Controller extends React.PureComponent<PropsWithRouter, State> {
  keyboard: InputKeyboard;
  keyboardNoLoop: InputKeyboardNoLoop;
  stats: Stats;

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
    _.extend(this, BackboneEvents);

    UrlManager.initialize();

    if (!this.isWebGlSupported()) {
      Toast.error(messages["webgl.disabled"]);
    }

    // Preview a working tracing version if the showVersionRestore URL parameter is supplied
    const versions = Utils.hasUrlParam("showVersionRestore") ? { skeleton: 1 } : undefined;

    Model.fetch(this.props.initialAnnotationType, this.props.initialCommandType, true, versions)
      .then(() => this.modelFetchDone())
      .catch(error => {
        // Don't throw errors for errors already handled by the model.
        if (error !== HANDLED_ERROR) {
          throw error;
        }
      });
  }

  modelFetchDone() {
    const beforeUnload = (evt, action) => {
      // Only show the prompt if this is a proper beforeUnload event from the browser
      // or the pathname changed
      // This check has to be done because history.block triggers this function even if only the url hash changed
      if (action === undefined || evt.pathname !== window.location.pathname) {
        const stateSaved = Model.stateSaved();
        if (!stateSaved && Store.getState().tracing.restrictions.allowUpdate) {
          Store.dispatch(saveNowAction());
          window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event
          window.setTimeout(() => {
            // restore the event handler in case a user chose to stay on the page
            window.onbeforeunload = beforeUnload;
          }, 500);
          return messages["save.leave_page_unfinished"];
        }
      }
      return null;
    };

    this.props.history.block(beforeUnload);
    window.onbeforeunload = beforeUnload;

    UrlManager.startUrlUpdater();
    initializeSceneController();

    // FPS stats
    this.stats = new Stats();
    document.body.append(this.stats.domElement);

    this.initKeyboard();
    this.initTaskScript();

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

  setLayoutScale(multiplier: number): void {
    let scale = Store.getState().userConfiguration.layoutScaleValue + 0.05 * multiplier;
    scale = Math.min(constants.MAX_LAYOUT_SCALE, scale);
    scale = Math.max(constants.MIN_LAYOUT_SCALE, scale);
    Store.dispatch(updateUserSettingAction("layoutScaleValue", scale));
  }

  isWebGlSupported() {
    return (
      window.WebGLRenderingContext &&
      document.createElement("canvas").getContext("experimental-webgl")
    );
  }

  initKeyboard() {
    // avoid scrolling while pressing space
    document.addEventListener("keydown", (event: KeyboardEvent) => {
      if (
        (event.which === 32 || event.which === 18 || (event.which >= 37 && event.which <= 40)) &&
        Utils.isNoElementFocussed()
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
      l: () => this.setLayoutScale(-1),
      k: () => this.setLayoutScale(1),
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
    const { allowedModes } = Store.getState().tracing.restrictions;
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
      return <ArbitraryController onRender={this.updateStats} viewMode={mode} />;
    } else if (isPlane) {
      return <PlaneController onRender={this.updateStats} />;
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

export default connect<Props, OwnProps, _, _, _, _>(mapStateToProps)(withRouter(Controller));
