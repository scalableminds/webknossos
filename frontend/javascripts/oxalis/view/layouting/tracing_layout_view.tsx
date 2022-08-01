import { Alert, Layout, Tooltip } from "antd";
import { SettingOutlined, WarningFilled } from "@ant-design/icons";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { RouteComponentProps, withRouter } from "react-router-dom";
import * as React from "react";
import _ from "lodash";
import Request from "libs/request";
import type { ViewMode, Vector3, OrthoView } from "oxalis/constants";
import Constants from "oxalis/constants";
import type { OxalisState, TraceOrViewCommand } from "oxalis/store";
import { RenderToPortal } from "oxalis/view/layouting/portal_utils";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import ActionBarView from "oxalis/view/action_bar_view";
import ContextMenuContainer from "oxalis/view/context_menu";
import ButtonComponent from "oxalis/view/components/button_component";
import NmlUploadZoneContainer from "oxalis/view/nml_upload_zone_container";
import OxalisController from "oxalis/controller";
import type { ControllerStatus } from "oxalis/controller";
import MergerModeController from "oxalis/controller/merger_mode_controller";
import Toast from "libs/toast";
import TracingView from "oxalis/view/tracing_view";
import VersionView from "oxalis/view/version_view";
import messages from "messages";
import { document, location } from "libs/window";
import ErrorHandling from "libs/error_handling";
import CrossOriginApi from "oxalis/api/cross_origin_api";
import {
  recalculateInputCatcherSizes,
  initializeInputCatcherSizes,
} from "oxalis/view/input_catcher";
import { importTracingFiles } from "oxalis/view/right-border-tabs/skeleton_tab_view";
import {
  layoutEmitter,
  storeLayoutConfig,
  setActiveLayout,
  getLastActiveLayout,
  getLayoutConfig,
} from "oxalis/view/layouting/layout_persistence";
import { is2dDataset } from "oxalis/model/accessors/dataset_accessor";
import PresentModernControls from "oxalis/view/novel_user_experiences/01-present-modern-controls";
import WelcomeToast from "oxalis/view/novel_user_experiences/welcome_toast";
import { APICompoundType } from "types/api_flow_types";
import TabTitle from "../components/tab_title_component";
import FlexLayoutWrapper from "./flex_layout_wrapper";
import { determineLayout } from "./default_layout_configs";

const { Sider } = Layout;

type OwnProps = {
  initialMaybeCompoundType: APICompoundType | null;
  initialCommandType: TraceOrViewCommand;
};
type StateProps = {
  viewMode: ViewMode;
  isUpdateTracingAllowed: boolean;
  showVersionRestore: boolean;
  storedLayouts: Record<string, any>;
  isDatasetOnScratchVolume: boolean;
  autoSaveLayouts: boolean;
  datasetName: string;
  is2d: boolean;
  displayName: string;
  organization: string;
  isLeftBorderOpen: boolean;
};
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
  contextMenuPosition: [number, number] | null | undefined;
  clickedNodeId: number | null | undefined;
  clickedBoundingBoxId: number | null | undefined;
  contextMenuGlobalPosition: Vector3 | null | undefined;
  contextMenuViewport: OrthoView | null | undefined;
  model: Record<string, any>;
};
const canvasAndLayoutContainerID = "canvasAndLayoutContainer";

class TracingLayoutView extends React.PureComponent<PropsWithRouter, State> {
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
      contextMenuPosition: null,
      clickedNodeId: null,
      clickedBoundingBoxId: null,
      contextMenuGlobalPosition: null,
      contextMenuViewport: null,
      model: layout,
    };
  }

  componentDidCatch(error: Error) {
    ErrorHandling.notify(error);
    Toast.error(messages["react.rendering_error"]);
  }

  componentWillUnmount() {
    // Replace entire document with loading message
    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
    document.body.removeChild(document.getElementById("main-container"));
    window.removeEventListener("resize", this.debouncedOnLayoutChange);
    const refreshMessage = document.createElement("p");
    refreshMessage.innerHTML = "Reloading webKnossos...";
    refreshMessage.style.position = "absolute";
    refreshMessage.style.top = "10px";
    refreshMessage.style.left = "10px";
    // @ts-expect-error ts-migrate(2531) FIXME: Object is possibly 'null'.
    document.body.appendChild(refreshMessage);
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
  };

  showContextMenuAt = (
    xPos: number,
    yPos: number,
    nodeId: number | null | undefined,
    boundingBoxId: number | null | undefined,
    globalPosition: Vector3 | null | undefined,
    viewport: OrthoView,
  ) => {
    // On Windows the right click to open the context menu is also triggered for the overlay
    // of the context menu. This causes the context menu to instantly close after opening.
    // Therefore delay the state update to delay that the context menu is rendered.
    // Thus the context overlay does not get the right click as an event and therefore does not close.
    setTimeout(
      () =>
        this.setState({
          contextMenuPosition: [xPos, yPos],
          clickedNodeId: nodeId,
          clickedBoundingBoxId: boundingBoxId,
          contextMenuGlobalPosition: globalPosition,
          contextMenuViewport: viewport,
        }),
      0,
    );
  };

  hideContextMenu = () => {
    this.setState({
      contextMenuPosition: null,
      clickedNodeId: null,
      clickedBoundingBoxId: null,
      contextMenuGlobalPosition: null,
      contextMenuViewport: null,
    });
  };

  onLayoutChange = (model?: Record<string, any>, layoutName?: string) => {
    recalculateInputCatcherSizes();
    // @ts-ignore
    window.needsRerender = true;

    if (model != null) {
      this.setState({
        model,
      });
    }

    if (this.props.autoSaveLayouts) {
      this.saveCurrentLayout(layoutName);
    }
  };

  // eslint-disable-next-line react/sort-comp
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

    const titleArray: Array<string> = [...getDescriptors(), "webKnossos"];
    return titleArray.filter((elem) => elem).join(" | ");
  };

  // @ts-expect-error ts-migrate(7006) FIXME: Parameter 'layoutKey' implicitly has an 'any' type... Remove this comment to see the full error message
  getLayoutNamesFromCurrentView = (layoutKey): Array<string> =>
    this.props.storedLayouts[layoutKey] ? Object.keys(this.props.storedLayouts[layoutKey]) : [];

  toggleLeftBorder = () => {
    layoutEmitter.emit("toggleBorder", "left");
  };

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

    const { contextMenuPosition, contextMenuViewport, status, activeLayoutName } = this.state;
    const layoutType = determineLayout(
      this.props.initialCommandType.type,
      this.props.viewMode,
      this.props.is2d,
    );
    const currentLayoutNames = this.getLayoutNamesFromCurrentView(layoutType);
    const { isDatasetOnScratchVolume, isUpdateTracingAllowed, isLeftBorderOpen } = this.props;

    const createNewTracing = async (
      files: Array<File>,
      createGroupForEachFile: boolean,
    ): Promise<void> => {
      const response = await Request.sendMultipartFormReceiveJSON("/api/annotations/upload", {
        data: {
          nmlFile: files,
          createGroupForEachFile,
          datasetName: this.props.datasetName,
        },
      });
      this.props.history.push(`/annotations/${response.annotation.typ}/${response.annotation.id}`);
    };

    return (
      <React.Fragment>
        <PresentModernControls />

        {status === "loaded" && (
          <ContextMenuContainer
            hideContextMenu={this.hideContextMenu}
            maybeClickedNodeId={this.state.clickedNodeId}
            clickedBoundingBoxId={this.state.clickedBoundingBoxId}
            globalPosition={this.state.contextMenuGlobalPosition}
            contextMenuPosition={contextMenuPosition}
            maybeViewport={contextMenuViewport}
          />
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
            showContextMenuAt={this.showContextMenuAt}
          />
          <CrossOriginApi />
          <Layout className="tracing-layout">
            <RenderToPortal portalId="navbarTracingSlot">
              {status === "loaded" ? (
                <div
                  style={{
                    flex: "0 1 auto",
                    zIndex: 210,
                    display: "flex",
                  }}
                >
                  <ButtonComponent
                    className={isLeftBorderOpen ? "highlight-togglable-button" : ""}
                    onClick={this.toggleLeftBorder}
                    shape="circle"
                  >
                    <SettingOutlined
                      className="without-icon-margin"
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    />
                  </ButtonComponent>
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
                          backgroundColor: "var(--ant-warning)",
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
                <Sider id="version-restore-sider" width={400}>
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

function mapStateToProps(state: OxalisState): StateProps {
  return {
    viewMode: state.temporaryConfiguration.viewMode,
    autoSaveLayouts: state.userConfiguration.autoSaveLayouts,
    isUpdateTracingAllowed: state.tracing.restrictions.allowUpdate,
    showVersionRestore: state.uiInformation.showVersionRestore,
    storedLayouts: state.uiInformation.storedLayouts,
    isDatasetOnScratchVolume: state.dataset.dataStore.isScratch,
    datasetName: state.dataset.name,
    is2d: is2dDataset(state.dataset),
    displayName: state.tracing.name ? state.tracing.name : state.dataset.name,
    organization: state.dataset.owningOrganization,
    isLeftBorderOpen: state.uiInformation.borderOpenStatus.left,
  };
}

const connector = connect(mapStateToProps, mapDispatchToProps);
export default connector(withRouter<RouteComponentProps & OwnProps, any>(TracingLayoutView));
