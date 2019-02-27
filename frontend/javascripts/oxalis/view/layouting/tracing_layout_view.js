/**
 * tracing_layout_view.js
 * @flow
 */

import { Layout, Icon } from "antd";
import { connect } from "react-redux";
import { withRouter } from "react-router-dom";
import * as React from "react";
import classNames from "classnames";
import type { Dispatch } from "redux";

import { ArbitraryViewport, type ViewMode, OrthoViews } from "oxalis/constants";
import type { OxalisState, AnnotationType, TraceOrViewCommand } from "oxalis/store";
import { updateUserSettingAction } from "oxalis/model/actions/settings_actions";
import AbstractTreeTabView from "oxalis/view/right-menu/abstract_tree_tab_view";
import ActionBarView from "oxalis/view/action_bar_view";
import ButtonComponent from "oxalis/view/components/button_component";
import CommentTabView from "oxalis/view/right-menu/comment_tab/comment_tab_view";
import DatasetInfoTabView from "oxalis/view/right-menu/dataset_info_tab_view";
import InputCatcher, { recalculateInputCatcherSizes } from "oxalis/view/input_catcher";
import MappingInfoView from "oxalis/view/right-menu/mapping_info_view";
import MeshesView from "oxalis/view/right-menu/meshes_view";
import NmlUploadZoneContainer from "oxalis/view/nml_upload_zone_container";
import OxalisController from "oxalis/controller";
import RecordingSwitch from "oxalis/view/recording_switch";
import SettingsView from "oxalis/view/settings/settings_view";
import TDViewControls from "oxalis/view/td_view_controls";
import Toast from "libs/toast";
import TracingView from "oxalis/view/tracing_view";
import TreesTabView, { importNmls } from "oxalis/view/right-menu/trees_tab_view";
import VersionView from "oxalis/view/version_view";
import messages from "messages";
import window, { document, location } from "libs/window";

import { GoldenLayoutAdapter } from "./golden_layout_adapter";
import { determineLayout, headerHeight } from "./default_layout_configs";
import { storeLayoutConfig, setActiveLayout } from "./layout_persistence";

const { Header, Sider } = Layout;

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
|};
type DispatchProps = {|
  setAutoSaveLayouts: boolean => void,
|};
type Props = {| ...OwnProps, ...StateProps, ...DispatchProps |};

type State = {
  isSettingsCollapsed: boolean,
  activeLayout: string,
};

const canvasAndLayoutContainerID = "canvasAndLayoutContainer";

const GOLDEN_LAYOUT_ADAPTER_STYLE = {
  display: "block",
  height: "100%",
  width: "100%",
  flex: "1 1 auto",
  overflow: "hidden",
};

class TracingLayoutView extends React.PureComponent<Props, State> {
  currentLayoutConfig: Object;
  currentLayoutName: string;

  constructor(props: Props) {
    super(props);
    const layoutType = determineLayout(this.props.initialCommandType.type, this.props.viewMode);
    let lastActiveLayout;
    if (
      props.storedLayouts.LastActiveLayouts &&
      props.storedLayouts.LastActiveLayouts[layoutType]
    ) {
      lastActiveLayout = props.storedLayouts.LastActiveLayouts[layoutType];
    } else {
      // added as a valide fallback when there are no stored last active layouts
      const firstStoredLayout = Object.keys(props.storedLayouts[layoutType])[0];
      lastActiveLayout = firstStoredLayout;
    }
    this.state = {
      isSettingsCollapsed: true,
      activeLayout: lastActiveLayout,
    };
  }

  componentDidCatch() {
    Toast.error(messages["react.rendering_error"]);
  }

  componentWillUnmount() {
    // Replace entire document with loading message
    document.body.removeChild(document.getElementById("main-container"));

    const refreshMessage = document.createElement("p");
    refreshMessage.innerHTML = "Reloading webKnossos...";
    refreshMessage.style.position = "absolute";
    refreshMessage.style.top = 0;
    document.body.appendChild(refreshMessage);

    // Do a complete page refresh to make sure all tracing data is garbage
    // collected and all events are canceled, etc.
    location.reload();
  }

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
    const layoutKey = determineLayout(this.props.initialCommandType.type, this.props.viewMode);
    storeLayoutConfig(this.currentLayoutConfig, layoutKey, this.currentLayoutName);
  };

  getLayoutNamesFromCurrentView = (layoutKey): Array<string> =>
    this.props.storedLayouts[layoutKey] ? Object.keys(this.props.storedLayouts[layoutKey]) : [];

  render() {
    const layoutType = determineLayout(this.props.initialCommandType.type, this.props.viewMode);
    const currentLayoutNames = this.getLayoutNamesFromCurrentView(layoutType);
    const { displayScalebars, isDatasetOnScratchVolume, isUpdateTracingAllowed } = this.props;
    const headerClassName = classNames({ construction: isDatasetOnScratchVolume });

    return (
      <NmlUploadZoneContainer onImport={importNmls} isAllowed={isUpdateTracingAllowed}>
        <OxalisController
          initialAnnotationType={this.props.initialAnnotationType}
          initialCommandType={this.props.initialCommandType}
        />

        <Layout className="tracing-layout">
          <Header
            className={headerClassName}
            style={{ flex: "0 1 auto", zIndex: 210, height: headerHeight }}
          >
            <ButtonComponent onClick={this.handleSettingsCollapse}>
              <Icon type={this.state.isSettingsCollapsed ? "menu-unfold" : "menu-fold"} />
              <span className="hide-on-small-screen">Settings</span>
            </ButtonComponent>
            <ActionBarView
              layoutProps={{
                storedLayoutNamesForView: currentLayoutNames,
                activeLayout: this.state.activeLayout,
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
          </Header>
          <Layout style={{ display: "flex" }}>
            <Sider
              collapsible
              trigger={null}
              collapsed={this.state.isSettingsCollapsed}
              collapsedWidth={0}
              width={350}
              style={{ zIndex: 100 }}
            >
              {/* Don't render SettingsView if it's hidden to improve performance */}
              {!this.state.isSettingsCollapsed ? <SettingsView /> : null}
            </Sider>

            <div id={canvasAndLayoutContainerID} style={{ position: "relative" }}>
              <TracingView />
              <GoldenLayoutAdapter
                id="layoutContainer"
                style={GOLDEN_LAYOUT_ADAPTER_STYLE}
                layoutKey={layoutType}
                activeLayoutName={this.state.activeLayout}
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
                <InputCatcher viewportID={OrthoViews.TDView} key="td" portalKey="td">
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
  };
}

export default connect<Props, OwnProps, _, _, _, _>(
  mapStateToProps,
  mapDispatchToProps,
)(withRouter(TracingLayoutView));
