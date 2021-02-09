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
import {
  ArbitraryViewport,
  type ViewMode,
  OrthoViews,
  type Vector3,
  type OrthoView,
} from "oxalis/constants";
import type { OxalisState, AnnotationType, TraceOrViewCommand } from "oxalis/store";
import { RenderToPortal } from "oxalis/view/layouting/portal_utils";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import AbstractTreeTabView from "oxalis/view/right-menu/abstract_tree_tab_view";
import ActionBarView from "oxalis/view/action_bar_view";
import ButtonComponent from "oxalis/view/components/button_component";
import CommentTabView from "oxalis/view/right-menu/comment_tab/comment_tab_view";
import DatasetInfoTabView from "oxalis/view/right-menu/dataset_info_tab_view";
import InputCatcher, { recalculateInputCatcherSizes } from "oxalis/view/input_catcher";
import MappingInfoView from "oxalis/view/right-menu/mapping_info_view";
import NodeContextMenu from "oxalis/view/node_context_menu";
import MeshesView from "oxalis/view/right-menu/meshes_view";
import NmlUploadZoneContainer from "oxalis/view/nml_upload_zone_container";
import OxalisController from "oxalis/controller";
import type { ControllerStatus } from "oxalis/controller";
import RecordingSwitch from "oxalis/view/recording_switch";
import SettingsView from "oxalis/view/settings/settings_view";
import MergerModeController from "oxalis/controller/merger_mode_controller";
import TDViewControls from "oxalis/view/td_view_controls";
import Toast from "libs/toast";
import TracingView from "oxalis/view/tracing_view";
import TreesTabView, { importTracingFiles } from "oxalis/view/right-menu/trees_tab_view";
import VersionView from "oxalis/view/version_view";
import messages from "messages";
import window, { document, location } from "libs/window";
import ErrorHandling from "libs/error_handling";
import CrossOriginApi from "oxalis/api/cross_origin_api";
import { is2dDataset } from "oxalis/model/accessors/dataset_accessor";
import TabTitle from "../components/tab_title_component";

import { GoldenLayoutAdapter } from "./golden_layout_adapter";
import { determineLayout } from "./default_layout_configs";
import { storeLayoutConfig, setActiveLayout } from "./layout_persistence";

const { Sider } = Layout;

type OwnProps = {|
  initialAnnotationType: AnnotationType,
  initialCommandType: TraceOrViewCommand,
|};
type StateProps = {|
  viewMode: ViewMode,
  displayScalebars: boolean,
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
  activeLayout: string,
  hasError: boolean,
  status: ControllerStatus,
  nodeContextMenuPosition: ?[number, number],
  clickedNodeId: ?number,
  nodeContextMenuGlobalPosition: Vector3,
  nodeContextMenuViewport: ?OrthoView,
};

const canvasAndLayoutContainerID = "canvasAndLayoutContainer";

const GOLDEN_LAYOUT_ADAPTER_STYLE = {
  display: "block",
  height: "100%",
  width: "100%",
  flex: "1 1 auto",
  overflow: "hidden",
};

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
    let lastActiveLayout;
    if (
      props.storedLayouts.LastActiveLayouts &&
      props.storedLayouts.LastActiveLayouts[layoutType]
    ) {
      lastActiveLayout = props.storedLayouts.LastActiveLayouts[layoutType];
    } else {
      // added as a fallback when there are no stored last active layouts
      const firstStoredLayout = Object.keys(props.storedLayouts[layoutType])[0];
      lastActiveLayout = firstStoredLayout;
    }
    this.state = {
      isSettingsCollapsed: true,
      activeLayout: lastActiveLayout,
      hasError: false,
      status: "loading",
      nodeContextMenuPosition: null,
      clickedNodeId: null,
      nodeContextMenuGlobalPosition: [0, 0, 0],
      nodeContextMenuViewport: null,
    };
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

  onLayoutChange = (layoutConfig, layoutName) => {
    recalculateInputCatcherSizes();
    window.needsRerender = true;
    this.currentLayoutConfig = layoutConfig;
    this.currentLayoutName = layoutName;
    if (this.props.autoSaveLayouts) {
      this.saveCurrentLayout();
    }
  };

  saveCurrentLayout = () => {
    if (this.currentLayoutConfig == null || this.currentLayoutName == null) {
      return;
    }
    const layoutKey = determineLayout(
      this.props.initialCommandType.type,
      this.props.viewMode,
      this.props.is2d,
    );
    storeLayoutConfig(this.currentLayoutConfig, layoutKey, this.currentLayoutName);
  };

  getTabTitle = () => {
    const titleArray: Array<string> = [
      this.props.displayName,
      this.props.organization,
      "webKnossos",
    ];
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
      activeLayout,
    } = this.state;

    const layoutType = determineLayout(
      this.props.initialCommandType.type,
      this.props.viewMode,
      this.props.is2d,
    );
    const currentLayoutNames = this.getLayoutNamesFromCurrentView(layoutType);
    const { displayScalebars, isDatasetOnScratchVolume, isUpdateTracingAllowed } = this.props;

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
            setControllerStatus={(newStatus: ControllerStatus) =>
              this.setState({ status: newStatus })
            }
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
                      activeLayout,
                      layoutKey: layoutType,
                      setCurrentLayout: layoutName => {
                        this.setState({ activeLayout: layoutName });
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
              <div id={canvasAndLayoutContainerID} style={{ position: "relative" }}>
                <TracingView />
                <GoldenLayoutAdapter
                  id="layoutContainer"
                  style={GOLDEN_LAYOUT_ADAPTER_STYLE}
                  layoutKey={layoutType}
                  activeLayoutName={activeLayout}
                  onLayoutChange={this.onLayoutChange}
                >
                  {/*
                   * All possible layout panes are passed here. Depending on the actual layout,
                   *  the components are rendered or not.
                   */}
                  <InputCatcher
                    viewportID={OrthoViews.PLANE_XY}
                    key="xy"
                    portalKey="xy"
                    displayScalebars={displayScalebars}
                  />
                  <InputCatcher
                    viewportID={OrthoViews.PLANE_YZ}
                    key="yz"
                    portalKey="yz"
                    displayScalebars={displayScalebars}
                  />
                  <InputCatcher
                    viewportID={OrthoViews.PLANE_XZ}
                    key="xz"
                    portalKey="xz"
                    displayScalebars={displayScalebars}
                  />
                  <InputCatcher
                    viewportID={OrthoViews.TDView}
                    key="td"
                    portalKey="td"
                    displayScalebars={displayScalebars}
                  >
                    <TDViewControls />
                  </InputCatcher>
                  <InputCatcher
                    viewportID={ArbitraryViewport}
                    key="arbitraryViewport"
                    portalKey="arbitraryViewport"
                  >
                    {isUpdateTracingAllowed ? <RecordingSwitch /> : null}
                  </InputCatcher>
                  <DatasetInfoTabView key="DatasetInfoTabView" portalKey="DatasetInfoTabView" />
                  <TreesTabView key="TreesTabView" portalKey="TreesTabView" />
                  <CommentTabView key="CommentTabView" portalKey="CommentTabView" />
                  <AbstractTreeTabView key="AbstractTreeTabView" portalKey="AbstractTreeTabView" />
                  <MappingInfoView key="MappingInfoView" portalKey="MappingInfoView" />
                  <MeshesView key="MeshesView" portalKey="MeshesView" />
                </GoldenLayoutAdapter>
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
    displayScalebars: state.userConfiguration.displayScalebars,
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
