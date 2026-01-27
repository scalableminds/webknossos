import app from "app";
import BrainSpinner, { BrainSpinnerWithError, CoverWithLogin } from "components/brain_spinner";
import { fetchGistContent } from "libs/gist";
import { InputKeyboardNoLoop } from "libs/input";
import Toast from "libs/toast";
import { getUrlParamValue, hasUrlParam, isNoElementFocused } from "libs/utils";
import window, { document } from "libs/window";
import { type WithBlockerProps, withBlocker } from "libs/with_blocker_hoc";
import { type RouteComponentProps, withRouter } from "libs/with_router_hoc";
import extend from "lodash-es/extend";
import messages from "messages";
import { PureComponent } from "react";
import { connect } from "react-redux";
import type { BlockerFunction } from "react-router-dom";
import { APIAnnotationTypeEnum, type APICompoundType } from "types/api_types";
import type { APIOrganization, APIUser } from "types/api_types";
import ApiLoader from "viewer/api/api_loader";
import type { ViewMode } from "viewer/constants";
import constants, { ControlModeEnum } from "viewer/constants";
import { initializeSceneController } from "viewer/controller/scene_controller";
import UrlManager from "viewer/controller/url_manager";
import ArbitraryController from "viewer/controller/viewmodes/arbitrary_controller";
import PlaneController from "viewer/controller/viewmodes/plane_controller";
import { AnnotationTool } from "viewer/model/accessors/tool_accessor";
import { wkInitializedAction } from "viewer/model/actions/actions";
import { redoAction, saveNowAction, undoAction } from "viewer/model/actions/save_actions";
import { setViewModeAction, updateLayerSettingAction } from "viewer/model/actions/settings_actions";
import { setIsInAnnotationViewAction } from "viewer/model/actions/ui_actions";
import { HANDLED_ERROR } from "viewer/model_initialization";
import { Model } from "viewer/singletons";
import type { TraceOrViewCommand, WebknossosState } from "viewer/store";
import Store from "viewer/store";
import type DataLayer from "./model/data_layer";

export type ControllerStatus = "loading" | "loaded" | "failedLoading";
type OwnProps = {
  initialMaybeCompoundType: APICompoundType | null;
  initialCommandType: TraceOrViewCommand;
  controllerStatus: ControllerStatus;
  setControllerStatus: (arg0: ControllerStatus) => void;
};
type StateProps = {
  viewMode: ViewMode;
  user: APIUser | null | undefined;
  isUiReady: boolean;
  isWkInitialized: boolean;
};
type Props = OwnProps & StateProps;
type PropsWithRouter = Props & RouteComponentProps & WithBlockerProps;
type State = {
  gotUnhandledError: boolean;
  organizationToSwitchTo: APIOrganization | null | undefined;
};

class Controller extends PureComponent<PropsWithRouter, State> {
  keyboardNoLoop?: InputKeyboardNoLoop;
  _isMounted: boolean = false;
  state: State = {
    gotUnhandledError: false,
    organizationToSwitchTo: null,
  };

  // Main controller, responsible for setting modes and everything
  // that has to be controlled in any mode.
  //
  // We have a matrix of modes like this:
  //
  //   Annotation Mode \ View mode       Plane       Arbitrary
  //              Skeleton annotation      X             X
  //                Volume annotation      X             /
  //
  // In order to maximize code reuse, there is - besides the main
  // controller - a controller for each row, each column and each
  // cross in this matrix.
  componentDidMount() {
    this._isMounted = true;
    Store.dispatch(setIsInAnnotationViewAction(true));
    UrlManager.initialize();

    if (!this.isWebGlSupported()) {
      Toast.error(messages["webgl.disabled"]);
    }

    this.tryFetchingModel();
  }

  componentWillUnmount() {
    this._isMounted = false;
    this.keyboardNoLoop?.destroy();
    Store.dispatch(setIsInAnnotationViewAction(false));
    this.props.setBlocking({
      shouldBlock: false,
    });
  }

  tryFetchingModel() {
    this.props.setControllerStatus("loading");
    // Preview a working annotation version if the showVersionRestore URL parameter is supplied
    const version = hasUrlParam("showVersionRestore")
      ? hasUrlParam("version")
        ? Number.parseInt(getUrlParamValue("version"))
        : 1
      : undefined;
    Model.fetch(this.props.initialMaybeCompoundType, this.props.initialCommandType, true, version)
      .then(() => this.modelFetchDone())
      .catch((error) => {
        this.props.setControllerStatus("failedLoading");
        const isNotFoundError = error.status === 404;

        if (
          this.props.initialMaybeCompoundType === APIAnnotationTypeEnum.CompoundProject &&
          isNotFoundError
        ) {
          Toast.error(messages["tracing.compound_project_not_found"], {
            sticky: true,
          });
        }

        if (error.organizationToSwitchTo != null && this.props.user != null) {
          this.setState({
            organizationToSwitchTo: error.organizationToSwitchTo,
          });
        }

        if (error !== HANDLED_ERROR && !isNotFoundError) {
          // Don't throw errors for errors already handled by the model
          // or "Not Found" errors because they are already handled elsewhere.
          Toast.error(`${messages["tracing.unhandled_initialization_error"]} ${error.toString()}`, {
            sticky: true,
          });
          this.setState({
            gotUnhandledError: true,
          });
          throw error;
        }
      });
  }

  modelFetchDone() {
    const beforeUnload = (args: BeforeUnloadEvent | BlockerFunction): boolean | undefined => {
      // Navigation blocking can be triggered by two sources:
      // 1. The browser's native beforeunload event
      // 2. The React-Router block function (useBlocker or withBlocker HOC)

      if (!Model.stateSaved() && Store.getState().annotation.restrictions.allowUpdate) {
        window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event

        setTimeout(() => {
          if (!this._isMounted) {
            return false;
          }

          Store.dispatch(saveNowAction());
          // restore the event handler in case a user chose to stay on the page
          window.onbeforeunload = beforeUnload;
        }, 500);

        // The native event requires a truthy return value to show a generic message
        // The React Router blocker accepts a boolean
        return "preventDefault" in args ? true : !confirm(messages["save.leave_page_unfinished"]);
      }

      // The native event requires an empty return value to not show a message
      return;
    };

    window.onbeforeunload = beforeUnload;
    this.props.setBlocking({
      // @ts-expect-error beforeUnload signature is overloaded
      shouldBlock: beforeUnload,
    });

    UrlManager.startUrlUpdater();
    initializeSceneController();
    this.initKeyboard();
    this.initTaskScript();
    window.webknossos = new ApiLoader(Model);
    app.vent.emit("webknossos:initialized");
    Store.dispatch(wkInitializedAction());
    this.props.setControllerStatus("loaded");
  }

  async initTaskScript() {
    // Loads a Gist from GitHub with a user script if there is a
    // script assigned to the task
    const { task } = Store.getState();

    if (task?.script != null) {
      const { script } = task;
      const content = await fetchGistContent(script.gist, script.name);

      try {
        // biome-ignore lint/security/noGlobalEval: This loads a user provided frontend API script.
        eval(content);
      } catch (error) {
        Toast.error(
          `Error executing the task script "${script.name}". See console for more information.`,
        );
        console.error(error);
      }
    }
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
        isNoElementFocused()
      ) {
        event.preventDefault();
      }
    });
    const { controlMode } = Store.getState().temporaryConfiguration;
    const keyboardControls = {};

    if (controlMode !== ControlModeEnum.VIEW) {
      extend(keyboardControls, {
        // Set Mode, outcomment for release
        "shift + 1": () => Store.dispatch(setViewModeAction(constants.MODE_PLANE_TRACING)),
        "shift + 2": () => Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY)),
        "shift + 3": () => Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY_PLANE)),
        m: () => {
          // rotate allowed modes
          const state = Store.getState();
          const isProofreadingActive = state.uiInformation.activeTool === AnnotationTool.PROOFREAD;
          const currentViewMode = state.temporaryConfiguration.viewMode;
          if (isProofreadingActive && currentViewMode === constants.MODE_PLANE_TRACING) {
            // Skipping cycling view mode as m in proofreading is used to toggle multi cut tool.
            return;
          }
          const { allowedModes } = state.annotation.restrictions;
          const index = (allowedModes.indexOf(currentViewMode) + 1) % allowedModes.length;
          Store.dispatch(setViewModeAction(allowedModes[index]));
        },
        "super + s": (event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();
          Model.forceSave();
        },
        "ctrl + s": (event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();
          Model.forceSave();
        },
        // Undo
        "super + z": (event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();
          Store.dispatch(undoAction());
        },
        "ctrl + z": () => Store.dispatch(undoAction()),
        // Redo
        "super + y": (event: KeyboardEvent) => {
          event.preventDefault();
          event.stopPropagation();
          Store.dispatch(redoAction());
        },
        "ctrl + y": () => Store.dispatch(redoAction()),
      });
    }

    let leastRecentlyUsedSegmentationLayer: DataLayer | null = null;

    extend(keyboardControls, {
      // In the long run this should probably live in a user script
      "3": function toggleSegmentationOpacity() {
        let segmentationLayer = Model.getVisibleSegmentationLayer();

        if (segmentationLayer != null) {
          // If there is a visible segmentation layer, disable and remember it.
          leastRecentlyUsedSegmentationLayer = segmentationLayer;
        } else if (leastRecentlyUsedSegmentationLayer != null) {
          // If no segmentation layer is visible, use the least recently toggled
          // layer (note that toggling the layer via the switch-button won't update
          // the local variable here).
          segmentationLayer = leastRecentlyUsedSegmentationLayer;
        } else {
          // As a fallback, simply use some segmentation layer
          segmentationLayer = Model.getSomeSegmentationLayer();
        }

        if (segmentationLayer == null) {
          return;
        }

        const segmentationLayerName = segmentationLayer.name;
        const isSegmentationDisabled =
          Store.getState().datasetConfiguration.layers[segmentationLayerName].isDisabled;
        Store.dispatch(
          updateLayerSettingAction(segmentationLayerName, "isDisabled", !isSegmentationDisabled),
        );
      },
    });

    this.keyboardNoLoop = new InputKeyboardNoLoop(keyboardControls);
  }

  render() {
    const status = this.props.controllerStatus;
    const { user, viewMode, isUiReady, isWkInitialized } = this.props;
    const { gotUnhandledError, organizationToSwitchTo } = this.state;

    let cover = null;
    // Show the brain spinner during loading and until the UI is ready
    if (status === "loading" || (status === "loaded" && !isUiReady)) {
      cover = <BrainSpinner />;
    } else if (status === "failedLoading" && user != null) {
      cover = (
        <BrainSpinnerWithError
          gotUnhandledError={gotUnhandledError}
          organizationToSwitchTo={organizationToSwitchTo}
        />
      );
    } else if (status === "failedLoading") {
      cover = (
        <CoverWithLogin
          onLoggedIn={() => {
            // Close existing error toasts for "Not Found" errors before trying again.
            // If they get relevant again, they will be recreated anyway.
            Toast.close("404");
            this.tryFetchingModel();
          }}
        />
      );
    }

    // If wk is not initialized yet, only render the cover. If it is initialized, start rendering the controllers
    // in the background, hidden by the cover.
    // The _isMounted check is important, because when switching pages without a reload, there is a short period of time
    // where the old tracing view instance still exists and isWkInitialized is true, although it has not been newly initialized yet.
    // In this scenario, this `render` method here is called before `componentWillUnmount` of the TracingLayoutView is called.
    if (!this._isMounted || !isWkInitialized) {
      return cover;
    }

    const { allowedModes } = Store.getState().annotation.restrictions;

    if (!allowedModes.includes(viewMode)) {
      // Since this mode is not allowed, render nothing. A warning about this will be
      // triggered in the model. Don't throw an error since the store might change so that
      // the render function can succeed.
      return null;
    }

    const isArbitrary = constants.MODES_ARBITRARY.includes(viewMode);
    const isPlane = constants.MODES_PLANE.includes(viewMode);

    if (isArbitrary) {
      return (
        <>
          {cover != null ? cover : null}
          <ArbitraryController viewMode={viewMode} />
        </>
      );
    } else if (isPlane) {
      return (
        <>
          {cover != null ? cover : null}
          <PlaneController />
        </>
      );
    } else {
      // At the moment, all possible view modes consist of the union of MODES_ARBITRARY and MODES_PLANE
      // In case we add new viewmodes, the following error will be thrown.
      throw new Error("The current mode is none of the four known mode types");
    }
  }
}

function mapStateToProps(state: WebknossosState): StateProps {
  return {
    isUiReady: state.uiInformation.isUiReady,
    isWkInitialized: state.uiInformation.isWkInitialized,
    viewMode: state.temporaryConfiguration.viewMode,
    user: state.activeUser,
  };
}

const connector = connect(mapStateToProps);
export default connector(withBlocker(withRouter<PropsWithRouter>(Controller)));
