import { WarningFilled } from "@ant-design/icons";
import { Alert, ConfigProvider, Layout, Tooltip } from "antd";
import ErrorHandling from "libs/error_handling";
import Request from "libs/request";
import Toast from "libs/toast";
import { document, location } from "libs/window";
import _ from "lodash";
import messages from "messages";
import CrossOriginApi from "oxalis/api/cross_origin_api";
import Constants from "oxalis/constants";
import type { ControllerStatus } from "oxalis/controller";
import OxalisController from "oxalis/controller";
import MergerModeController from "oxalis/controller/merger_mode_controller";
import { is2dDataset } from "oxalis/model/accessors/dataset_accessor";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import { Store } from "oxalis/singletons";
import type { OxalisState, Theme, TraceOrViewCommand } from "oxalis/store";
import ActionBarView from "oxalis/view/action_bar_view";
import WkContextMenu from "oxalis/view/context_menu";
import {
  initializeInputCatcherSizes,
  recalculateInputCatcherSizes,
} from "oxalis/view/input_catcher";
import {
  getLastActiveLayout,
  getLayoutConfig,
  layoutEmitter,
  setActiveLayout,
  storeLayoutConfig,
} from "oxalis/view/layouting/layout_persistence";
import { RenderToPortal } from "oxalis/view/layouting/portal_utils";
import NmlUploadZoneContainer from "oxalis/view/nml_upload_zone_container";
import PresentModernControls from "oxalis/view/novel_user_experiences/01-present-modern-controls";
import WelcomeToast from "oxalis/view/novel_user_experiences/welcome_toast";
import { importTracingFiles } from "oxalis/view/right-border-tabs/trees_tab/skeleton_tab_view";
import TracingView from "oxalis/view/tracing_view";
import VersionView from "oxalis/view/version_view";
import * as React from "react";
import { connect } from "react-redux";
import { type RouteComponentProps, withRouter } from "react-router-dom";
import type { Dispatch } from "redux";
import type { APICompoundType } from "types/api_flow_types";
import DistanceMeasurementTooltip from "oxalis/view/distance_measurement_tooltip";
import TabTitle from "../components/tab_title_component";
import { determineLayout } from "./default_layout_configs";
import FlexLayoutWrapper from "./flex_layout_wrapper";
import { FloatingMobileControls } from "./floating_mobile_controls";
import app from "app";
import { NavAndStatusBarTheme } from "theme";

const { Sider } = Layout;

type OwnProps = {
  initialMaybeCompoundType: APICompoundType | null;
  initialCommandType: TraceOrViewCommand;
  UITheme: Theme;
};
type StateProps = ReturnType<typeof mapStateToProps>;
type DispatchProps = {
  setAutoSaveLayouts: (arg0: boolean) => void;
};
type PropsWithRouter = OwnProps &
  StateProps &
  DispatchProps & {
    history: RouteComponentProps["history"];
  };
type State = {
  activeLayoutName: string;
  hasError: boolean;
  status: ControllerStatus;
  model: Record<string, any>;
  showFloatingMobileButtons: boolean;
};
const canvasAndLayoutContainerID = "canvasAndLayoutContainer";

class TracingLayoutView extends React.PureComponent<PropsWithRouter, State> {
  lastTouchTimeStamp: number | null = null;

  static getDerivedStateFromError() {
    // DO NOT set hasError back to false EVER as this will trigger a remount of the Controller
    // with unforeseeable consequences
    return {
      hasError: true,
    };
  }

  constructor(props: PropsWithRouter) {
    super(props);
    const layoutType = determineLayout(
      this.props.initialCommandType.type,
      this.props.viewMode,
      this.props.is2d,
    );
    const lastActiveLayoutName = getLastActiveLayout(layoutType);
    const layout = getLayoutConfig(layoutType, lastActiveLayoutName);
    this.state = {
      activeLayoutName: lastActiveLayoutName,
      hasError: false,
      status: "loading",
      model: layout,
      showFloatingMobileButtons: false,
    };
  }

  componentDidCatch(error: Error) {
    ErrorHandling.notify(error);
    Toast.error(messages["react.rendering_error"]);
  }

  componentWillUnmount() {
    // Replace entire document with loading message
    if (document.body != null) {
      const mainContainer = document.getElementById("main-container");
      if (mainContainer) {
        document.body.removeChild(mainContainer);
      }
    }
    window.removeEventListener("resize", this.debouncedOnLayoutChange);
    window.removeEventListener("touchstart", this.handleTouch);
    window.removeEventListener("mouseover", this.handleMouseOver);

    const refreshMessageContainer = document.createElement("div");
    refreshMessageContainer.style.display = "grid";
    // @ts-ignore
    refreshMessageContainer.style["place-items"] = "center";
    refreshMessageContainer.style.height = "75vh";

    const refreshMessage = document.createElement("div");
    refreshMessage.innerHTML = "Reloading WEBKNOSSOS...";
    refreshMessageContainer.appendChild(refreshMessage);

    if (document.body != null) {
      document.body.appendChild(refreshMessageContainer);
    }
    // Do a complete page refresh to make sure all tracing data is garbage
    // collected and all events are canceled, etc.
    location.reload();
  }

  setControllerStatus = (newStatus: ControllerStatus) => {
    this.setState({
      status: newStatus,
    });
    if (newStatus !== "loaded") {
      return;
    }
    // After the data is loaded recalculate the layout type and the active layout.
    const { initialCommandType, viewMode, is2d } = this.props;
    const layoutType = determineLayout(initialCommandType.type, viewMode, is2d);
    const lastActiveLayoutName = getLastActiveLayout(layoutType);
    const layout = getLayoutConfig(layoutType, lastActiveLayoutName);
    this.setState({
      activeLayoutName: lastActiveLayoutName,
      model: layout,
    });
    initializeInputCatcherSizes();
    window.addEventListener("resize", this.debouncedOnLayoutChange);
    window.addEventListener("touchstart", this.handleTouch);
    window.addEventListener("mouseover", this.handleMouseOver, false);

    if (window.screen.width <= 1080) {
      // Simply assume mobile.
      const { left, right } = Store.getState().uiInformation.borderOpenStatus;
      if (left) {
        layoutEmitter.emit("toggleBorder", "left");
      }
      if (right) {
        layoutEmitter.emit("toggleBorder", "right");
      }
      // Immediately show mobile buttons
      this.handleTouch();
    }
  };

  handleTouch = () => {
    this.lastTouchTimeStamp = Date.now();
    this.setState({ showFloatingMobileButtons: true });
  };

  handleMouseOver = () => {
    if (this.lastTouchTimeStamp && Date.now() - this.lastTouchTimeStamp < 1000) {
      // Ignore mouse move events when they are shortly after touch events because the browser
      // emulates these events when touch is used.
      // Also ignore the event when touch was never used, because then the mobile buttons
      // were never shown, anyway.
      return;
    }

    this.setState({ showFloatingMobileButtons: false });
    this.lastTouchTimeStamp = null;
  };

  onLayoutChange = (model?: Record<string, any>, layoutName?: string) => {
    recalculateInputCatcherSizes();
    app.vent.emit("rerender");

    if (model != null) {
      this.setState({ model }, () => {
        if (this.props.autoSaveLayouts) {
          this.saveCurrentLayout(layoutName);
        }
      });
    }
  };

  debouncedOnLayoutChange = _.debounce(() => this.onLayoutChange(), Constants.RESIZE_THROTTLE_TIME);

  saveCurrentLayout = (layoutName?: string) => {
    const layoutKey = determineLayout(
      this.props.initialCommandType.type,
      this.props.viewMode,
      this.props.is2d,
    );
    storeLayoutConfig(this.state.model, layoutKey, layoutName || this.state.activeLayoutName);
  };

  getTabTitle = () => {
    const getDescriptors = () => {
      switch (this.state.status) {
        case "loading":
          return ["Loading"];

        case "failedLoading":
          return ["Error"];

        default:
          return [this.props.displayName, this.props.organization];
      }
    };

    const titleArray: Array<string> = [...getDescriptors(), "WEBKNOSSOS"];
    return titleArray.filter((elem) => elem).join(" | ");
  };

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'layoutKey' implicitly has an 'any' type... Remove this comment to see the full error message
  getLayoutNamesFromCurrentView = (layoutKey): Array<string> =>
    this.props.storedLayouts[layoutKey] ? Object.keys(this.props.storedLayouts[layoutKey]) : [];

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            marginTop: 50,
            textAlign: "center",
          }}
        >
          {messages["react.rendering_error"]}
        </div>
      );
    }

    const { status, activeLayoutName } = this.state;
    const layoutType = determineLayout(
      this.props.initialCommandType.type,
      this.props.viewMode,
      this.props.is2d,
    );
    const currentLayoutNames = this.getLayoutNamesFromCurrentView(layoutType);
    const { isDatasetOnScratchVolume, isUpdateTracingAllowed, distanceMeasurementTooltipPosition } =
      this.props;

    const createNewTracing = async (
      files: Array<File>,
      createGroupForEachFile: boolean,
    ): Promise<void> => {
      const response = await Request.sendMultipartFormReceiveJSON("/api/annotations/upload", {
        data: {
          nmlFile: files,
          createGroupForEachFile,
          datasetId: this.props.datasetId,
        },
      });
      this.props.history.push(`/annotations/${response.annotation.typ}/${response.annotation.id}`);
    };

    return (
      <React.Fragment>
        <PresentModernControls />
        {this.state.showFloatingMobileButtons && <FloatingMobileControls />}

        {status === "loaded" && <WkContextMenu />}

        {status === "loaded" && distanceMeasurementTooltipPosition != null && (
          <DistanceMeasurementTooltip />
        )}

        <NmlUploadZoneContainer
          onImport={isUpdateTracingAllowed ? importTracingFiles : createNewTracing}
          isUpdateAllowed={isUpdateTracingAllowed}
        >
          <TabTitle title={this.getTabTitle()} />
          <OxalisController
            initialMaybeCompoundType={this.props.initialMaybeCompoundType}
            initialCommandType={this.props.initialCommandType}
            controllerStatus={status}
            setControllerStatus={this.setControllerStatus}
          />
          <CrossOriginApi />
          <Layout className="tracing-layout">
            <RenderToPortal portalId="navbarTracingSlot">
              <ConfigProvider theme={NavAndStatusBarTheme}>
                {status === "loaded" ? (
                  <div
                    style={{
                      flex: "0 1 auto",
                      zIndex: 210,
                      display: "flex",
                    }}
                  >
                    <ActionBarView
                      layoutProps={{
                        storedLayoutNamesForView: currentLayoutNames,
                        activeLayout: activeLayoutName,
                        layoutKey: layoutType,
                        setCurrentLayout: (layoutName) => {
                          this.setState({
                            activeLayoutName: layoutName,
                          });
                          setActiveLayout(layoutType, layoutName);
                        },
                        saveCurrentLayout: this.saveCurrentLayout,
                        setAutoSaveLayouts: this.props.setAutoSaveLayouts,
                        autoSaveLayouts: this.props.autoSaveLayouts,
                      }}
                    />
                    {isDatasetOnScratchVolume ? (
                      <Tooltip title={messages["dataset.is_scratch"]}>
                        <Alert
                          className="hide-on-small-screen"
                          style={{
                            height: 30,
                            paddingTop: 4,
                            backgroundColor: "var(--ant-color-warning)",
                            border: "none",
                            color: "white",
                          }}
                          message={
                            <span>
                              Dataset is on tmpscratch!{" "}
                              <WarningFilled
                                style={{
                                  margin: "0 0 0 6px",
                                }}
                              />
                            </span>
                          }
                          type="error"
                        />
                      </Tooltip>
                    ) : null}
                  </div>
                ) : null}
              </ConfigProvider>
            </RenderToPortal>
            <Layout
              style={{
                display: "flex",
              }}
            >
              <MergerModeController />
              <div
                id={canvasAndLayoutContainerID}
                style={{
                  width: "100%",
                  height: "100%",
                }}
              >
                {status !== "failedLoading" && <TracingView />}
                {status === "loaded" ? (
                  <React.Fragment>
                    <FlexLayoutWrapper
                      onLayoutChange={this.onLayoutChange}
                      layoutKey={layoutType}
                      layoutName={activeLayoutName}
                    />
                    <WelcomeToast />
                  </React.Fragment>
                ) : null}
              </div>
              {this.props.showVersionRestore ? (
                <Sider id="version-restore-sider" width={400} theme={this.props.UITheme}>
                  <VersionView allowUpdate={isUpdateTracingAllowed} />
                </Sider>
              ) : null}
            </Layout>
          </Layout>
        </NmlUploadZoneContainer>
      </React.Fragment>
    );
  }
}

const mapDispatchToProps = (dispatch: Dispatch<any>) => ({
  setAutoSaveLayouts(value: boolean) {
    dispatch(updateUserSettingAction("autoSaveLayouts", value));
  },
});

function mapStateToProps(state: OxalisState) {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    autoSaveLayouts: state.userConfiguration.autoSaveLayouts,
    isUpdateTracingAllowed: state.tracing.restrictions.allowUpdate,
    showVersionRestore: state.uiInformation.showVersionRestore,
    storedLayouts: state.uiInformation.storedLayouts,
    isDatasetOnScratchVolume: state.dataset.dataStore.isScratch,
    datasetId: state.dataset.id,
    is2d: is2dDataset(state.dataset),
    displayName: state.tracing.name ? state.tracing.name : state.dataset.name,
    organization: state.dataset.owningOrganization,
    distanceMeasurementTooltipPosition:
      state.uiInformation.measurementToolInfo.lastMeasuredPosition,
    additionalCoordinates: state.flycam.additionalCoordinates,
    UITheme: state.uiInformation.theme,
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(withRouter<RouteComponentProps & OwnProps, any>(TracingLayoutView));
