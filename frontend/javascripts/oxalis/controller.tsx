import type { RouteComponentProps } from "react-router-dom";
import { withRouter, Link } from "react-router-dom";
import { AsyncButton } from "components/async_clickables";
import { connect } from "react-redux";
import { Location as HistoryLocation, Action as HistoryAction } from "history";
// @ts-expect-error ts-migrate(7016) FIXME: Could not find a declaration file for module 'back... Remove this comment to see the full error message
import BackboneEvents from "backbone-events-standalone";
import * as React from "react";
import _ from "lodash";
import { Button, Col, Row } from "antd";
import { APIAnnotationTypeEnum, APICompoundType } from "types/api_flow_types";
import { HANDLED_ERROR } from "oxalis/model_initialization";
import { InputKeyboardNoLoop } from "libs/input";
import { fetchGistContent } from "libs/gist";
import { initializeSceneController } from "oxalis/controller/scene_controller";
import { saveNowAction, undoAction, redoAction } from "oxalis/model/actions/save_actions";
import { setIsInAnnotationViewAction } from "oxalis/model/actions/ui_actions";
import { setViewModeAction, updateLayerSettingAction } from "oxalis/model/actions/settings_actions";
import { wkReadyAction } from "oxalis/model/actions/actions";
import { switchToOrganization } from "admin/admin_rest_api";
import LoginForm from "admin/auth/login_form";
import ApiLoader from "oxalis/api/api_loader";
import ArbitraryController from "oxalis/controller/viewmodes/arbitrary_controller";
import BrainSpinner from "components/brain_spinner";
import Model from "oxalis/model";
import PlaneController from "oxalis/controller/viewmodes/plane_controller";
import type { OxalisState, TraceOrViewCommand } from "oxalis/store";
import Store from "oxalis/store";
import Toast from "libs/toast";
import UrlManager from "oxalis/controller/url_manager";
import * as Utils from "libs/utils";
import type { APIUser, APIOrganization } from "types/api_flow_types";
import app from "app";
import type { ShowContextMenuFunction, ViewMode } from "oxalis/constants";
import constants, { ControlModeEnum } from "oxalis/constants";
import messages from "messages";
import window, { document, location } from "libs/window";
import DataLayer from "./model/data_layer";
export type ControllerStatus = "loading" | "loaded" | "failedLoading";
type OwnProps = {
  initialMaybeCompoundType: APICompoundType | null;
  initialCommandType: TraceOrViewCommand;
  controllerStatus: ControllerStatus;
  setControllerStatus: (arg0: ControllerStatus) => void;
  showContextMenuAt: ShowContextMenuFunction;
};
type StateProps = {
  viewMode: ViewMode;
  user: APIUser | null | undefined;
};
type Props = OwnProps & StateProps;
type PropsWithRouter = Props & RouteComponentProps;
type State = {
  gotUnhandledError: boolean;
  organizationToSwitchTo: APIOrganization | null | undefined;
};

class Controller extends React.PureComponent<PropsWithRouter, State> {
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'keyboardNoLoop' has no initializer and i... Remove this comment to see the full error message
  // eslint-disable-next-line react/no-unused-class-component-methods
  keyboardNoLoop: InputKeyboardNoLoop;
  // @ts-expect-error ts-migrate(2564) FIXME: Property 'isMounted' has no initializer and is not... Remove this comment to see the full error message
  isMounted: boolean;
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
    _.extend(this, BackboneEvents);

    // The annotation view should be rendered without the special mobile-friendly
    // viewport meta tag.
    Utils.disableViewportMetatag();
    this.isMounted = true;
    Store.dispatch(setIsInAnnotationViewAction(true));
    UrlManager.initialize();

    if (!this.isWebGlSupported()) {
      Toast.error(messages["webgl.disabled"]);
    }

    this.tryFetchingModel();
  }

  componentWillUnmount() {
    this.isMounted = false;
    Store.dispatch(setIsInAnnotationViewAction(false));
  }

  tryFetchingModel() {
    this.props.setControllerStatus("loading");
    // Preview a working annotation version if the showVersionRestore URL parameter is supplied
    const versions = Utils.hasUrlParam("showVersionRestore")
      ? {
          skeleton: 1,
        }
      : undefined;
    Model.fetch(this.props.initialMaybeCompoundType, this.props.initialCommandType, true, versions)
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
    const beforeUnload = (
      newLocation: HistoryLocation<unknown>,
      action: HistoryAction,
    ): string | false | void => {
      // Only show the prompt if this is a proper beforeUnload event from the browser
      // or the pathname changed
      // This check has to be done because history.block triggers this function even if only the url hash changed
      if (action === undefined || newLocation.pathname !== location.pathname) {
        const stateSaved = Model.stateSaved();

        if (!stateSaved && Store.getState().tracing.restrictions.allowUpdate) {
          // @ts-ignore
          window.onbeforeunload = null; // clear the event handler otherwise it would be called twice. Once from history.block once from the beforeunload event

          setTimeout(() => {
            if (!this.isMounted) {
              return;
            }

            Store.dispatch(saveNowAction());
            // restore the event handler in case a user chose to stay on the page
            // @ts-ignore
            window.onbeforeunload = beforeUnload;
          }, 500);
          return messages["save.leave_page_unfinished"];
        }
      }

      // eslint-disable-next-line no-useless-return, consistent-return
      return;
    };

    this.props.history.block(beforeUnload);
    // @ts-ignore
    window.onbeforeunload = beforeUnload;
    UrlManager.startUrlUpdater();
    initializeSceneController();
    this.initKeyboard();
    this.initTaskScript();
    // @ts-expect-error ts-migrate(2339) FIXME: Property 'webknossos' does not exist on type '(Win... Remove this comment to see the full error message
    window.webknossos = new ApiLoader(Model);
    app.vent.trigger("webknossos:ready");
    Store.dispatch(wkReadyAction());
    setTimeout(() => {
      // Give wk (sagas and bucket loading) a bit time to catch air before
      // showing the UI as "ready". The goal here is to avoid that the
      // UI is still freezing after the loading indicator is gone.
      this.props.setControllerStatus("loaded");
    }, 200);
  }

  async initTaskScript() {
    // Loads a Gist from GitHub with a user script if there is a
    // script assigned to the task
    const { task } = Store.getState();

    if (task != null && task.script != null) {
      const { script } = task;
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

  isWebGlSupported() {
    return (
      // @ts-expect-error ts-migrate(2339) FIXME: Property 'WebGLRenderingContext' does not exist on... Remove this comment to see the full error message
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
    const { controlMode } = Store.getState().temporaryConfiguration;
    const keyboardControls = {};

    if (controlMode !== ControlModeEnum.VIEW) {
      _.extend(keyboardControls, {
        // Set Mode, outcomment for release
        "shift + 1": () => Store.dispatch(setViewModeAction(constants.MODE_PLANE_TRACING)),
        "shift + 2": () => Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY)),
        "shift + 3": () => Store.dispatch(setViewModeAction(constants.MODE_ARBITRARY_PLANE)),
        m: () => {
          // rotate allowed modes
          const currentViewMode = Store.getState().temporaryConfiguration.viewMode;
          const { allowedModes } = Store.getState().tracing.restrictions;
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

    _.extend(keyboardControls, {
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

    // eslint-disable-next-line react/no-unused-class-component-methods
    this.keyboardNoLoop = new InputKeyboardNoLoop(keyboardControls);
  }

  render() {
    const status = this.props.controllerStatus;
    const { user, viewMode } = this.props;
    const { gotUnhandledError, organizationToSwitchTo } = this.state;
    const switchToOwningOrganizationButton = (
      <AsyncButton
        type="primary"
        style={{
          marginRight: 26,
        }}
        onClick={async () => {
          if (organizationToSwitchTo != null) {
            await switchToOrganization(organizationToSwitchTo.name);
          }
        }}
      >
        Switch to this Organization
      </AsyncButton>
    );

    if (status === "loading") {
      return <BrainSpinner />;
    } else if (status === "failedLoading" && user != null) {
      const message =
        organizationToSwitchTo != null
          ? `This dataset belongs to the organization ${organizationToSwitchTo.displayName} which is currently not your active organization. Do you want to switch to that organization?`
          : "Either the dataset does not exist or you do not have the necessary access rights.";
      return (
        <BrainSpinner
          message={
            <div
              style={{
                textAlign: "center",
              }}
            >
              {gotUnhandledError ? messages["tracing.unhandled_initialization_error"] : message}
              <br />
              <div
                style={{
                  marginTop: 16,
                  display: "inline-block",
                }}
              >
                {organizationToSwitchTo != null ? switchToOwningOrganizationButton : null}
                <Link to="/">
                  <Button type="primary">Return to dashboard</Button>
                </Link>
              </div>
            </div>
          }
          isLoading={false}
        />
      );
    } else if (status === "failedLoading") {
      return (
        <div className="cover-whole-screen">
          <Row
            justify="center"
            style={{
              padding: 50,
            }}
            align="middle"
          >
            <Col span={8}>
              <h3>Try logging in to view the dataset.</h3>
              <LoginForm
                layout="horizontal"
                onLoggedIn={() => {
                  // Close existing error toasts for "Not Found" errors before trying again.
                  // If they get relevant again, they will be recreated anyway.
                  Toast.close("404");
                  this.tryFetchingModel();
                }}
              />
            </Col>
          </Row>
        </div>
      );
    }

    const { allowedModes } = Store.getState().tracing.restrictions;

    if (!allowedModes.includes(viewMode)) {
      // Since this mode is not allowed, render nothing. A warning about this will be
      // triggered in the model. Don't throw an error since the store might change so that
      // the render function can succeed.
      return null;
    }

    const isArbitrary = constants.MODES_ARBITRARY.includes(viewMode);
    const isPlane = constants.MODES_PLANE.includes(viewMode);

    if (isArbitrary) {
      return <ArbitraryController viewMode={viewMode} />;
    } else if (isPlane) {
      return <PlaneController showContextMenuAt={this.props.showContextMenuAt} />;
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
    user: state.activeUser,
  };
}

const connector = connect(mapStateToProps);
export default connector(withRouter<PropsWithRouter, any>(Controller));
