/**
 * tracing_layout_view.js
 * @flow
 */

import { Alert, Icon, Layout, Tooltip } from "antd";
import type { Dispatch } from "redux";
import { connect } from "react-redux";
import { withRouter } from "react-router-dom";
import type { RouterHistory } from "react-router-dom";
import * as React from "react";

import Request from "libs/request";
import { type ViewMode, type Vector3, type OrthoView } from "oxalis/constants";
import type { OxalisState, AnnotationType, TraceOrViewCommand } from "oxalis/store";
import { RenderToPortal } from "oxalis/view/layouting/portal_utils";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import ActionBarView from "oxalis/view/action_bar_view";
import ButtonComponent from "oxalis/view/components/button_component";
import NodeContextMenu from "oxalis/view/node_context_menu";
import NmlUploadZoneContainer from "oxalis/view/nml_upload_zone_container";
import OxalisController from "oxalis/controller";
import type { ControllerStatus } from "oxalis/controller";
import SettingsView from "oxalis/view/settings/settings_view";
import MergerModeController from "oxalis/controller/merger_mode_controller";
import Toast from "libs/toast";
import TracingView from "oxalis/view/tracing_view";
import { importTracingFiles } from "oxalis/view/right-menu/trees_tab_view";
import VersionView from "oxalis/view/version_view";
import messages from "messages";
import { document, location } from "libs/window";
import ErrorHandling from "libs/error_handling";
import CrossOriginApi from "oxalis/api/cross_origin_api";
import { recalculateInputCatcherSizes } from "oxalis/view/input_catcher";
import { is2dDataset } from "oxalis/model/accessors/dataset_accessor";
import TabTitle from "../components/tab_title_component";
import FlexLayoutWrapper from "./flex_layout_wrapper";

import { determineLayout } from "./default_layout_configs";
import { storeLayoutConfig, setActiveLayout } from "./layout_persistence";

/*
 * TODOS for this PR:
 * Enable saving of UI config
 * Fix maximize: When a pane is maximized, the on model change needs to be called.
 * After maximise the 3d viewport buttons are broken / in small or Iframe mode.
 * Spacing in the left sidebar in the settings between settings is off.
 * Fix adding new layout
 * Layout wechsel sollte ein onLayoutChange ausführen
 *
 * Beaufity UI
 */

const { Sider } = Layout;

type OwnProps = {|
  initialAnnotationType: AnnotationType,
  initialCommandType: TraceOrViewCommand,
|};
type StateProps = {|
  viewMode: ViewMode,
  isUpdateTracingAllowed: boolean,
  showVersionRestore: boolean,
  storedLayouts: Object,
  isDatasetOnScratchVolume: boolean,
  autoSaveLayouts: boolean,
  datasetName: string,
  is2d: boolean,
  displayName: string,
  organization: string,
|};
type DispatchProps = {|
  setAutoSaveLayouts: boolean => void,
|};
type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};
type PropsWithRouter = {| ...OwnProps, ...StateProps, ...DispatchProps, history: RouterHistory |};

type State = {
  isSettingsCollapsed: boolean,
  activeLayoutName: string,
  hasError: boolean,
  status: ControllerStatus,
  nodeContextMenuPosition: ?[number, number],
  clickedNodeId: ?number,
  nodeContextMenuGlobalPosition: Vector3,
  nodeContextMenuViewport: ?OrthoView,
  model: Object,
};

const canvasAndLayoutContainerID = "canvasAndLayoutContainer";

class TracingLayoutView extends React.PureComponent<PropsWithRouter, State> {
  currentLayoutConfig: Object;
  currentLayoutName: string;

  static getDerivedStateFromError() {
    // DO NOT set hasError back to false EVER as this will trigger a remount of the Controller
    // with unforeseeable consequences
    return { hasError: true };
  }

  constructor(props: PropsWithRouter) {
    super(props);
    const layoutType = determineLayout(
      this.props.initialCommandType.type,
      this.props.viewMode,
      this.props.is2d,
    );
    let lastActiveLayoutName;
    if (
      props.storedLayouts.LastActiveLayouts &&
      props.storedLayouts.LastActiveLayouts[layoutType]
    ) {
      lastActiveLayoutName = props.storedLayouts.LastActiveLayouts[layoutType];
    } else {
      // added as a fallback when there are no stored last active layouts
      const firstStoredLayout = Object.keys(props.storedLayouts[layoutType])[0];
      lastActiveLayoutName = firstStoredLayout;
    }
    const layout = props.storedLayouts[layoutType][lastActiveLayoutName];
    this.state = {
      isSettingsCollapsed: true,
      activeLayoutName: lastActiveLayoutName,
      hasError: false,
      status: "loading",
      nodeContextMenuPosition: null,
      clickedNodeId: null,
      nodeContextMenuGlobalPosition: [0, 0, 0],
      nodeContextMenuViewport: null,
      model: layout,
    };
  }

  componentDidMount() {
    window.addEventListener("resize", () => this.deferredOnLayoutChange());
  }

  componentDidCatch(error: Error) {
    ErrorHandling.notify(error);
    Toast.error(messages["react.rendering_error"]);
  }

  componentWillUnmount() {
    // Replace entire document with loading message
    document.body.removeChild(document.getElementById("main-container"));

    const refreshMessage = document.createElement("p");
    refreshMessage.innerHTML = "Reloading webKnossos...";
    refreshMessage.style.position = "absolute";
    refreshMessage.style.top = 30;
    refreshMessage.style.left = 50;
    document.body.appendChild(refreshMessage);

    // Do a complete page refresh to make sure all tracing data is garbage
    // collected and all events are canceled, etc.
    location.reload();
  }

  showNodeContextMenuAt = (
    xPos: number,
    yPos: number,
    nodeId: ?number,
    globalPosition: Vector3,
    viewport: OrthoView,
  ) => {
    this.setState({
      nodeContextMenuPosition: [xPos, yPos],
      clickedNodeId: nodeId,
      nodeContextMenuGlobalPosition: globalPosition,
      nodeContextMenuViewport: viewport,
    });
  };

  hideNodeContextMenu = () => {
    this.setState({
      nodeContextMenuPosition: null,
      clickedNodeId: null,
      nodeContextMenuGlobalPosition: [0, 0, 0],
      nodeContextMenuViewport: null,
    });
  };

  handleSettingsCollapse = () => {
    this.setState(prevState => ({
      isSettingsCollapsed: !prevState.isSettingsCollapsed,
    }));
  };

  onLayoutChange = (model: ?Object) => {
    recalculateInputCatcherSizes();
    window.needsRerender = true;
    if (model != null) {
      this.setState({ model });
    }
    if (this.props.autoSaveLayouts) {
      console.log("saving cause of model change");
      this.saveCurrentLayout();
    }
  };

  deferredOnLayoutChange = (model?: Object) => setTimeout(() => this.onLayoutChange(model), 1);

  saveCurrentLayout = () => {
    const layoutKey = determineLayout(
      this.props.initialCommandType.type,
      this.props.viewMode,
      this.props.is2d,
    );
    console.log("storing", layoutKey, this.state.activeLayoutName);
    storeLayoutConfig(this.state.model, layoutKey, this.state.activeLayoutName);
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
    return titleArray.filter(elem => elem).join(" | ");
  };

  getLayoutNamesFromCurrentView = (layoutKey): Array<string> =>
    this.props.storedLayouts[layoutKey] ? Object.keys(this.props.storedLayouts[layoutKey]) : [];

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ marginTop: 50, textAlign: "center" }}>
          {messages["react.rendering_error"]}
        </div>
      );
    }

    const {
      clickedNodeId,
      nodeContextMenuPosition,
      nodeContextMenuGlobalPosition,
      nodeContextMenuViewport,
      status,
      isSettingsCollapsed,
      activeLayoutName,
    } = this.state;

    const layoutType = determineLayout(
      this.props.initialCommandType.type,
      this.props.viewMode,
      this.props.is2d,
    );
    const currentLayoutNames = this.getLayoutNamesFromCurrentView(layoutType);
    const { isDatasetOnScratchVolume, isUpdateTracingAllowed } = this.props;
    const layout = this.props.storedLayouts[layoutType][activeLayoutName];
    console.log("layout:", layoutType, activeLayoutName);

    const createNewTracing = async (
      files: Array<File>,
      createGroupForEachFile: boolean,
    ): Promise<void> => {
      const response = await Request.sendMultipartFormReceiveJSON("/api/annotations/upload", {
        data: { nmlFile: files, createGroupForEachFile, datasetName: this.props.datasetName },
      });
      this.props.history.push(`/annotations/${response.annotation.typ}/${response.annotation.id}`);
    };

    return (
      <React.Fragment>
        {nodeContextMenuPosition != null && nodeContextMenuViewport != null ? (
          <NodeContextMenu
            hideNodeContextMenu={this.hideNodeContextMenu}
            clickedNodeId={clickedNodeId}
            nodeContextMenuPosition={nodeContextMenuPosition}
            globalPosition={nodeContextMenuGlobalPosition}
            viewport={nodeContextMenuViewport}
          />
        ) : null}
        <NmlUploadZoneContainer
          onImport={isUpdateTracingAllowed ? importTracingFiles : createNewTracing}
          isUpdateAllowed={isUpdateTracingAllowed}
        >
          <TabTitle title={this.getTabTitle()} />
          <OxalisController
            initialAnnotationType={this.props.initialAnnotationType}
            initialCommandType={this.props.initialCommandType}
            controllerStatus={status}
            setControllerStatus={(newStatus: ControllerStatus) => {
              this.setState({ status: newStatus });
              setTimeout(() => {
                recalculateInputCatcherSizes();
                window.needsRerender = true;
              }, 500);
            }}
            showNodeContextMenuAt={this.showNodeContextMenuAt}
          />
          <CrossOriginApi />
          <Layout className="tracing-layout">
            <RenderToPortal portalId="navbarTracingSlot">
              {status === "loaded" ? (
                <div style={{ flex: "0 1 auto", zIndex: 210, display: "flex" }}>
                  <ButtonComponent
                    className={isSettingsCollapsed ? "" : "highlight-togglable-button"}
                    onClick={this.handleSettingsCollapse}
                    shape="circle"
                  >
                    <Icon
                      type="setting"
                      className="withoutIconMargin"
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
                      setCurrentLayout: layoutName => {
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
                          backgroundColor: "#f17a27",
                          color: "white",
                        }}
                        message={
                          <span>
                            Dataset is on tmpscratch!{" "}
                            <Icon type="warning" theme="filled" style={{ margin: "0 0 0 6px" }} />
                          </span>
                        }
                        type="error"
                      />
                    </Tooltip>
                  ) : null}
                </div>
              ) : null}
            </RenderToPortal>
            <Layout style={{ display: "flex" }}>
              <Sider
                collapsible
                trigger={null}
                collapsed={isSettingsCollapsed}
                collapsedWidth={0}
                width={360}
                style={{ zIndex: 100, marginRight: isSettingsCollapsed ? 0 : 8 }}
              >
                <SettingsView dontRenderContents={isSettingsCollapsed} />
              </Sider>
              <MergerModeController />
              <div id={canvasAndLayoutContainerID} style={{ position: "relative", width: "100%" }}>
                <TracingView />
                <FlexLayoutWrapper
                  layout={layout}
                  onLayoutChange={this.onLayoutChange}
                  layoutKey={layoutType}
                  layoutName={activeLayoutName}
                />
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

const mapDispatchToProps = (dispatch: Dispatch<*>) => ({
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
  };
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(withRouter(TracingLayoutView));
